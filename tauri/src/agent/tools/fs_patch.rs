use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::ToolState;
use super::fs_read::resolve_path;
use super::MAX_FILE_SIZE;
use crate::agent::utils::{io_err, line_has_number_prefix, read_first_err};

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

    // Read-before-edit enforcement
    if !state.has_read(path).await {
        return Err(read_first_err(path, "patching"));
    }

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
        // Helpful hint: if old_string starts with a line-number prefix like `12: `,
        // the model likely copied the `N: ` display format from the `read` tool.
        let prefix_hint = if line_has_number_prefix(&input.old_string) {
            "\nHINT: Your old_string appears to start with a line-number prefix like `12: ` — \
             that prefix is added by the `read` tool for display only and is NOT part of the \
             actual file content. Strip the `N: ` prefix and retry."
        } else {
            ""
        };
        return Err(format!(
            "The old_string was not found in '{path}'. Make sure you're using the exact text from the file.{prefix_hint}"
        ));
    }
    if matches.next().is_some() {
        return Err(format!(
            "The old_string appears more than once in '{path}'. It must appear exactly once. \
             Provide more surrounding context to make it unique."
        ));
    }

    let new_content = content.replacen(&input.old_string, &input.new_string, 1);
    tokio::fs::write(path, &new_content)
        .await
        .map_err(|e| io_err("write file", path, e))?;

    Ok(format!("Successfully patched '{path}'."))
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
    async fn patch_rejected_without_read() {
        let f = make_temp_file("content");
        let state = make_state();

        let input = FSPatchInput {
            file_path: f.path().to_str().unwrap().into(),
            old_string: "content".into(),
            new_string: "new".into(),
        };
        let result = execute(&input, &state).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must read"));
    }

    #[tokio::test]
    async fn patch_multiple_occurrences_rejected() {
        let f = make_temp_file("aaa\naaa\naaa\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = FSPatchInput {
            file_path: path,
            old_string: "aaa".into(),
            new_string: "bbb".into(),
        };
        let result = execute(&input, &state).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("more than once"));
        assert!(err.contains("exactly once"));
    }

    #[tokio::test]
    async fn patch_not_found_rejected() {
        let f = make_temp_file("hello world");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = FSPatchInput {
            file_path: path,
            old_string: "nonexistent".into(),
            new_string: "replacement".into(),
        };
        let result = execute(&input, &state).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
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
