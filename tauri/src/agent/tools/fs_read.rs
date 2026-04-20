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
    /// The absolute path to the file to read.
    pub file_path: String,
    /// The line number to start reading from (1-indexed). Optional.
    #[serde(default)]
    pub start_line: Option<u32>,
    /// The line number to stop reading at (inclusive). Optional.
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

pub async fn execute(input: &FSReadInput, state: &Arc<ToolState>) -> Result<String, String> {
    let resolved = resolve_path(&input.file_path, &state.root_path);
    let path = resolved.to_string_lossy().to_string();
    let path = path.as_str();

    // Check blocked files list (eval sandboxing).
    // Return Ok (not Err) so this doesn't eat into the error budget —
    // the model shouldn't be penalized for discovering a restriction.
    if state.blocked_files.iter().any(|b| resolved.ends_with(b) || &resolved == b) {
        return Ok(format!(
            "Access denied: `{}` is a hidden test file and you are being evaluated on this \
             task. Reading the test assertions would defeat the evaluation, so the harness \
             is withholding this file's contents. You may execute it (e.g. `python3 {}`, \
             `sh {}`, `node {}`) and inspect its stdout/stderr/exit code — that's the \
             intended signal. Any attempt to circumvent this restriction by reading the \
             file through other means will be flagged in the transcript as a cheat.",
            input.file_path,
            input.file_path,
            input.file_path,
            input.file_path,
        ));
    }

    // Check file size
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

    state.mark_read(path).await;

    // Reads always return the full file content. Earlier we experimented
    // with a dedup stub for unchanged re-reads; it confused the model
    // (especially after writes / patches) and was removed.
    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len();

    let start = input.start_line.unwrap_or(1).max(1) as usize;
    let end = input.end_line.map(|e| e as usize).unwrap_or(total).min(total);

    if start > total {
        return Ok(format!("File '{path}' has {total} lines; start_line {start} is beyond the end."));
    }

    // Clamp end to be at least start (model may pass end_line < start_line)
    let end = end.max(start);

    let slice = &lines[start - 1..end.min(total)];
    let mut output = String::with_capacity(slice.iter().map(|l| l.len() + 12).sum());
    for (i, line) in slice.iter().enumerate() {
        let line_num = start + i;
        let _ = writeln!(output, "{line_num}: {line}");
    }

    if start > 1 || end < total {
        let _ = write!(output, "\n[Showing lines {start}-{end} of {total}]");
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::tools::test_helpers::{make_state, make_temp_file};

    #[tokio::test]
    async fn read_entire_file_with_line_numbers() {
        let f = make_temp_file("line one\nline two\nline three\n");
        let state = make_state();
        let input = FSReadInput {
            file_path: f.path().to_str().unwrap().into(),
            start_line: None,
            end_line: None,
        };
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
            file_path: f.path().to_str().unwrap().into(),
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

        let input = FSReadInput { file_path: path.clone(), start_line: None, end_line: None };
        execute(&input, &state).await.unwrap();

        assert!(state.has_read(&path).await);
    }

    #[tokio::test]
    async fn read_nonexistent_file_returns_error() {
        let state = make_state();
        let input = FSReadInput {
            file_path: "/tmp/does_not_exist_at_all.txt".into(),
            start_line: None,
            end_line: None,
        };
        let result = execute(&input, &state).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Cannot read file"));
    }

    #[tokio::test]
    async fn read_start_beyond_end_returns_message() {
        let f = make_temp_file("one\ntwo\n");
        let state = make_state();
        let input = FSReadInput {
            file_path: f.path().to_str().unwrap().into(),
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
        let input = FSReadInput {
            file_path: f.path().to_str().unwrap().into(),
            start_line: None,
            end_line: None,
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("1: only line"));
    }

    #[tokio::test]
    async fn read_empty_file() {
        let f = make_temp_file("");
        let state = make_state();
        let input = FSReadInput {
            file_path: f.path().to_str().unwrap().into(),
            start_line: None,
            end_line: None,
        };
        let result = execute(&input, &state).await.unwrap();
        // Empty file has 0 lines; start_line=1 > total=0
        assert!(result.contains("start_line 1 is beyond the end"));
    }

    #[tokio::test]
    async fn read_end_line_clamped_to_total() {
        let f = make_temp_file("a\nb\n");
        let state = make_state();
        let input = FSReadInput {
            file_path: f.path().to_str().unwrap().into(),
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
            file_path: f.path().to_str().unwrap().into(),
            start_line: Some(8),
            end_line: Some(3),
        };
        // Should not panic — end_line is clamped to start_line
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("8: h"));
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
        let input = FSReadInput { file_path: path, start_line: None, end_line: None };

        for _ in 0..4 {
            let out = execute(&input, &state).await.unwrap();
            assert!(out.contains("1: line one"));
            assert!(out.contains("2: line two"));
        }
    }
}
