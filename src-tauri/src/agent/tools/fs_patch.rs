use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::ToolState;
use crate::agent::utils::{io_err, read_first_err};

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
    let path = &input.file_path;

    // Read-before-edit enforcement
    if !state.has_read(path).await {
        return Err(read_first_err(path, "patching"));
    }

    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| io_err("read file", path, e))?;

    if input.old_string == input.new_string {
        return Err("old_string and new_string are identical. No change needed.".into());
    }

    // Count occurrences
    let count = content.matches(&input.old_string).count();
    match count {
        0 => Err(format!(
            "The old_string was not found in '{path}'. Make sure you're using the exact text from the file."
        )),
        1 => {
            let new_content = content.replacen(&input.old_string, &input.new_string, 1);
            tokio::fs::write(path, &new_content)
                .await
                .map_err(|e| io_err("write file", path, e))?;
            Ok(format!("Successfully patched '{path}'."))
        }
        n => Err(format!(
            "The old_string appears {n} times in '{path}'. It must appear exactly once. \
             Provide more surrounding context to make it unique."
        )),
    }
}
