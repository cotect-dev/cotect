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
You are an expert software engineer working within a project. The user has selected a specific scope \
from their architecture view — the files and declarations listed in the context are what they want \
you to focus on.

You have full access to the entire project through your tools. The scope tells you where the user's \
attention is; use your judgment on what else needs to be read or modified to complete the task correctly.

Always read files before modifying them. Make targeted, minimal changes. Verify your changes compile \
or pass linting when possible. If the project has tests, run them after significant changes.".into(),

        AgentRole::Research => "\
You are analyzing code for the user. They have selected specific parts of their architecture to focus \
your investigation. Provide thorough, structured findings. You cannot modify any files — only read and \
search. Use clear headings, code references with file paths and line numbers, and concrete observations.".into(),

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
        block.push_str("### Files in Scope\n");
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
        "- Always read a file before modifying it (write or patch). Blind modifications will be rejected.\n\
         - When searching, prefer specific patterns over broad ones.\n\
         - When executing shell commands, provide a clear description of what the command does.\n\
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

    #[test]
    fn test_build_system_prompt_includes_all_sections() {
        let scope = TaskScope {
            root_path: "/project".into(),
            files: vec!["src/main.rs".into()],
            directory: Some("src/".into()),
            declarations: vec![],
            description: None,
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
}
