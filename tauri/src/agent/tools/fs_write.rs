use std::path::Path;
use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::ToolState;
use super::fs_patch::number_lines;
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

    // Read-before-edit enforcement: reject overwrites of files not previously read.
    let file_exists = tokio::fs::metadata(path).await.is_ok();
    if file_exists && !state.has_read(path).await {
        return Err(read_first_err(path, "writing to"));
    }

    // Create parent directories if needed.
    if let Some(parent) = Path::new(path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| io_err("create directory for", path, e))?;
    }

    tokio::fs::write(path, &input.content)
        .await
        .map_err(|e| io_err("write file", path, e))?;

    state.mark_read(path).await;

    // If the model accidentally wrote line-number-prefixed content
    // (mistaking `read`'s display format for the actual file body),
    // surface it as an error response — the file is now genuinely
    // wrong on disk and a re-write is the right next step.
    if looks_like_line_numbered_dump(&input.content) {
        return Ok(format!(
            "WARNING: the content you wrote appears to have `N: ` line-number prefixes on \
             most lines. Those come from `read`'s display format and are NOT part of the \
             actual file content. The file was written verbatim — meaning it now contains \
             those prefixes as literal text. Re-issue `write` (or `patch`) without the \
             `N: ` prefixes.\n\nCurrent file contents:\n\n{}",
            number_lines(&input.content),
        ));
    }

    // Return the post-write file body in `read`-shape so the model
    // sees what it just put on disk — no separate read needed.
    Ok(number_lines(&input.content))
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
    async fn write_new_file_returns_post_write_body() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("new_file.txt");
        let state = make_state();

        let input = FSWriteInput {
            file_path: path.to_str().unwrap().into(),
            content: "hello\nworld\n".into(),
        };
        let response = execute(&input, &state).await.unwrap();
        // Response is the post-write file body in `read` shape.
        assert_eq!(response, "1: hello\n2: world\n");

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
            file_path: Some(path_str.clone()),
            file_paths: None,
            start_line: None,
            end_line: None,
        };
        fs_read::execute(&read_input, &state).await.unwrap();

        let input = FSWriteInput {
            file_path: path_str.clone(),
            content: "new content".into(),
        };
        let response = execute(&input, &state).await.unwrap();
        assert_eq!(response, "1: new content\n");

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
        execute(&input, &state).await.unwrap();
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
        let response = execute(&input, &state).await.unwrap();
        // Empty file → empty response.
        assert_eq!(response, "");
    }

    #[tokio::test]
    async fn write_warns_on_line_numbered_dump() {
        // The model accidentally pasted `read` output as content.
        // The file is now wrong; surface the issue with the body
        // inline so the model can re-issue cleanly.
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("oops.txt");
        let state = make_state();

        let bad = "1: import os\n2: \n3: def foo():\n4:     return None\n";
        let input = FSWriteInput {
            file_path: path.to_str().unwrap().into(),
            content: bad.into(),
        };
        let response = execute(&input, &state).await.unwrap();
        assert!(response.contains("WARNING"));
        assert!(response.contains("`N: ` prefixes"));
    }
}
