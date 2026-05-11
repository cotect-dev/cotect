pub mod fetch;
pub mod fs_patch;
pub mod fs_read;
pub mod fs_search;
pub mod fs_write;
pub mod shell;

#[cfg(test)]
pub(crate) mod test_helpers;

pub const MAX_OUTPUT: usize = 100 * 1024; // 100 KB
pub const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10 MB

/// Maximum serialized-JSON length for a `shell` tool call's arguments.
/// A legitimate command is easily under 1 KB; values above this threshold
/// almost always mean the model has stuffed an entire file into a heredoc
/// (`python3 << PYEOF ... PYEOF`) instead of using the `write` tool. Such
/// calls then bloat context on every subsequent turn. 4 KB leaves plenty of
/// headroom for real invocations.
pub const MAX_SHELL_ARGS_BYTES: usize = 4 * 1024;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use schemars::JsonSchema;
use serde::de::DeserializeOwned;
use tokio::sync::Mutex;

use super::types::{AgentRole, FunctionDef, ToolCall, ToolDefinition};

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

fn parse_args<T: DeserializeOwned>(args: &str) -> Result<T, String> {
    serde_json::from_str(args).map_err(|e| format!("Invalid arguments: {e}"))
}

pub async fn execute_tool(tool_call: &ToolCall, state: &Arc<ToolState>) -> Result<String, String> {
    let name = tool_call.function.name.as_str();
    let args = &tool_call.function.arguments;

    match name {
        "__format_error__" => {
            // Adapter-layer parse failure. `args` contains the raw malformed text.
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
        "shell" => {
            // Oversized args (usually heredoc-ed file bodies) are rejected
            // before execution — context cost isn't worth running them, and
            // the error steers the model to the `write` tool.
            if args.len() > MAX_SHELL_ARGS_BYTES {
                return Err(format!(
                    "Shell arguments are {} bytes, which exceeds the {}-byte budget. \
                     You probably stuffed an entire file into a heredoc. Use the \
                     `write` tool to create or overwrite files, then invoke the \
                     shell with a short command that references the file by path \
                     (e.g. `python3 script.py`). If you genuinely need a long \
                     inline script, break it into a helper file first via `write`.",
                    args.len(),
                    MAX_SHELL_ARGS_BYTES,
                ));
            }
            shell::execute(&parse_args(args)?, state).await
        }
        "fetch" => fetch::execute(&parse_args(args)?).await,
        _ => Err(format!("Unknown tool: {name}")),
    }
}

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

pub fn all_definitions() -> Vec<ToolDefinition> {
    vec![
        make_def::<fs_read::FSReadInput>(
            "read",
            "Read one or more files from the filesystem. \
             SINGLE file: `{\"file_path\": \"/abs/path.py\"}` (optionally `start_line`/`end_line` \
             for a range). \
             MULTIPLE files in ONE call: `{\"file_paths\": [\"/abs/a.py\", \"/abs/b.py\", \
             \"/abs/c.py\"]}`. Cap is 20 paths per call. \
             Prefer the batch form whenever your task touches more than one file — three reads \
             in one call costs one round-trip; three separate calls cost three. The default \
             posture during investigation is: read every scope file in one batch, then plan. \
             Returns content with each line prefixed by its 1-indexed line number in the format \
             `N: <content>` (e.g. `1: first line\\n2: second line`). The `N: ` prefix is added by \
             this tool for your reference ONLY — it is NOT part of the actual file content. The \
             line numbers shown here are exactly what `patch`'s line-range form refers to; when \
             passing text to `patch` or `write`, strip the `N: ` prefix and use only the raw \
             content. \
             For files over 400 lines, prefer `fs_search` for symbol or call-site enumeration — \
             scrolling a long file mentally is unreliable.",
        ),
        make_def::<fs_write::FSWriteInput>(
            "write",
            "Write content to a file. Creates the file if it doesn't exist, overwrites if it \
             does. Requires a prior `read` for existing files. The `content` parameter is the \
             file's literal new bytes; the `N: ` line-number prefixes that `read` shows are \
             display-only and should be stripped from any text you copy into `content`.\n\
             Returns the post-write file body line-numbered in the same shape `read` returns \
             — the response is the file you just wrote, so a follow-up `read` would be \
             redundant.\n\
             Example: {\"file_path\": \"/abs/path\", \"content\": \"...\"}",
        ),
        make_def::<fs_patch::FSPatchInput>(
            "patch",
            "Replace a region of a file with new content. Pick whichever of these three forms \
             is shortest to write for your situation — they all do the same thing.\n\
             FORM A — by line number. Use when you've just read the file and know the lines: \
             {\"file_path\": \"/abs/p\", \"start_line\": 22, \"end_line\": 25, \
             \"new_string\": \"...\"}. For pure deletion pass an empty `new_string`.\n\
             FORM B — by exact string. The classic shape; works without line numbers: \
             {\"file_path\": \"/abs/p\", \"old_string\": \"x = 1\", \"new_string\": \"x = 2\"}. \
             `old_string` must occur exactly once in the file.\n\
             FORM C — by anchored elision. Useful when the region is too long to copy \
             verbatim. The literal `[...]` placeholder in `old_string` matches everything \
             between the prefix and suffix anchors: \
             {\"file_path\": \"/abs/p\", \"old_string\": \"def foo():\\n[...]\\n    return None\", \
             \"new_string\": \"def foo():\\n    return 42\"}. The prefix and suffix must each \
             occur exactly once (prefix once in the file, suffix once after the prefix).\n\
             Whitespace at the very start and end of `old_string` and `new_string` is \
             ignored — the file's existing indentation around the splice point stays put. \
             So a 3-space `def foo():` anchor cleanly hits a 4-space-indented line in the \
             file. Inner whitespace inside the anchor still has to match exactly.\n\
             Returns the post-edit file body line-numbered in the same shape `read` returns \
             — the response is the file you just patched, so a follow-up `read` would be \
             redundant.\n\
             On any failure (out-of-range line, not-found, ambiguous), the tool returns the \
             current file body inline so you can fix the input and retry. The `N: ` prefix \
             `read` shows is display-only; strip it from any text you copy into `old_string` \
             or `new_string`.",
        ),
        make_def::<fs_search::FSSearchInput>(
            "fs_search",
            "Regex search across files. Returns matching lines with file paths and line numbers. \
             Optionally filter by glob pattern. \
             USE THIS BEFORE coordinated multi-file edits (renames, signature changes, \
             parameter additions, return-type changes) — it enumerates call sites you might \
             miss by reading file by file. A renamed symbol that still appears in one forgotten \
             file is a runtime bug; `fs_search` for the old name and confirm zero hits before \
             stopping. Also use to locate symbols in files too long to scan mentally.",
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

    // OpenAI-compat schemas: drop $schema and title.
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
            assert!(
                def.function.parameters.is_object(),
                "Schema for {} is not an object",
                def.function.name
            );
            // Should not contain $schema key (OpenAI compat)
            assert!(
                def.function.parameters.get("$schema").is_none(),
                "Schema for {} should not have $schema",
                def.function.name
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
                arguments: format!(
                    r#"{{"file_path":"{}","content":"hello dispatch"}}"#,
                    path_str
                ),
            },
        };
        let state = ToolState::new("/tmp".into());
        let result = execute_tool(&tool_call, &state).await;
        assert!(result.is_ok());
        assert!(std::fs::read_to_string(&path)
            .unwrap()
            .contains("hello dispatch"));
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
    async fn test_execute_tool_shell_rejects_oversized_arguments() {
        // Simulate a heredoc with a whole file pasted in — typical failure
        // mode where the model regenerates a file via `python3 << PYEOF ...`
        // instead of calling `write`. The shell tool should refuse before
        // execution and steer the model to `write`.
        let huge_body = "x".repeat(MAX_SHELL_ARGS_BYTES + 2_000);
        let arguments = format!(
            r#"{{"command":"python3 << 'PYEOF'\n{}\nPYEOF"}}"#,
            huge_body
        );
        let tool_call = ToolCall {
            id: "call_heredoc".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "shell".into(),
                arguments,
            },
        };
        let state = ToolState::new("/tmp".into());
        let result = execute_tool(&tool_call, &state).await;
        assert!(result.is_err(), "oversized shell call must be rejected");
        let msg = result.unwrap_err();
        assert!(msg.contains("exceeds"), "error must explain the size cap");
        assert!(
            msg.contains("`write`"),
            "error must point to the write tool"
        );
    }

    #[tokio::test]
    async fn test_execute_tool_shell_allows_normal_sized_arguments() {
        // A reasonably sized shell command should still run. Using `echo` so
        // the test is deterministic on any POSIX host.
        let cmd: String = (0..50)
            .map(|i| format!("arg{i}"))
            .collect::<Vec<_>>()
            .join(" ");
        let arguments = format!(r#"{{"command":"echo {cmd}"}}"#);
        let tool_call = ToolCall {
            id: "call_normal".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "shell".into(),
                arguments,
            },
        };
        let state = ToolState::new("/tmp".into());
        let result = execute_tool(&tool_call, &state).await.unwrap();
        assert!(result.contains("arg0"));
        assert!(result.contains("arg49"));
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
                arguments: format!(
                    r#"{{"pattern":"unique_marker_1234","path":"{}"}}"#,
                    dir.path().to_str().unwrap()
                ),
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

        let patch_call = ToolCall {
            id: "c2".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "patch".into(),
                arguments: format!(
                    r#"{{"file_path":"{}","start_line":1,"end_line":1,"new_string":"modified content here"}}"#,
                    path,
                ),
            },
        };
        let patch_result = execute_tool(&patch_call, &state).await.unwrap();
        // Response is the post-edit file body in `read`-shape.
        assert!(patch_result.contains("1: modified content here"));

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

        let read_call = ToolCall {
            id: "c1".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "read".into(),
                arguments: format!(r#"{{"file_path":"{}"}}"#, path),
            },
        };
        execute_tool(&read_call, &state).await.unwrap();

        let write_call = ToolCall {
            id: "c2".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "write".into(),
                arguments: format!(
                    r#"{{"file_path":"{}","content":"completely new content"}}"#,
                    path
                ),
            },
        };
        let write_result = execute_tool(&write_call, &state).await.unwrap();
        // Response is the post-write file body in `read`-shape.
        assert!(write_result.contains("1: completely new content"));
    }

    #[tokio::test]
    async fn test_read_after_write_returns_full_content() {
        // Every read returns the full file contents — no stubs, no
        // harness commentary. This is a regression guard for an earlier
        // "dedup stub" experiment that confused the model after writes.
        use std::io::Write;
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(b"seed").unwrap();
        f.flush().unwrap();
        let path = f.path().to_str().unwrap();
        let state = ToolState::new("/tmp".into());

        let read_call = ToolCall {
            id: "r1".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "read".into(),
                arguments: format!(r#"{{"file_path":"{}"}}"#, path),
            },
        };
        execute_tool(&read_call, &state).await.unwrap();

        let write_call = ToolCall {
            id: "w1".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "write".into(),
                arguments: format!(r#"{{"file_path":"{}","content":"post write body"}}"#, path),
            },
        };
        execute_tool(&write_call, &state).await.unwrap();

        let reread = ToolCall {
            id: "r2".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "read".into(),
                arguments: format!(r#"{{"file_path":"{}"}}"#, path),
            },
        };
        let out = execute_tool(&reread, &state).await.unwrap();
        assert!(
            out.contains("1: post write body"),
            "read after write must return the updated content: {out}"
        );
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
