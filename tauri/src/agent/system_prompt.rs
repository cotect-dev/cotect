use std::fmt::Write;

use super::types::{AgentRole, TaskScope};

/// Environment information for system prompt construction.
#[derive(Debug, Clone)]
pub struct EnvironmentInfo {
    pub os: String,
    pub shell: String,
    pub cwd: String,
    pub date: String,
}

impl Default for EnvironmentInfo {
    fn default() -> Self {
        Self {
            os: std::env::consts::OS.to_string(),
            shell: std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into()),
            cwd: std::env::current_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_default(),
            date: chrono::Local::now().format("%Y-%m-%d").to_string(),
        }
    }
}

/// Build a system prompt from role, scope, and environment context.
pub fn build_system_prompt(
    role: AgentRole,
    scope: &TaskScope,
    env: &EnvironmentInfo,
    file_contents: &[(String, String)],
    workspace_stats: Option<&str>,
) -> String {
    let mut prompt = String::with_capacity(8192);

    // 1. Role instructions
    prompt.push_str(&role_instructions(role));
    prompt.push_str("\n\n");

    // 2. Environment info
    prompt.push_str(&environment_block(env));
    prompt.push_str("\n\n");

    // 3. Workspace overview
    if let Some(stats) = workspace_stats {
        prompt.push_str("## Workspace\n\n");
        prompt.push_str(stats);
        prompt.push_str("\n\n");
    }

    // 4. Architecture context
    prompt.push_str(&scope_context_block(scope, file_contents));
    prompt.push_str("\n\n");

    // 5. Tool usage rules
    prompt.push_str(&tool_rules(role));

    prompt
}

fn role_instructions(role: AgentRole) -> String {
    match role {
        AgentRole::Implement => "\
You are an expert software engineer working within a project. You have full access to the entire \
project through your tools — read, search, write, patch, and execute shell commands.

Make targeted, minimal changes rather than rewriting whole files. After significant edits, verify \
your work: compile the code (`cargo check`, `tsc --noEmit`, etc.), run the project's test suite, or \
exercise the change in a minimal way. When the task is complete, stop — don't keep making \
speculative changes.

Before editing existing code, state the specific issue you're fixing. If you can't name a \
concrete problem in one sentence, the code probably doesn't need changing — tell the user that \
instead of editing. \"This could be cleaner\" or \"this is more idiomatic\" are not concrete \
problems; a named bug, a measurable improvement, or an explicit user request are.

Treat existing validation, error handling, and defensive guards as intentional. Remove them only \
when the user asks, or when you've verified the branch is unreachable across all callers — not \
just the current one. \"It doesn't fire in today's code path\" is not sufficient; future callers, \
subclasses, and deserialization can reach code the current call graph can't.".into(),

        AgentRole::Research => "\
You are analyzing code for the user. Provide thorough, structured findings. You cannot modify any \
files — only read and search. Use clear headings, code references with file paths and line numbers, \
and concrete observations.".into(),

        AgentRole::Plan => "\
You are creating an implementation plan. Analyze the codebase thoroughly, then break the work into \
concrete, independently executable tasks. Each task should describe exactly which files to modify \
and what changes to make.

Format your plan as a numbered list of steps, each with:
- What to change
- Which file(s) are affected
- The specific modification

Be precise. Another agent will execute these steps, so they need to be unambiguous.".into(),
    }
}

fn environment_block(env: &EnvironmentInfo) -> String {
    format!(
        "## System Information\n\
         - Operating System: {}\n\
         - Shell: {}\n\
         - Current Directory: {}\n\
         - Date: {}",
        env.os, env.shell, env.cwd, env.date
    )
}

fn scope_context_block(scope: &TaskScope, file_contents: &[(String, String)]) -> String {
    let mut block = String::from("## Architecture Context\n\n");

    if let Some(dir) = &scope.directory {
        let _ = write!(block, "### Current Focus Directory: {dir}\n\n");
    }

    if !scope.files.is_empty() {
        block.push_str("### Project Files\n");
        for f in &scope.files {
            let _ = writeln!(block, "- {f}");
        }
        block.push('\n');
    }

    for (path, content) in file_contents {
        let line_count = content.lines().count();
        let _ = write!(
            block,
            "### File: {path} ({line_count} lines)\n\n\
             <file path=\"{path}\">\n\
             {content}\n\
             </file>\n\n"
        );
    }

    if !scope.declarations.is_empty() {
        block.push_str("### Declarations\n");
        for decl in &scope.declarations {
            let _ = writeln!(
                block,
                "- {} {} in {} [line {}]",
                decl.kind, decl.name, decl.file_path, decl.line
            );
        }
        block.push('\n');
    }

    if let Some(desc) = &scope.description {
        let _ = write!(block, "### User Description\n{desc}\n\n");
    }

    block
}

fn tool_rules(role: AgentRole) -> String {
    let mut rules = String::from("## Tool Usage Rules\n\n");

    rules.push_str(
        "- Invoke tools through the structured tool-calling interface. Do not emit `<tool_call>`, `<function=...>`, or raw tool-call JSON as part of your text response — those will not be executed and the turn will end prematurely.\n\
         - Always read a file before modifying it (write or patch). Blind modifications will be rejected.\n\
         - Your conversation context persists across turns. Once you've read a file, its contents remain available to you for the rest of the session — do not re-read the same file unless it was just modified (by your own `patch`/`write`) or you need to see its current byte-exact state before another edit.\n\
         - A successful `patch` or `write` confirms the edit landed — the file on disk now reflects your change. You do not need to re-read to verify the tool worked; re-read only if you need updated surrounding context for the next edit.\n\
         - The read tool prefixes each line with its line number as `<N>: <line>` — these prefixes are NOT part of the file content. When constructing patch `old_string` values, use only the raw line text without the `<N>: ` prefix.\n\
         - The patch tool requires `old_string` to match the file content EXACTLY (including whitespace and indentation). If a patch fails with \"not found\", re-read the file to check the exact bytes, and strip any line-number prefixes from what you copy.\n\
         - If the same text appears multiple times in the file, patch will reject the call; add surrounding context lines to `old_string` until it is unique.\n\
         - Prefer `patch` (surgical replacement) over `write` (full overwrite) for existing files. Reach for `write` only when creating new files or when a rewrite is genuinely smaller than the patch would be.\n\
         - When searching, prefer specific patterns over broad ones.\n\
         - The `shell` tool runs commands in the project root unless you pass `cwd`. Provide a clear description of what the command does.\n\
         - Make targeted, minimal changes rather than rewriting entire files.\n"
    );

    match role {
        AgentRole::Implement => {
            rules.push_str(
                "- You have full read/write/execute access. Use it responsibly.\n\
                 - After making changes, verify they work (run builds/tests if available).\n"
            );
        }
        AgentRole::Research | AgentRole::Plan => {
            rules.push_str("- You have read-only access. Do not attempt to modify files.\n");
        }
    }

    rules
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::types::DeclarationInfo;

    #[test]
    fn test_build_system_prompt_includes_all_sections() {
        let scope = TaskScope {
            root_path: "/project".into(),
            files: vec!["src/main.rs".into()],
            directory: Some("src/".into()),
            declarations: vec![],
            description: None,
            blocked_files: vec![],
        };
        let env = EnvironmentInfo {
            os: "linux".into(),
            shell: "/bin/bash".into(),
            cwd: "/project".into(),
            date: "2026-04-04".into(),
        };

        let prompt = build_system_prompt(
            AgentRole::Implement,
            &scope,
            &env,
            &[("src/main.rs".into(), "fn main() {}".into())],
            Some("114 files, .ts 53 (46%)"),
        );

        assert!(prompt.contains("expert software engineer"));
        assert!(prompt.contains("linux"));
        assert!(prompt.contains("Architecture Context"));
        assert!(prompt.contains("fn main()"));
        assert!(prompt.contains("114 files"));
        assert!(prompt.contains("Tool Usage Rules"));
    }

    #[test]
    fn test_research_role_is_readonly() {
        let prompt = role_instructions(AgentRole::Research);
        assert!(prompt.contains("cannot modify"));
    }

    #[test]
    fn test_plan_role_instructions() {
        let prompt = role_instructions(AgentRole::Plan);
        assert!(prompt.contains("implementation plan"));
        assert!(prompt.contains("numbered list"));
    }

    #[test]
    fn test_implement_role_has_full_access() {
        let prompt = tool_rules(AgentRole::Implement);
        assert!(prompt.contains("full read/write/execute access"));
    }

    #[test]
    fn test_research_role_tool_rules_readonly() {
        let prompt = tool_rules(AgentRole::Research);
        assert!(prompt.contains("read-only access"));
    }

    #[test]
    fn test_plan_role_tool_rules_readonly() {
        let prompt = tool_rules(AgentRole::Plan);
        assert!(prompt.contains("read-only access"));
    }

    #[test]
    fn test_environment_block_contains_all_fields() {
        let env = EnvironmentInfo {
            os: "macos".into(),
            shell: "/bin/zsh".into(),
            cwd: "/Users/dev/project".into(),
            date: "2026-04-04".into(),
        };
        let block = environment_block(&env);
        assert!(block.contains("macos"));
        assert!(block.contains("/bin/zsh"));
        assert!(block.contains("/Users/dev/project"));
        assert!(block.contains("2026-04-04"));
    }

    #[test]
    fn test_scope_with_directory() {
        let scope = TaskScope {
            root_path: "/project".into(),
            files: vec![],
            directory: Some("src/components/".into()),
            declarations: vec![],
            description: None,
            blocked_files: vec![],
        };
        let block = scope_context_block(&scope, &[]);
        assert!(block.contains("src/components/"));
    }

    #[test]
    fn test_scope_with_declarations() {
        let scope = TaskScope {
            root_path: "/project".into(),
            files: vec![],
            directory: None,
            declarations: vec![
                DeclarationInfo {
                    name: "UserStore".into(),
                    kind: "class".into(),
                    file_path: "src/stores/user.ts".into(),
                    line: 15,
                },
                DeclarationInfo {
                    name: "fetchData".into(),
                    kind: "function".into(),
                    file_path: "src/utils/api.ts".into(),
                    line: 42,
                },
            ],
            description: None,
            blocked_files: vec![],
        };
        let block = scope_context_block(&scope, &[]);
        assert!(block.contains("class UserStore in src/stores/user.ts [line 15]"));
        assert!(block.contains("function fetchData in src/utils/api.ts [line 42]"));
    }

    #[test]
    fn test_scope_with_description() {
        let scope = TaskScope {
            root_path: "/project".into(),
            files: vec![],
            directory: None,
            declarations: vec![],
            description: Some("The user wants to refactor the auth module".into()),
            blocked_files: vec![],
        };
        let block = scope_context_block(&scope, &[]);
        assert!(block.contains("User Description"));
        assert!(block.contains("refactor the auth module"));
    }

    #[test]
    fn test_scope_with_file_contents() {
        let scope = TaskScope {
            root_path: "/project".into(),
            files: vec!["src/main.rs".into()],
            directory: None,
            declarations: vec![],
            description: None,
            blocked_files: vec![],
        };
        let contents = vec![
            ("src/main.rs".into(), "fn main() {\n    println!(\"hello\");\n}".into()),
        ];
        let block = scope_context_block(&scope, &contents);
        assert!(block.contains("<file path=\"src/main.rs\">"));
        assert!(block.contains("fn main()"));
        assert!(block.contains("3 lines"));
    }

    #[test]
    fn test_workspace_stats_included_when_present() {
        let scope = TaskScope {
            root_path: "/p".into(),
            files: vec![],
            directory: None,
            declarations: vec![],
            description: None,
            blocked_files: vec![],
        };
        let env = EnvironmentInfo {
            os: "linux".into(),
            shell: "/bin/bash".into(),
            cwd: "/p".into(),
            date: "2026-04-04".into(),
        };
        let prompt = build_system_prompt(
            AgentRole::Implement,
            &scope,
            &env,
            &[],
            Some("139 files, .ts: 59 (42%), .tsx: 36 (26%)"),
        );
        assert!(prompt.contains("139 files"));
        assert!(prompt.contains(".ts: 59"));
    }

    #[test]
    fn test_workspace_stats_omitted_when_none() {
        let scope = TaskScope {
            root_path: "/p".into(),
            files: vec![],
            directory: None,
            declarations: vec![],
            description: None,
            blocked_files: vec![],
        };
        let env = EnvironmentInfo {
            os: "linux".into(),
            shell: "/bin/bash".into(),
            cwd: "/p".into(),
            date: "2026-04-04".into(),
        };
        let prompt = build_system_prompt(AgentRole::Implement, &scope, &env, &[], None);
        assert!(!prompt.contains("## Workspace"));
    }

    #[test]
    fn test_all_roles_produce_nonempty_prompts() {
        let scope = TaskScope {
            root_path: "/p".into(),
            files: vec![],
            directory: None,
            declarations: vec![],
            description: None,
            blocked_files: vec![],
        };
        let env = EnvironmentInfo {
            os: "linux".into(),
            shell: "/bin/bash".into(),
            cwd: "/p".into(),
            date: "2026-04-04".into(),
        };
        for role in [AgentRole::Implement, AgentRole::Research, AgentRole::Plan] {
            let prompt = build_system_prompt(role, &scope, &env, &[], None);
            assert!(!prompt.is_empty());
            assert!(prompt.contains("Tool Usage Rules"));
            assert!(prompt.contains("System Information"));
        }
    }

    #[test]
    fn test_scope_with_multiple_files() {
        let scope = TaskScope {
            root_path: "/p".into(),
            files: vec!["a.rs".into(), "b.ts".into(), "c.tsx".into()],
            directory: None,
            declarations: vec![],
            description: None,
            blocked_files: vec![],
        };
        let block = scope_context_block(&scope, &[]);
        assert!(block.contains("- a.rs"));
        assert!(block.contains("- b.ts"));
        assert!(block.contains("- c.tsx"));
    }

    #[test]
    fn test_empty_scope() {
        let scope = TaskScope {
            root_path: "/p".into(),
            files: vec![],
            directory: None,
            declarations: vec![],
            description: None,
            blocked_files: vec![],
        };
        let block = scope_context_block(&scope, &[]);
        assert!(block.contains("Architecture Context"));
        assert!(!block.contains("Project Files"));
        assert!(!block.contains("Declarations"));
    }
}
