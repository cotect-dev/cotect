use std::fmt::Write;
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

pub async fn execute(input: &FSReadInput, state: &Arc<ToolState>) -> Result<String, String> {
    let path = &input.file_path;

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
