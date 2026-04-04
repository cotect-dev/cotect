pub mod fs_read;
pub mod fs_write;
pub mod fs_patch;
pub mod fs_search;
pub mod shell;
pub mod fetch;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use schemars::JsonSchema;
use tokio::sync::Mutex;

use super::types::{FunctionDef, ToolCall, ToolDefinition, AgentRole};

/// Shared state across tool executions within a single task.
#[derive(Debug)]
pub struct ToolState {
    pub read_files: Mutex<HashSet<PathBuf>>,
    pub root_path: String,
}

impl ToolState {
    pub fn new(root_path: String) -> Arc<Self> {
        Arc::new(Self {
            read_files: Mutex::new(HashSet::new()),
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

/// Execute a tool call and return the result string.
pub async fn execute_tool(
    tool_call: &ToolCall,
    state: &Arc<ToolState>,
) -> Result<String, String> {
    let name = tool_call.function.name.as_str();
    let args = &tool_call.function.arguments;

    match name {
        "read" => {
            let input: fs_read::FSReadInput =
                serde_json::from_str(args).map_err(|e| format!("Invalid arguments: {e}"))?;
            fs_read::execute(&input, state).await
        }
        "write" => {
            let input: fs_write::FSWriteInput =
                serde_json::from_str(args).map_err(|e| format!("Invalid arguments: {e}"))?;
            fs_write::execute(&input, state).await
        }
        "patch" => {
            let input: fs_patch::FSPatchInput =
                serde_json::from_str(args).map_err(|e| format!("Invalid arguments: {e}"))?;
            fs_patch::execute(&input, state).await
        }
        "fs_search" => {
            let input: fs_search::FSSearchInput =
                serde_json::from_str(args).map_err(|e| format!("Invalid arguments: {e}"))?;
            fs_search::execute(&input, state).await
        }
        "shell" => {
            let input: shell::ShellInput =
                serde_json::from_str(args).map_err(|e| format!("Invalid arguments: {e}"))?;
            shell::execute(&input, state).await
        }
        "fetch" => {
            let input: fetch::FetchInput =
                serde_json::from_str(args).map_err(|e| format!("Invalid arguments: {e}"))?;
            fetch::execute(&input).await
        }
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
            "Read a file from the filesystem. Returns the file content with line numbers. \
             You can optionally specify start_line and end_line to read a specific range.",
        ),
        make_def::<fs_write::FSWriteInput>(
            "write",
            "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. \
             You MUST read the file first before writing to it.",
        ),
        make_def::<fs_patch::FSPatchInput>(
            "patch",
            "Replace an exact string in a file. The old_string must appear exactly once in the file. \
             You MUST read the file first before patching it.",
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
