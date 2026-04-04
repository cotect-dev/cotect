use std::path::Path;
use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::ToolState;
use crate::agent::utils::{io_err, read_first_err};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FSWriteInput {
    /// The absolute path to the file to write.
    pub file_path: String,
    /// The content to write to the file.
    pub content: String,
}

pub async fn execute(input: &FSWriteInput, state: &Arc<ToolState>) -> Result<String, String> {
    let path = &input.file_path;

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
    Ok(format!("Successfully wrote {line_count} lines to '{path}'."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as IoWrite;
    use tempfile::{NamedTempFile, TempDir};
    use crate::agent::tools::fs_read;

    fn make_state() -> Arc<ToolState> {
        ToolState::new("/tmp".into())
    }

    fn make_temp_file(content: &str) -> NamedTempFile {
        let mut f = NamedTempFile::new().unwrap();
        f.write_all(content.as_bytes()).unwrap();
        f.flush().unwrap();
        f
    }

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

        // Read first (using the read tool to mark it)
        let read_input = fs_read::FSReadInput {
            file_path: path_str.clone(),
            start_line: None,
            end_line: None,
        };
        fs_read::execute(&read_input, &state).await.unwrap();

        // Now write should succeed
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
