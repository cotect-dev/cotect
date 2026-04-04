use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use super::ToolState;

const MAX_OUTPUT: usize = 100 * 1024; // 100 KB

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FSSearchInput {
    /// The regex pattern to search for.
    pub pattern: String,
    /// Directory or file path to search in. Defaults to the project root.
    #[serde(default)]
    pub path: Option<String>,
    /// Glob pattern to filter files (e.g., "*.ts", "*.rs").
    #[serde(default)]
    pub glob: Option<String>,
    /// Number of context lines to show before and after each match.
    #[serde(default)]
    pub context_lines: Option<u32>,
}

pub async fn execute(input: &FSSearchInput, state: &Arc<ToolState>) -> Result<String, String> {
    let search_path = input.path.as_deref().unwrap_or(&state.root_path);

    // Try ripgrep first, fall back to grep
    let result = try_ripgrep(input, search_path).await;
    match result {
        Ok(output) => Ok(output),
        Err(_) => try_grep(input, search_path).await,
    }
}

async fn try_ripgrep(input: &FSSearchInput, search_path: &str) -> Result<String, String> {
    let mut cmd = Command::new("rg");
    cmd.arg("--line-number")
        .arg("--no-heading")
        .arg("--color=never")
        .arg("--max-count=100");

    if let Some(ctx) = input.context_lines {
        cmd.arg(format!("-C{ctx}"));
    }

    if let Some(glob) = &input.glob {
        cmd.arg("--glob").arg(glob);
    }

    cmd.arg(&input.pattern).arg(search_path);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("ripgrep not available: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // rg returns exit code 1 for "no matches" which is not an error
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(format!("ripgrep error: {stderr}"));
    }

    let result = if stdout.len() > MAX_OUTPUT {
        format!(
            "{}\n\n[Output truncated at {MAX_OUTPUT} bytes]",
            &stdout[..MAX_OUTPUT]
        )
    } else if stdout.is_empty() {
        "No matches found.".into()
    } else {
        stdout.into_owned()
    };

    Ok(result)
}

async fn try_grep(input: &FSSearchInput, search_path: &str) -> Result<String, String> {
    let mut cmd = Command::new("grep");
    cmd.arg("-rn")
        .arg("--color=never")
        .arg("-E")
        .arg(&input.pattern)
        .arg(search_path);

    if let Some(glob) = &input.glob {
        cmd.arg("--include").arg(glob);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("grep failed: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    if stdout.is_empty() {
        Ok("No matches found.".into())
    } else if stdout.len() > MAX_OUTPUT {
        Ok(format!(
            "{}\n\n[Output truncated at {MAX_OUTPUT} bytes]",
            &stdout[..MAX_OUTPUT]
        ))
    } else {
        Ok(stdout.into_owned())
    }
}
