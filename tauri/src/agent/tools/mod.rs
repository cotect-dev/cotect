pub mod fs_read;
pub mod fs_write;
pub mod fs_patch;
pub mod fs_search;
pub mod shell;
pub mod fetch;

#[cfg(test)]
pub(crate) mod test_helpers;

pub const MAX_OUTPUT: usize = 100 * 1024; // 100 KB
pub const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10 MB

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use schemars::JsonSchema;
use serde::de::DeserializeOwned;
use tokio::sync::Mutex;

use super::types::{FunctionDef, ToolCall, ToolDefinition, AgentRole};

/// Shared state across tool executions within a single task.
#[derive(Debug)]
pub struct ToolState {
    pub read_files: Mutex<HashSet<PathBuf>>,
    pub root_path: String,
    /// Absolute paths the agent is not allowed to read (eval-only).
    pub blocked_files: Vec<PathBuf>,
}

impl ToolState {
    pub fn new(root_path: String) -> Arc<Self> {
        Arc::new(Self {
            read_files: Mutex::new(HashSet::new()),
            root_path,
            blocked_files: Vec::new(),
        })
    }

    pub fn with_blocked_files(root_path: String, blocked_files: Vec<String>) -> Arc<Self> {
        Arc::new(Self {
            read_files: Mutex::new(HashSet::new()),
            blocked_files: blocked_files.into_iter().map(PathBuf::from).collect(),
            root_path,
        })
    }

    pub async fn mark_read(&self, path: &str) {
        self.read_files.lock().await.insert(PathBuf::from(path));
    }

    pub async fn has_read(&self, path: &str) -> bool {
        self.read_files.lock().await.contains(&PathBuf::from(path))
    }
}

/// Parse JSON arguments into the expected type, returning a consistent error.
fn parse_args<T: DeserializeOwned>(args: &str) -> Result<T, String> {
    serde_json::from_str(args).map_err(|e| format!("Invalid arguments: {e}"))
}

/// Execute a tool call and return the result string.
pub async fn execute_tool(
    tool_call: &ToolCall,
    state: &Arc<ToolState>,
) -> Result<String, String> {
    let name = tool_call.function.name.as_str();
    let args = &tool_call.function.arguments;

    match name {
        "__format_error__" => {
            // Tool-call parse failed in the adapter layer.
            // The arguments field contains the raw malformed text.
            // Return a clear error explaining the required format.
            Err(format!(
                "Tool call could not be parsed. Your output was:\n\
                 {args}\n\n\
                 Tool calls MUST use valid JSON with double-quoted strings. \
                 Correct format inside <|tool_call>...<tool_call|> tags:\n\
                 {{\"name\": \"tool_name\", \"arguments\": {{\"param\": \"value\"}}}}\n\n\
                 Please retry with properly quoted JSON arguments."
            ))
        }
        "read" => fs_read::execute(&parse_args(args)?, state).await,
        "write" => fs_write::execute(&parse_args(args)?, state).await,
        "patch" => fs_patch::execute(&parse_args(args)?, state).await,
        "fs_search" => fs_search::execute(&parse_args(args)?, state).await,
        "shell" => shell::execute(&parse_args(args)?, state).await,
        "fetch" => fetch::execute(&parse_args(args)?).await,
        _ => Err(format!("Unknown tool: {name}")),
    }
}

/// Extract a file_path from a tool call's arguments (for UI indicators).
pub fn extract_file_path(func: &super::types::FunctionCall) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(&func.arguments)
        .ok()
        .and_then(|v| {
            v.get("file_path")
                .or(v.get("path"))
                .and_then(|p| p.as_str())
                .map(String::from)
        })
}

/// Generate all tool definitions for the LLM.
pub fn all_definitions() -> Vec<ToolDefinition> {
    vec![
        make_def::<fs_read::FSReadInput>(
            "read",
            "Read a file from the filesystem. Returns the file content with each line prefixed by its \
             1-indexed line number in the format `N: <content>` (e.g. `1: first line\\n2: second line`). \
             The `N: ` prefix is added by this tool for your reference ONLY — it is NOT part of the \
             actual file content. When using `patch` or `write` afterwards, you MUST strip these \
             prefixes: target only the raw content after `N: ` in your old_string/content arguments. \
             You can optionally specify start_line and end_line to read a specific range.",
        ),
        make_def::<fs_write::FSWriteInput>(
            "write",
            "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. \
             You MUST read the file first before writing to it. The `content` parameter is written \
             verbatim — do NOT include the `N: ` line-number prefixes that the `read` tool shows you; \
             those are display-only and not part of the actual file.",
        ),
        make_def::<fs_patch::FSPatchInput>(
            "patch",
            "Replace an exact string in a file. The old_string must appear exactly once in the file. \
             You MUST read the file first before patching it. The `old_string` and `new_string` \
             parameters must NOT contain the `N: ` line-number prefixes that the `read` tool shows — \
             those are display-only and not part of the file's actual content.",
        ),
        make_def::<fs_search::FSSearchInput>(
            "fs_search",
            "Search for a regex pattern across files. Returns matching lines with file paths \
             and line numbers. Optionally filter by glob pattern.",
        ),
        make_def::<shell::ShellInput>(
            "shell",
            "Execute a shell command and return its output. Use for running builds, tests, \
             git operations, package managers, etc. Commands have a 120-second timeout.",
        ),
        make_def::<fetch::FetchInput>(
            "fetch",
            "Fetch content from a URL. Returns the response body as text. \
             Useful for reading documentation or API responses.",
        ),
    ]
}

/// Return tool definitions filtered by agent role.
pub fn definitions_for_role(role: AgentRole) -> Vec<ToolDefinition> {
    let all = all_definitions();
    let allowed: &[&str] = match role {
        AgentRole::Implement => &["read", "write", "patch", "fs_search", "shell", "fetch"],
        AgentRole::Research => &["read", "fs_search", "fetch"],
        AgentRole::Plan => &["read", "fs_search", "fetch"],
    };
    all.into_iter()
        .filter(|d| allowed.contains(&d.function.name.as_str()))
        .collect()
}

fn make_def<T: JsonSchema>(name: &str, description: &str) -> ToolDefinition {
    let schema = schemars::schema_for!(T);
    let mut params = serde_json::to_value(schema).unwrap_or(serde_json::json!({}));

    // Clean up the schema for OpenAI compatibility
    if let Some(obj) = params.as_object_mut() {
        obj.remove("$schema");
        obj.remove("title");
    }

    ToolDefinition {
        def_type: "function".into(),
        function: FunctionDef {
            name: name.into(),
            description: description.into(),
            parameters: params,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_all_definitions_returns_6_tools() {
        let defs = all_definitions();
        assert_eq!(defs.len(), 6);
    }

    #[test]
    fn test_all_definitions_have_function_type() {
        for def in all_definitions() {
            assert_eq!(def.def_type, "function");
            assert!(!def.function.name.is_empty());
            assert!(!def.function.description.is_empty());
        }
    }

    #[test]
    fn test_definitions_for_implement_returns_all() {
        let defs = definitions_for_role(AgentRole::Implement);
        assert_eq!(defs.len(), 6);
    }

    #[test]
    fn test_definitions_for_research_readonly() {
        let defs = definitions_for_role(AgentRole::Research);
        let names: Vec<&str> = defs.iter().map(|d| d.function.name.as_str()).collect();
        assert!(names.contains(&"read"));
        assert!(names.contains(&"fs_search"));
        assert!(names.contains(&"fetch"));
        assert!(!names.contains(&"write"));
        assert!(!names.contains(&"patch"));
        assert!(!names.contains(&"shell"));
    }

    #[test]
    fn test_definitions_for_plan_readonly() {
        let defs = definitions_for_role(AgentRole::Plan);
        let names: Vec<&str> = defs.iter().map(|d| d.function.name.as_str()).collect();
        assert_eq!(names.len(), 3);
        assert!(names.contains(&"read"));
        assert!(names.contains(&"fs_search"));
        assert!(names.contains(&"fetch"));
    }

    #[test]
    fn test_extract_file_path_from_file_path_key() {
        let func = super::super::types::FunctionCall {
            name: "read".into(),
            arguments: r#"{"file_path": "/tmp/test.txt"}"#.into(),
        };
        assert_eq!(extract_file_path(&func), Some("/tmp/test.txt".into()));
    }

    #[test]
    fn test_extract_file_path_from_path_key() {
        let func = super::super::types::FunctionCall {
            name: "fs_search".into(),
            arguments: r#"{"pattern": "test", "path": "/src"}"#.into(),
        };
        assert_eq!(extract_file_path(&func), Some("/src".into()));
    }

    #[test]
    fn test_extract_file_path_missing() {
        let func = super::super::types::FunctionCall {
            name: "shell".into(),
            arguments: r#"{"command": "ls"}"#.into(),
        };
        assert_eq!(extract_file_path(&func), None);
    }

    #[test]
    fn test_extract_file_path_invalid_json() {
        let func = super::super::types::FunctionCall {
            name: "read".into(),
            arguments: "not json".into(),
        };
        assert_eq!(extract_file_path(&func), None);
    }

    #[test]
    fn test_tool_schemas_are_valid_json() {
        for def in all_definitions() {
            assert!(def.function.parameters.is_object(), "Schema for {} is not an object", def.function.name);
            // Should not contain $schema key (OpenAI compat)
            assert!(
                def.function.parameters.get("$schema").is_none(),
                "Schema for {} should not have $schema", def.function.name
            );
        }
    }

    #[tokio::test]
    async fn test_execute_unknown_tool_returns_error() {
        let tool_call = super::super::types::ToolCall {
            id: "call_1".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "nonexistent".into(),
                arguments: "{}".into(),
            },
        };
        let state = ToolState::new("/tmp".into());
        let result = execute_tool(&tool_call, &state).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unknown tool"));
    }

    #[tokio::test]
    async fn test_tool_state_read_tracking() {
        let state = ToolState::new("/project".into());
        assert!(!state.has_read("/project/test.txt").await);

        state.mark_read("/project/test.txt").await;
        assert!(state.has_read("/project/test.txt").await);
        assert!(!state.has_read("/project/other.txt").await);
    }

    // ─── Integrated tool dispatch tests ─────────────────────────────────

    #[tokio::test]
    async fn test_execute_tool_read_real_file() {
        use std::io::Write;
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(b"line one\nline two\n").unwrap();
        f.flush().unwrap();
        let path = f.path().to_str().unwrap();

        let tool_call = ToolCall {
            id: "call_r".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "read".into(),
                arguments: format!(r#"{{"file_path":"{}"}}"#, path),
            },
        };
        let state = ToolState::new("/tmp".into());
        let result = execute_tool(&tool_call, &state).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        assert!(output.contains("1: line one"));
        assert!(output.contains("2: line two"));
    }

    #[tokio::test]
    async fn test_execute_tool_write_new_file() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("written.txt");
        let path_str = path.to_str().unwrap();

        let tool_call = ToolCall {
            id: "call_w".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "write".into(),
                arguments: format!(r#"{{"file_path":"{}","content":"hello dispatch"}}"#, path_str),
            },
        };
        let state = ToolState::new("/tmp".into());
        let result = execute_tool(&tool_call, &state).await;
        assert!(result.is_ok());
        assert!(std::fs::read_to_string(&path).unwrap().contains("hello dispatch"));
    }

    #[tokio::test]
    async fn test_execute_tool_shell_echo() {
        let tool_call = ToolCall {
            id: "call_s".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "shell".into(),
                arguments: r#"{"command":"echo dispatched"}"#.into(),
            },
        };
        let state = ToolState::new("/tmp".into());
        let result = execute_tool(&tool_call, &state).await.unwrap();
        assert!(result.contains("dispatched"));
    }

    #[tokio::test]
    async fn test_execute_tool_search_real_dir() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(dir.path().join("target.txt"), "unique_marker_1234\n").unwrap();

        let tool_call = ToolCall {
            id: "call_fs".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "fs_search".into(),
                arguments: format!(r#"{{"pattern":"unique_marker_1234","path":"{}"}}"#, dir.path().to_str().unwrap()),
            },
        };
        let state = ToolState::new(dir.path().to_str().unwrap().into());
        let result = execute_tool(&tool_call, &state).await.unwrap();
        assert!(result.contains("unique_marker_1234"));
    }

    #[tokio::test]
    async fn test_execute_tool_invalid_json_args() {
        let tool_call = ToolCall {
            id: "call_bad".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "read".into(),
                arguments: "not valid json".into(),
            },
        };
        let state = ToolState::new("/tmp".into());
        let result = execute_tool(&tool_call, &state).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid arguments"));
    }

    #[tokio::test]
    async fn test_read_then_patch_workflow() {
        use std::io::Write;
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(b"original content here\n").unwrap();
        f.flush().unwrap();
        let path = f.path().to_str().unwrap();

        let state = ToolState::new("/tmp".into());

        // Step 1: Read the file
        let read_call = ToolCall {
            id: "c1".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "read".into(),
                arguments: format!(r#"{{"file_path":"{}"}}"#, path),
            },
        };
        let read_result = execute_tool(&read_call, &state).await.unwrap();
        assert!(read_result.contains("original content"));

        // Step 2: Patch the file
        let patch_call = ToolCall {
            id: "c2".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "patch".into(),
                arguments: format!(r#"{{"file_path":"{}","old_string":"original content here","new_string":"modified content here"}}"#, path),
            },
        };
        let patch_result = execute_tool(&patch_call, &state).await.unwrap();
        assert!(patch_result.contains("Successfully patched"));

        // Verify
        let on_disk = std::fs::read_to_string(path).unwrap();
        assert!(on_disk.contains("modified content here"));
    }

    #[tokio::test]
    async fn test_read_then_write_workflow() {
        use std::io::Write;
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(b"old content").unwrap();
        f.flush().unwrap();
        let path = f.path().to_str().unwrap();

        let state = ToolState::new("/tmp".into());

        // Read first
        let read_call = ToolCall {
            id: "c1".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "read".into(),
                arguments: format!(r#"{{"file_path":"{}"}}"#, path),
            },
        };
        execute_tool(&read_call, &state).await.unwrap();

        // Then write
        let write_call = ToolCall {
            id: "c2".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "write".into(),
                arguments: format!(r#"{{"file_path":"{}","content":"completely new content"}}"#, path),
            },
        };
        let write_result = execute_tool(&write_call, &state).await.unwrap();
        assert!(write_result.contains("Successfully wrote"));
    }

    #[tokio::test]
    async fn test_tool_state_multiple_reads() {
        let state = ToolState::new("/project".into());
        state.mark_read("/project/a.txt").await;
        state.mark_read("/project/b.txt").await;
        state.mark_read("/project/c.txt").await;

        assert!(state.has_read("/project/a.txt").await);
        assert!(state.has_read("/project/b.txt").await);
        assert!(state.has_read("/project/c.txt").await);
        assert!(!state.has_read("/project/d.txt").await);
    }

    #[tokio::test]
    async fn test_tool_state_duplicate_reads() {
        let state = ToolState::new("/project".into());
        state.mark_read("/project/a.txt").await;
        state.mark_read("/project/a.txt").await; // Idempotent
        assert!(state.has_read("/project/a.txt").await);
    }
}
