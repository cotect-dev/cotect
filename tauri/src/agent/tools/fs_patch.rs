use std::fmt::Write as _;
use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::ToolState;
use super::fs_read::resolve_path;
use super::MAX_FILE_SIZE;
use crate::agent::utils::{io_err, line_has_number_prefix};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FSPatchInput {
    /// The absolute path to the file to patch.
    pub file_path: String,
    /// The exact text to find and replace. Must match exactly once in the file.
    pub old_string: String,
    /// The replacement text.
    pub new_string: String,
}

pub async fn execute(input: &FSPatchInput, state: &Arc<ToolState>) -> Result<String, String> {
    let resolved = resolve_path(&input.file_path, &state.root_path);
    let path_owned = resolved.to_string_lossy().to_string();
    let path = path_owned.as_str();

    // Block patches to protected files (eval sandboxing)
    if state.blocked_files.iter().any(|b| resolved.ends_with(b) || &resolved == b) {
        return Err(format!("Access denied: {path} is a protected file"));
    }

    // Note: we deliberately don't require the model to have called `read`
    // first. The real correctness condition — "does `old_string` actually
    // appear in the file?" — is the match check below. An exact match
    // proves the model's mental state is accurate; a miss returns the
    // file contents inline so the model gets the same information it
    // would have gotten from a separate `read` call. Net: no wasted
    // bounce on a blind-but-correct patch, and exactly one bounce's
    // worth of feedback on a blind-and-wrong patch.

    // File-size guard
    let meta = tokio::fs::metadata(path)
        .await
        .map_err(|e| format!("Cannot access {path}: {e}"))?;
    if meta.len() > MAX_FILE_SIZE {
        return Err(format!("{path}: file too large to patch ({} bytes)", meta.len()));
    }

    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| io_err("read file", path, e))?;

    if input.old_string == input.new_string {
        return Err("old_string and new_string are identical. No change needed.".into());
    }

    let mut matches = content.match_indices(&input.old_string);
    let first = matches.next();
    if first.is_none() {
        // `old_string` not found — return the current file contents inline
        // so the model can retry without a separate `read` call. Same
        // shape as the read tool's output (`N: <line>`), so snippets can
        // be copied directly (after stripping the prefix — see hint).
        let prefix_hint = if line_has_number_prefix(&input.old_string) {
            "\n\nHINT: Your old_string appears to start with a line-number prefix \
             like `12: ` — that prefix comes from the `read` tool's display format \
             and is NOT part of the actual file content. Strip the `N: ` prefix."
        } else {
            ""
        };
        // Mark as read: the error payload contains the full current file,
        // so for all downstream purposes the model now knows this path.
        state.mark_read(path).await;
        return Err(format!(
            "old_string not found in '{path}'. Current file contents (line-numbered \
             for reference; the `N: ` prefix is NOT part of the file):\n\n\
             {body}\n\n\
             Retry with a corrected old_string that appears verbatim in the file above.\
             {prefix_hint}",
            body = number_lines(&content),
        ));
    }
    if matches.next().is_some() {
        let occurrences = content.matches(&input.old_string).count();
        state.mark_read(path).await;
        return Err(format!(
            "old_string appears {occurrences} times in '{path}'; patch requires \
             exactly one match. Add surrounding context lines to make the snippet \
             unique. Current file contents:\n\n\
             {body}",
            body = number_lines(&content),
        ));
    }

    let new_content = content.replacen(&input.old_string, &input.new_string, 1);
    tokio::fs::write(path, &new_content)
        .await
        .map_err(|e| io_err("write file", path, e))?;

    // A successful match proves the model's mental model was accurate,
    // and the file was just rewritten — mark as read so subsequent tools
    // (e.g. fs_write's clobber guard) treat it correctly.
    state.mark_read(path).await;

    Ok(format!("Successfully patched '{path}'."))
}

/// Format `content` the same way the read tool does: every line prefixed
/// with its 1-indexed line number and a colon. Used in patch error
/// payloads so model can copy snippets without re-reading.
fn number_lines(content: &str) -> String {
    let mut out = String::with_capacity(content.len() + content.lines().count() * 6);
    for (i, line) in content.lines().enumerate() {
        let _ = writeln!(out, "{}: {line}", i + 1);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::tools::test_helpers::{make_state, make_temp_file, read_file};

    #[tokio::test]
    async fn patch_single_occurrence_succeeds() {
        let f = make_temp_file("hello world\nfoo bar\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = FSPatchInput {
            file_path: path.clone(),
            old_string: "foo bar".into(),
            new_string: "baz qux".into(),
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("Successfully patched"));

        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert!(on_disk.contains("baz qux"));
        assert!(!on_disk.contains("foo bar"));
    }

    #[tokio::test]
    async fn blind_patch_succeeds_when_old_string_matches() {
        // No prior `read` call. A correct old_string proves the model's
        // mental model is accurate, and forcing a separate `read` bounce
        // would waste a turn. The patch goes through.
        let f = make_temp_file("hello world\nfoo bar\n");
        let state = make_state();
        let path: String = f.path().to_str().unwrap().into();

        let input = FSPatchInput {
            file_path: path.clone(),
            old_string: "foo bar".into(),
            new_string: "baz qux".into(),
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("Successfully patched"));

        // After a successful patch we treat the path as "seen" so
        // downstream fs_write's clobber guard doesn't trip.
        assert!(state.has_read(&path).await);

        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert!(on_disk.contains("baz qux"));
        assert!(!on_disk.contains("foo bar"));
    }

    #[tokio::test]
    async fn patch_not_found_returns_current_file_inline() {
        // The key invariant: a `not found` failure must include the
        // current file contents line-numbered so the model can retry
        // without spending a turn on a separate `read` call.
        let f = make_temp_file("alpha\nbeta\ngamma\n");
        let state = make_state();
        let path: String = f.path().to_str().unwrap().into();

        let input = FSPatchInput {
            file_path: path.clone(),
            old_string: "nonexistent".into(),
            new_string: "replacement".into(),
        };
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("not found"));
        // Line-numbered body included (same format as `read`).
        assert!(err.contains("1: alpha"));
        assert!(err.contains("2: beta"));
        assert!(err.contains("3: gamma"));
        // And the path is now treated as read — no need for a separate
        // read call on retry.
        assert!(state.has_read(&path).await);
    }

    #[tokio::test]
    async fn patch_multiple_occurrences_returns_file_inline() {
        let f = make_temp_file("aaa\naaa\naaa\n");
        let state = make_state();
        let path: String = f.path().to_str().unwrap().into();

        let input = FSPatchInput {
            file_path: path.clone(),
            old_string: "aaa".into(),
            new_string: "bbb".into(),
        };
        let err = execute(&input, &state).await.unwrap_err();
        // Specific count surfaces so the model knows how bad the
        // ambiguity is.
        assert!(err.contains("appears 3 times"));
        assert!(err.contains("exactly one match"));
        // File body included so the model can craft a unique snippet.
        assert!(err.contains("1: aaa"));
        assert!(err.contains("2: aaa"));
        assert!(err.contains("3: aaa"));
        assert!(state.has_read(&path).await);
    }

    #[tokio::test]
    async fn patch_numbered_output_hint_still_fires() {
        // If the model's old_string starts with `N: `, the legacy hint
        // about the read tool's display format should still appear.
        let f = make_temp_file("line one\nline two\n");
        let state = make_state();
        let path: String = f.path().to_str().unwrap().into();

        let input = FSPatchInput {
            file_path: path,
            old_string: "1: line one".into(),
            new_string: "1: edited".into(),
        };
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("not found"));
        assert!(err.contains("line-number prefix"));
    }

    #[tokio::test]
    async fn patch_identical_strings_rejected() {
        let f = make_temp_file("hello");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = FSPatchInput {
            file_path: path,
            old_string: "hello".into(),
            new_string: "hello".into(),
        };
        let result = execute(&input, &state).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("identical"));
    }

    #[tokio::test]
    async fn patch_multiline_match() {
        let f = make_temp_file("fn main() {\n    println!(\"old\");\n}\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = FSPatchInput {
            file_path: path.clone(),
            old_string: "    println!(\"old\");".into(),
            new_string: "    println!(\"new\");".into(),
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("Successfully patched"));

        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert!(on_disk.contains("println!(\"new\")"));
    }

    #[tokio::test]
    async fn patch_nonexistent_file_returns_error() {
        let state = make_state();
        state.mark_read("/tmp/no_such_file_patch.txt").await;

        let input = FSPatchInput {
            file_path: "/tmp/no_such_file_patch.txt".into(),
            old_string: "x".into(),
            new_string: "y".into(),
        };
        let result = execute(&input, &state).await;
        assert!(result.is_err());
    }
}
