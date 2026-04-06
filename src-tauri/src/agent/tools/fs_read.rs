use std::fmt::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::ToolState;
use crate::agent::utils::io_err;

const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10 MB

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
    let path_buf = resolved.clone();
    let path = path_buf.to_string_lossy().to_string();
    let path = path.as_str();

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

    // Mark as read for write/patch enforcement
    state.mark_read(path).await;

    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len();

    let start = input.start_line.unwrap_or(1).max(1) as usize;
    let end = input.end_line.map(|e| e as usize).unwrap_or(total).min(total);

    if start > total {
        return Ok(format!("File '{path}' has {total} lines; start_line {start} is beyond the end."));
    }

    // Only iterate the requested slice (0-indexed: start-1 .. end)
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
    use std::io::Write as IoWrite;
    use tempfile::NamedTempFile;

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
        // No range indicator for full file
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
}
