use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use super::ToolState;
use super::fs_read::resolve_path;
use crate::agent::utils::truncate_bytes;

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
    let search_path = match input.path.as_deref() {
        Some(p) => resolve_path(p, &state.root_path).to_string_lossy().to_string(),
        None => state.root_path.clone(),
    };

    // Try ripgrep first, fall back to grep
    let result = try_ripgrep(input, &search_path).await;
    match result {
        Ok(output) => Ok(output),
        Err(rg_err) => {
            eprintln!("ripgrep failed, falling back to grep: {rg_err}");
            try_grep(input, &search_path).await
        }
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

    let result = if stdout.is_empty() {
        "No matches found.".into()
    } else {
        truncate_bytes(&stdout, super::MAX_OUTPUT, &format!("Output truncated at {} bytes", super::MAX_OUTPUT))
    };

    Ok(result)
}

async fn try_grep(input: &FSSearchInput, search_path: &str) -> Result<String, String> {
    let mut cmd = Command::new("grep");
    cmd.arg("-rn")
        .arg("--color=never")
        .arg("-E")
        .arg("-m").arg("100")
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
    } else {
        Ok(truncate_bytes(&stdout, super::MAX_OUTPUT, &format!("Output truncated at {} bytes", super::MAX_OUTPUT)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_state_for(path: &str) -> Arc<ToolState> {
        ToolState::new(path.into())
    }

    fn setup_search_dir() -> TempDir {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("hello.txt"), "hello world\nfoo bar\nhello again\n").unwrap();
        std::fs::write(dir.path().join("test.rs"), "fn main() {\n    println!(\"test\");\n}\n").unwrap();
        std::fs::write(dir.path().join("data.ts"), "export const x = 42;\nexport const y = 99;\n").unwrap();
        dir
    }

    #[tokio::test]
    async fn search_finds_pattern_in_files() {
        let dir = setup_search_dir();
        let state = make_state_for(dir.path().to_str().unwrap());

        let input = FSSearchInput {
            pattern: "hello".into(),
            path: Some(dir.path().to_str().unwrap().into()),
            glob: None,
            context_lines: None,
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("hello world"));
        assert!(result.contains("hello again"));
    }

    #[tokio::test]
    async fn search_no_matches() {
        let dir = setup_search_dir();
        let state = make_state_for(dir.path().to_str().unwrap());

        let input = FSSearchInput {
            pattern: "zzzznonexistent".into(),
            path: Some(dir.path().to_str().unwrap().into()),
            glob: None,
            context_lines: None,
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("No matches found"));
    }

    #[tokio::test]
    async fn search_with_glob_filter() {
        let dir = setup_search_dir();
        let state = make_state_for(dir.path().to_str().unwrap());

        let input = FSSearchInput {
            pattern: "export".into(),
            path: Some(dir.path().to_str().unwrap().into()),
            glob: Some("*.ts".into()),
            context_lines: None,
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("export const x"));
        // Should not match .rs or .txt files
        assert!(!result.contains("fn main"));
    }

    #[tokio::test]
    async fn search_with_context_lines() {
        let dir = setup_search_dir();
        let state = make_state_for(dir.path().to_str().unwrap());

        let input = FSSearchInput {
            pattern: "println".into(),
            path: Some(dir.path().to_str().unwrap().into()),
            glob: None,
            context_lines: Some(1),
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("println"));
        // Context lines may or may not be shown depending on rg vs grep availability
    }

    #[tokio::test]
    async fn search_regex_pattern() {
        let dir = setup_search_dir();
        let state = make_state_for(dir.path().to_str().unwrap());

        // Use POSIX-compatible regex that works with both rg and grep -E
        let input = FSSearchInput {
            pattern: r"const [a-zA-Z_]+ = [0-9]+".into(),
            path: Some(dir.path().to_str().unwrap().into()),
            glob: None,
            context_lines: None,
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("const x = 42"));
        assert!(result.contains("const y = 99"));
    }

    #[tokio::test]
    async fn search_defaults_to_root_path() {
        let dir = setup_search_dir();
        let state = make_state_for(dir.path().to_str().unwrap());

        let input = FSSearchInput {
            pattern: "foo bar".into(),
            path: None, // Should use state.root_path
            glob: None,
            context_lines: None,
        };
        let result = execute(&input, &state).await.unwrap();
        assert!(result.contains("foo bar"));
    }
}
