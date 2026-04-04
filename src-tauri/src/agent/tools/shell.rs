use std::sync::Arc;
use std::time::Duration;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use super::ToolState;

const TIMEOUT: Duration = Duration::from_secs(120);
const MAX_OUTPUT: usize = 100 * 1024; // 100 KB

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ShellInput {
    /// The shell command to execute.
    pub command: String,
    /// Working directory. Defaults to the project root.
    #[serde(default)]
    pub cwd: Option<String>,
    /// Brief description of what this command does (for logging).
    #[serde(default)]
    pub description: Option<String>,
}

pub async fn execute(input: &ShellInput, state: &Arc<ToolState>) -> Result<String, String> {
    let cwd = input.cwd.as_deref().unwrap_or(&state.root_path);

    let result = tokio::time::timeout(TIMEOUT, async {
        Command::new("sh")
            .arg("-c")
            .arg(&input.command)
            .current_dir(cwd)
            .output()
            .await
    })
    .await;

    match result {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let exit_code = output.status.code().unwrap_or(-1);

            let mut result = String::new();

            if !stdout.is_empty() {
                let out = if stdout.len() > MAX_OUTPUT {
                    format!(
                        "{}\n\n[stdout truncated at {MAX_OUTPUT} bytes]",
                        &stdout[..MAX_OUTPUT]
                    )
                } else {
                    stdout.into_owned()
                };
                result.push_str(&out);
            }

            if !stderr.is_empty() {
                if !result.is_empty() {
                    result.push_str("\n\n--- stderr ---\n");
                }
                let err = if stderr.len() > MAX_OUTPUT {
                    format!(
                        "{}\n\n[stderr truncated at {MAX_OUTPUT} bytes]",
                        &stderr[..MAX_OUTPUT]
                    )
                } else {
                    stderr.into_owned()
                };
                result.push_str(&err);
            }

            if result.is_empty() {
                result = format!("Command completed with exit code {exit_code}. No output.");
            } else {
                result.push_str(&format!("\n\n[exit code: {exit_code}]"));
            }

            if exit_code == 0 {
                Ok(result)
            } else {
                // Return as Ok but with error indication — the LLM should see the output
                Ok(result)
            }
        }
        Ok(Err(e)) => Err(format!("Failed to execute command: {e}")),
        Err(_) => Err(format!(
            "Command timed out after {} seconds.",
            TIMEOUT.as_secs()
        )),
    }
}
