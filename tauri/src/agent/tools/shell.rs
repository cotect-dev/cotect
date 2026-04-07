use std::sync::Arc;
use std::time::Duration;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use super::ToolState;
use crate::agent::utils::truncate_bytes;

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
    // Cheat detection: flag when a shell command appears to read a blocked file.
    // We don't block the command — just prepend a marker to the output so
    // it shows up in transcripts without breaking the progress line.
    let mut cheat_flag = false;
    if !state.blocked_files.is_empty() {
        let read_cmds = [
            "cat ", "head ", "tail ", "less ", "more ", "grep ",
            "egrep ", "fgrep ", "awk ", "sed ", "bat ", "strings ",
        ];
        let cmd = input.command.as_str();
        for blocked in &state.blocked_files {
            let name = blocked
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if name.is_empty() || !cmd.contains(&name) {
                continue;
            }
            if read_cmds.iter().any(|rc| cmd.contains(rc)) {
                cheat_flag = true;
            }
        }
    }

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
                result.push_str(&truncate_bytes(&stdout, MAX_OUTPUT, &format!("stdout truncated at {MAX_OUTPUT} bytes")));
            }

            if !stderr.is_empty() {
                if !result.is_empty() {
                    result.push_str("\n\n--- stderr ---\n");
                }
                result.push_str(&truncate_bytes(&stderr, MAX_OUTPUT, &format!("stderr truncated at {MAX_OUTPUT} bytes")));
            }

            if result.is_empty() {
                result = format!("Command completed with exit code {exit_code}. No output.");
            } else {
                result.push_str(&format!("\n\n[exit code: {exit_code}]"));
            }

            if cheat_flag {
                result.insert_str(0, "[EVAL CHEAT DETECTED] Model used shell to read a blocked test file.\n\n");
            }

            Ok(result)
        }
        Ok(Err(e)) => Err(format!("Failed to execute command: {e}")),
        Err(_) => Err(format!(
            "Command timed out after {} seconds.",
            TIMEOUT.as_secs()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_state() -> Arc<ToolState> {
        ToolState::new("/tmp".into())
    }

    #[tokio::test]
    async fn shell_echo_captures_stdout() {
        let state = make_state();
        let input = ShellInput {
            command: "echo hello world".into(),
            cwd: None,
            description: Some("test echo".into()),
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("hello world"));
        assert!(result.contains("[exit code: 0]"));
    }

    #[tokio::test]
    async fn shell_captures_stderr() {
        let state = make_state();
        let input = ShellInput {
            command: "echo err >&2".into(),
            cwd: None,
            description: None,
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("err"));
    }

    #[tokio::test]
    async fn shell_nonzero_exit_code() {
        let state = make_state();
        let input = ShellInput {
            command: "echo fail && exit 42".into(),
            cwd: None,
            description: None,
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("exit code: 42"));
    }

    #[tokio::test]
    async fn shell_uses_cwd() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("marker.txt"), "found").unwrap();
        let state = make_state();

        let input = ShellInput {
            command: "cat marker.txt".into(),
            cwd: Some(dir.path().to_str().unwrap().into()),
            description: None,
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("found"));
    }

    #[tokio::test]
    async fn shell_defaults_to_root_path() {
        let state = ToolState::new("/tmp".into());
        let input = ShellInput {
            command: "pwd".into(),
            cwd: None,
            description: None,
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("/tmp"));
    }

    #[tokio::test]
    async fn shell_empty_output() {
        let state = make_state();
        let input = ShellInput {
            command: "true".into(),
            cwd: None,
            description: None,
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("No output"));
    }

    #[tokio::test]
    async fn shell_combined_stdout_and_stderr() {
        let state = make_state();
        let input = ShellInput {
            command: "echo out && echo err >&2".into(),
            cwd: None,
            description: None,
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("out"));
        assert!(result.contains("stderr"));
        assert!(result.contains("err"));
    }

    #[tokio::test]
    async fn shell_multiline_output() {
        let state = make_state();
        let input = ShellInput {
            command: "printf 'line1\\nline2\\nline3\\n'".into(),
            cwd: None,
            description: None,
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("line1"));
        assert!(result.contains("line2"));
        assert!(result.contains("line3"));
    }
}
