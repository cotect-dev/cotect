use std::fmt::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::ToolState;
use crate::agent::utils::io_err;

use super::MAX_FILE_SIZE;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FSReadInput {
    /// The absolute path to a single file to read. Use this for a
    /// targeted single-file read, optionally with `start_line`/`end_line`.
    /// Mutually exclusive with `file_paths` — pass exactly one.
    #[serde(default)]
    pub file_path: Option<String>,

    /// Multiple absolute paths to read in one call. Use this when you
    /// need several files for the same task — a batch read is one
    /// round-trip; reading each file in a separate call wastes turns.
    /// Typical use: investigating all scope files upfront. Cap is 20
    /// paths per call. Line ranges (`start_line`/`end_line`) are not
    /// supported in batch mode — pass them with a single `file_path`.
    #[serde(default)]
    pub file_paths: Option<Vec<String>>,

    /// The line number to start reading from (1-indexed). Only meaningful
    /// when `file_path` is set (single read).
    #[serde(default)]
    pub start_line: Option<u32>,

    /// The line number to stop reading at (inclusive). Only meaningful
    /// when `file_path` is set (single read).
    #[serde(default)]
    pub end_line: Option<u32>,
}

/// Resolve a user-supplied path against the task's root_path if relative.
pub(super) fn resolve_path(raw: &str, root_path: &str) -> PathBuf {
    let p = Path::new(raw);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        Path::new(root_path).join(p)
    }
}

const MAX_BATCH_PATHS: usize = 20;

pub async fn execute(input: &FSReadInput, state: &Arc<ToolState>) -> Result<String, String> {
    // Single `file_path` returns a line-numbered body; `file_paths` wraps
    // each file in a `<file path="...">` block.
    match (&input.file_path, &input.file_paths) {
        (Some(_), Some(paths)) if !paths.is_empty() => Err(
            "Pass either `file_path` (single) OR `file_paths` (batch), not both. \
             For one file, use `file_path`. For multiple, use `file_paths`."
                .into(),
        ),
        (Some(p), _) => read_single(p, input.start_line, input.end_line, state).await,
        (None, Some(paths)) if !paths.is_empty() => {
            if input.start_line.is_some() || input.end_line.is_some() {
                return Err(
                    "`start_line`/`end_line` are only supported with `file_path` (single). \
                     For a batch read, omit them; for a ranged read, pass one file via `file_path`."
                        .into(),
                );
            }
            if paths.len() > MAX_BATCH_PATHS {
                return Err(format!(
                    "Batch read accepts at most {MAX_BATCH_PATHS} paths; got {}. \
                     Split the batch — reading speculatively bloats context.",
                    paths.len(),
                ));
            }
            read_batch(paths, state).await
        }
        _ => Err(
            "Provide either `file_path` (single) or `file_paths` (batch).".into(),
        ),
    }
}

async fn read_single(
    raw_path: &str,
    start_line: Option<u32>,
    end_line: Option<u32>,
    state: &Arc<ToolState>,
) -> Result<String, String> {
    read_single_inner(raw_path, start_line, end_line, state, false).await
}

/// `is_inside_batch` suppresses the "use file_paths" hint that standalone
/// single-path reads append — the batch wrapper has its own framing.
async fn read_single_inner(
    raw_path: &str,
    start_line: Option<u32>,
    end_line: Option<u32>,
    state: &Arc<ToolState>,
    is_inside_batch: bool,
) -> Result<String, String> {
    let resolved = resolve_path(raw_path, &state.root_path);
    let path = resolved.to_string_lossy().to_string();
    let path = path.as_str();

    // Eval sandboxing — return Ok (not Err) so blocked reads don't eat
    // into the error budget. Discovering a restriction isn't a penalty.
    if state.blocked_files.iter().any(|b| resolved.ends_with(b) || &resolved == b) {
        return Ok(format!(
            "Access denied: `{raw}` is a hidden test file and you are being evaluated on this \
             task. Reading the test assertions would defeat the evaluation, so the harness \
             is withholding this file's contents. You may execute it (e.g. `python3 {raw}`, \
             `sh {raw}`, `node {raw}`) and inspect its stdout/stderr/exit code — that's the \
             intended signal. Any attempt to circumvent this restriction by reading the \
             file through other means will be flagged in the transcript as a cheat.",
            raw = raw_path,
        ));
    }

    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|e| io_err("read file", path, e))?;

    if metadata.len() > MAX_FILE_SIZE {
        return Err(format!(
            "File '{path}' is too large ({} bytes, max {MAX_FILE_SIZE})",
            metadata.len()
        ));
    }

    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| io_err("read file", path, e))?;

    // Count session reads BEFORE marking this one — drives the batching
    // tip below when the model is reading sequentially.
    let prior_touched = {
        let map = state.read_files.lock().await;
        map.len()
    };
    state.mark_read(path).await;

    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len();

    let start = start_line.unwrap_or(1).max(1) as usize;
    let end = end_line.map(|e| e as usize).unwrap_or(total).min(total);

    if start > total {
        return Ok(format!("File '{path}' has {total} lines; start_line {start} is beyond the end."));
    }

    let end = end.max(start);

    let slice = &lines[start - 1..end.min(total)];
    let mut output = String::with_capacity(slice.iter().map(|l| l.len() + 12).sum());

    // Prepend a banner on large reads — observed failure: model reads a
    // long file but only mentally indexes the first few hundred lines.
    // The banner steers toward `fs_search` for symbol lookups.
    if total >= LARGE_FILE_BANNER_LINES && start_line.is_none() && end_line.is_none() {
        let _ = writeln!(
            output,
            "[NOTE: this file has {total} lines. For symbol lookups or call-site \
             enumeration in files this size, `fs_search` is faster and more \
             reliable than scrolling. Reading the whole file is fine, but be \
             aware your attention may not span every line.]\n"
        );
    }

    for (i, line) in slice.iter().enumerate() {
        let line_num = start + i;
        let _ = writeln!(output, "{line_num}: {line}");
    }

    if start > 1 || end < total {
        let _ = write!(output, "\n[Showing lines {start}-{end} of {total}]");
    }

    // Suggest the batch form on follow-up single-path reads.
    if !is_inside_batch && prior_touched > 0 {
        let _ = write!(
            output,
            "\n\n[Tip: when reading multiple files for the same task, one `read` call \
             with `file_paths: [\"/abs/a\", \"/abs/b\", ...]` is faster than several \
             single-file calls.]"
        );
    }

    Ok(output)
}

/// Per-file `<file path=".." lines="N">..</file>` blocks; failures get
/// `<file path=".." error="..">` so a typo doesn't kill the whole call.
async fn read_batch(paths: &[String], state: &Arc<ToolState>) -> Result<String, String> {
    let mut out = String::new();
    let _ = writeln!(
        out,
        "Batch read of {} file{}.\n",
        paths.len(),
        if paths.len() == 1 { "" } else { "s" },
    );

    for raw_path in paths {
        let resolved = resolve_path(raw_path, &state.root_path);
        let resolved_display = resolved.to_string_lossy().to_string();

        match read_single_inner(raw_path, None, None, state, true).await {
            Ok(body) => {
                let line_count = body.lines().count();
                let _ = writeln!(
                    out,
                    "<file path=\"{resolved_display}\" lines=\"{line_count}\">",
                );
                out.push_str(&body);
                if !body.ends_with('\n') {
                    out.push('\n');
                }
                let _ = writeln!(out, "</file>\n");
            }
            Err(e) => {
                let sanitised = e.replace('"', "'").replace('\n', " ");
                let _ = writeln!(
                    out,
                    "<file path=\"{resolved_display}\" error=\"{sanitised}\"></file>\n",
                );
            }
        }
    }

    Ok(out)
}

/// Tuned so real source files stay quiet (~300-line median) while
/// genuinely large files surface the `fs_search` hint.
const LARGE_FILE_BANNER_LINES: usize = 400;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::tools::test_helpers::{make_state, make_temp_file};

    fn single(file_path: &str) -> FSReadInput {
        FSReadInput {
            file_path: Some(file_path.into()),
            file_paths: None,
            start_line: None,
            end_line: None,
        }
    }

    fn batch(paths: Vec<&str>) -> FSReadInput {
        FSReadInput {
            file_path: None,
            file_paths: Some(paths.into_iter().map(String::from).collect()),
            start_line: None,
            end_line: None,
        }
    }

    #[tokio::test]
    async fn read_entire_file_with_line_numbers() {
        let f = make_temp_file("line one\nline two\nline three\n");
        let state = make_state();
        let input = single(f.path().to_str().unwrap());
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("1: line one"));
        assert!(result.contains("2: line two"));
        assert!(result.contains("3: line three"));
        assert!(!result.contains("[Showing lines"));
    }

    #[tokio::test]
    async fn read_line_range() {
        let f = make_temp_file("a\nb\nc\nd\ne\n");
        let state = make_state();
        let input = FSReadInput {
            file_path: Some(f.path().to_str().unwrap().into()),
            file_paths: None,
            start_line: Some(2),
            end_line: Some(4),
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("2: b"));
        assert!(result.contains("3: c"));
        assert!(result.contains("4: d"));
        assert!(!result.contains("1: a"));
        assert!(!result.contains("5: e"));
        assert!(result.contains("[Showing lines 2-4 of 5]"));
    }

    #[tokio::test]
    async fn read_marks_file_as_read() {
        let f = make_temp_file("hello");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        assert!(!state.has_read(&path).await);

        let input = single(&path);
        execute(&input, &state).await.unwrap();

        assert!(state.has_read(&path).await);
    }

    #[tokio::test]
    async fn read_nonexistent_file_returns_error() {
        let state = make_state();
        let input = single("/tmp/does_not_exist_at_all.txt");
        let result = execute(&input, &state).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Cannot read file"));
    }

    #[tokio::test]
    async fn read_start_beyond_end_returns_message() {
        let f = make_temp_file("one\ntwo\n");
        let state = make_state();
        let input = FSReadInput {
            file_path: Some(f.path().to_str().unwrap().into()),
            file_paths: None,
            start_line: Some(100),
            end_line: None,
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("start_line 100 is beyond the end"));
    }

    #[tokio::test]
    async fn read_single_line_file() {
        let f = make_temp_file("only line");
        let state = make_state();
        let input = single(f.path().to_str().unwrap());
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("1: only line"));
    }

    #[tokio::test]
    async fn read_empty_file() {
        let f = make_temp_file("");
        let state = make_state();
        let input = single(f.path().to_str().unwrap());
        let result = execute(&input, &state).await.unwrap();
        // Empty file has 0 lines; start_line=1 > total=0
        assert!(result.contains("start_line 1 is beyond the end"));
    }

    #[tokio::test]
    async fn read_end_line_clamped_to_total() {
        let f = make_temp_file("a\nb\n");
        let state = make_state();
        let input = FSReadInput {
            file_path: Some(f.path().to_str().unwrap().into()),
            file_paths: None,
            start_line: Some(1),
            end_line: Some(999),
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("1: a"));
        assert!(result.contains("2: b"));
    }

    #[tokio::test]
    async fn read_end_line_before_start_line_does_not_panic() {
        let f = make_temp_file("a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n");
        let state = make_state();
        let input = FSReadInput {
            file_path: Some(f.path().to_str().unwrap().into()),
            file_paths: None,
            start_line: Some(8),
            end_line: Some(3),
        };
        // Should not panic — end_line is clamped to start_line
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("8: h"));
    }

    #[tokio::test]
    async fn first_single_read_has_no_batching_tip() {
        // The first single-path read in a session is silent — the
        // model is just starting investigation.
        let f = make_temp_file("hello\n");
        let state = make_state();
        let input = single(f.path().to_str().unwrap());
        let out = execute(&input, &state).await.unwrap();
        assert!(!out.contains("Tip: when reading multiple files"));
    }

    #[tokio::test]
    async fn second_single_read_emits_batching_tip() {
        // Once the model has touched at least one file, subsequent
        // single-path reads append a one-line note about
        // `file_paths: [...]`. Targets the eval pattern of three
        // sequential single reads when one batch would do.
        let f1 = make_temp_file("hello\n");
        let f2 = make_temp_file("world\n");
        let state = make_state();

        let _ = execute(&single(f1.path().to_str().unwrap()), &state).await.unwrap();
        let out2 = execute(&single(f2.path().to_str().unwrap()), &state).await.unwrap();

        assert!(
            out2.contains("Tip: when reading multiple files for the same task"),
            "second single-path read must suggest file_paths; got: {out2}",
        );
        assert!(out2.contains("file_paths"));
    }

    #[tokio::test]
    async fn batch_read_does_not_emit_per_file_batching_tip() {
        // The tip should NOT appear inside the `<file>` blocks of a
        // batch read — the model is already using the batch shape.
        let f1 = make_temp_file("hello\n");
        let f2 = make_temp_file("world\n");
        let state = make_state();

        let input = batch(vec![
            f1.path().to_str().unwrap(),
            f2.path().to_str().unwrap(),
        ]);
        let out = execute(&input, &state).await.unwrap();
        assert!(!out.contains("Tip: when reading multiple files"));
    }

    #[tokio::test]
    async fn rereading_a_file_returns_full_content_every_time() {
        // Reads have no harness-side deduplication. The model gets the
        // full file body on every call, whether the content changed or
        // not. Earlier experiments with stubs confused the model after
        // writes and were removed.
        let f = make_temp_file("line one\nline two\n");
        let state = make_state();
        let path: String = f.path().to_str().unwrap().into();
        let input = single(&path);

        for _ in 0..4 {
            let out = execute(&input, &state).await.unwrap();
            assert!(out.contains("1: line one"));
            assert!(out.contains("2: line two"));
        }
    }

    // ─── Batch-read tests ───

    #[tokio::test]
    async fn batch_read_returns_each_file_in_its_own_block() {
        let f1 = make_temp_file("alpha\nbeta\n");
        let f2 = make_temp_file("gamma\n");
        let state = make_state();

        let input = batch(vec![
            f1.path().to_str().unwrap(),
            f2.path().to_str().unwrap(),
        ]);
        let out = execute(&input, &state).await.unwrap();

        assert!(out.contains("Batch read of 2 files"));
        assert!(out.contains(&format!(
            "<file path=\"{}\"",
            f1.path().to_str().unwrap()
        )));
        assert!(out.contains(&format!(
            "<file path=\"{}\"",
            f2.path().to_str().unwrap()
        )));
        assert!(out.contains("1: alpha"));
        assert!(out.contains("2: beta"));
        assert!(out.contains("1: gamma"));
        assert!(out.contains("</file>"));
    }

    #[tokio::test]
    async fn batch_read_marks_each_file_as_read() {
        let f1 = make_temp_file("hello\n");
        let f2 = make_temp_file("world\n");
        let state = make_state();
        let p1 = f1.path().to_str().unwrap().to_string();
        let p2 = f2.path().to_str().unwrap().to_string();

        let input = batch(vec![&p1, &p2]);
        execute(&input, &state).await.unwrap();

        assert!(state.has_read(&p1).await);
        assert!(state.has_read(&p2).await);
    }

    #[tokio::test]
    async fn batch_read_continues_past_one_missing_file() {
        // Best-effort: a typo in one path should not kill the whole
        // batch. The bad file gets an `error="..."` attribute; the
        // others come through normally.
        let f_ok = make_temp_file("present\n");
        let state = make_state();

        let input = batch(vec![
            f_ok.path().to_str().unwrap(),
            "/tmp/this_path_does_not_exist_xyz.txt",
        ]);
        let out = execute(&input, &state).await.unwrap();

        assert!(out.contains("1: present"));
        assert!(out.contains("error=\""));
        assert!(out.contains("Cannot read file"));
    }

    #[tokio::test]
    async fn batch_read_rejects_line_range() {
        // Line ranges are only meaningful with a single file; mixing
        // them with `file_paths` is almost always a model mistake.
        let state = make_state();
        let input = FSReadInput {
            file_path: None,
            file_paths: Some(vec!["/tmp/a".into(), "/tmp/b".into()]),
            start_line: Some(1),
            end_line: Some(10),
        };
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("only supported with `file_path`"));
    }

    #[tokio::test]
    async fn batch_read_rejects_too_many_paths() {
        let paths: Vec<String> = (0..MAX_BATCH_PATHS + 5)
            .map(|i| format!("/tmp/x_{i}.txt"))
            .collect();
        let state = make_state();
        let input = FSReadInput {
            file_path: None,
            file_paths: Some(paths),
            start_line: None,
            end_line: None,
        };
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("at most"));
    }

    #[tokio::test]
    async fn read_rejects_both_file_path_and_file_paths_set() {
        let state = make_state();
        let input = FSReadInput {
            file_path: Some("/tmp/a".into()),
            file_paths: Some(vec!["/tmp/b".into()]),
            start_line: None,
            end_line: None,
        };
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("not both"));
    }

    #[tokio::test]
    async fn read_rejects_neither_field_set() {
        let state = make_state();
        let input = FSReadInput {
            file_path: None,
            file_paths: None,
            start_line: None,
            end_line: None,
        };
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("Provide either"));
    }

    #[tokio::test]
    async fn batch_read_with_empty_array_treated_as_missing() {
        let state = make_state();
        let input = FSReadInput {
            file_path: None,
            file_paths: Some(vec![]),
            start_line: None,
            end_line: None,
        };
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("Provide either"));
    }

    #[tokio::test]
    async fn batch_read_single_path_still_works() {
        // Edge case: file_paths with one element. Should produce a
        // batch-format response (with `<file>` wrapper) rather than the
        // bare format. Useful when the model is iterating a list it
        // built dynamically and the list happens to have one element.
        let f = make_temp_file("solo\n");
        let state = make_state();
        let input = batch(vec![f.path().to_str().unwrap()]);
        let out = execute(&input, &state).await.unwrap();
        assert!(out.contains("Batch read of 1 file"));
        assert!(out.contains("<file path="));
        assert!(out.contains("1: solo"));
    }
}
