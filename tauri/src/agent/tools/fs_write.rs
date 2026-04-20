use std::path::Path;
use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::ToolState;
use super::fs_read::resolve_path;
use crate::agent::utils::{io_err, line_has_number_prefix, read_first_err};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FSWriteInput {
    /// The absolute path to the file to write.
    pub file_path: String,
    /// The content to write to the file.
    pub content: String,
}

pub async fn execute(input: &FSWriteInput, state: &Arc<ToolState>) -> Result<String, String> {
    let resolved = resolve_path(&input.file_path, &state.root_path);
    let path_owned = resolved.to_string_lossy().to_string();
    let path = path_owned.as_str();

    // Block writes to protected files (eval sandboxing)
    if state.blocked_files.iter().any(|b| resolved.ends_with(b) || &resolved == b) {
        return Err(format!("Access denied: {path} is a protected file"));
    }

    // Read-before-edit enforcement: reject writes to files not previously read
    let file_exists = tokio::fs::metadata(path).await.is_ok();
    if file_exists && !state.has_read(path).await {
        return Err(read_first_err(path, "writing to"));
    }

    // Create parent directories if needed
    if let Some(parent) = Path::new(path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| io_err("create directory for", path, e))?;
    }

    tokio::fs::write(path, &input.content)
        .await
        .map_err(|e| io_err("write file", path, e))?;

    let line_count = input.content.lines().count();
    let warning = if looks_like_line_numbered_dump(&input.content) {
        "\nWARNING: The content you wrote appears to have `N: ` line-number prefixes on most lines. \
         These prefixes come from the `read` tool's display format and are NOT part of the actual \
         file content. The file was written VERBATIM as you provided it, so it now contains those \
         prefixes as literal text. You probably want to re-write this file without the `N: ` prefixes."
    } else {
        ""
    };
    Ok(format!("Successfully wrote {line_count} lines to '{path}'.{warning}"))
}

/// Returns true if most non-empty lines in `s` look like `N: <content>` (the read tool's display
/// format). Used to warn the model when it accidentally writes content with line-number prefixes.
fn looks_like_line_numbered_dump(s: &str) -> bool {
    let lines: Vec<&str> = s.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.len() < 2 {
        return false;
    }
    let prefixed = lines.iter().filter(|l| line_has_number_prefix(l)).count();
    // Trigger if ≥ 80% of non-empty lines look prefixed.
    prefixed * 5 >= lines.len() * 4
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use crate::agent::tools::fs_read;
    use crate::agent::tools::test_helpers::{make_state, make_temp_file};

    #[tokio::test]
    async fn write_new_file_succeeds() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("new_file.txt");
        let state = make_state();

        let input = FSWriteInput {
            file_path: path.to_str().unwrap().into(),
            content: "hello\nworld\n".into(),
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("Successfully wrote"));
        assert!(result.contains("2 lines"));

        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert_eq!(on_disk, "hello\nworld\n");
    }

    #[tokio::test]
    async fn write_existing_file_rejected_without_read() {
        let f = make_temp_file("existing content");
        let state = make_state();

        let input = FSWriteInput {
            file_path: f.path().to_str().unwrap().into(),
            content: "new content".into(),
        };
        let result = execute(&input, &state).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must read"));
    }

    #[tokio::test]
    async fn write_existing_file_after_read_succeeds() {
        let f = make_temp_file("old content");
        let state = make_state();
        let path_str = f.path().to_str().unwrap().to_string();

        let read_input = fs_read::FSReadInput {
            file_path: path_str.clone(),
            start_line: None,
            end_line: None,
        };
        fs_read::execute(&read_input, &state).await.unwrap();

        let input = FSWriteInput {
            file_path: path_str.clone(),
            content: "new content".into(),
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("Successfully wrote"));

        let on_disk = std::fs::read_to_string(&path_str).unwrap();
        assert_eq!(on_disk, "new content");
    }

    #[tokio::test]
    async fn write_creates_parent_directories() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("a").join("b").join("c").join("file.txt");
        let state = make_state();

        let input = FSWriteInput {
            file_path: path.to_str().unwrap().into(),
            content: "deep file".into(),
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("Successfully wrote"));
        assert!(path.exists());
    }

    #[tokio::test]
    async fn write_empty_content() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("empty.txt");
        let state = make_state();

        let input = FSWriteInput {
            file_path: path.to_str().unwrap().into(),
            content: "".into(),
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("0 lines"));
    }
}
