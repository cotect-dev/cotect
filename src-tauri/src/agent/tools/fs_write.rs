use std::path::Path;
use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::ToolState;

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
        return Err(format!(
            "You must read '{path}' before writing to it. Use the read tool first."
        ));
    }

    // Create parent directories if needed
    if let Some(parent) = Path::new(path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Cannot create directory for '{path}': {e}"))?;
    }

    tokio::fs::write(path, &input.content)
        .await
        .map_err(|e| format!("Cannot write file '{path}': {e}"))?;

    let line_count = input.content.lines().count();
    Ok(format!("Successfully wrote {line_count} lines to '{path}'."))
}
