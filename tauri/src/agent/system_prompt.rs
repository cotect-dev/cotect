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
///
/// Structure (primacy → environment → recency):
/// 1. Role framing
/// 2. Working Principles           — shared: how a good engineer decides what to change
/// 3. Workflow                     — Implement only: investigate → plan → edit → verify
/// 4. Anti-Patterns                — shared: tool-use failure modes
/// 5. When You Are Done            — Implement only: stopping criteria
/// 6. System Information
/// 7. Workspace overview           — optional
/// 8. Architecture Context         — the user's selected scope
/// 9. Tool Usage Rules             — operational mechanics, kept last so they're fresh at act-time
pub fn build_system_prompt(
    role: AgentRole,
    scope: &TaskScope,
    env: &EnvironmentInfo,
    file_contents: &[(String, String)],
    workspace_stats: Option<&str>,
) -> String {
    let mut prompt = String::with_capacity(8192);
    let is_implement = matches!(role, AgentRole::Implement);

    // 1. Role framing
    prompt.push_str(&role_instructions(role));
    prompt.push_str("\n\n");

    // 2. Working principles (shared)
    prompt.push_str(working_principles());
    prompt.push_str("\n\n");

    // 3. Workflow (Implement only — readers don't edit)
    if is_implement {
        prompt.push_str(workflow_block());
        prompt.push_str("\n\n");
    }

    // 4. Anti-patterns (shared — all roles use tools)
    prompt.push_str(anti_patterns());
    prompt.push_str("\n\n");

    // 5. Stopping criteria (Implement only — readers finish when they've reported)
    if is_implement {
        prompt.push_str(stopping_criteria());
        prompt.push_str("\n\n");
    }

    // 6. Environment info
    prompt.push_str(&environment_block(env));
    prompt.push_str("\n\n");

    // 7. Workspace overview
    if let Some(stats) = workspace_stats {
        prompt.push_str("## Workspace\n\n");
        prompt.push_str(stats);
        prompt.push_str("\n\n");
    }

    // 8. Architecture context
    prompt.push_str(&scope_context_block(scope, file_contents));
    prompt.push_str("\n\n");

    // 9. Tool usage rules
    prompt.push_str(&tool_rules(role));

    prompt
}

fn role_instructions(role: AgentRole) -> String {
    match role {
        AgentRole::Implement => "\
You are an expert software engineer operating as a coding agent inside a user's project. You have \
full access to the workspace through your tools: read, search, write, patch, and run shell \
commands. Your job is to complete the task the user describes end-to-end within this turn whenever \
feasible. Stop once verification is green and the task is handled — do not keep making speculative \
changes after the work is done.".into(),

        AgentRole::Research => "\
You are analyzing code for the user — read-only. You cannot modify any files. Provide thorough, \
structured findings: clear headings, specific file paths and line numbers, and concrete \
observations grounded in what you have actually read rather than what you assume.".into(),

        AgentRole::Plan => "\
You are creating an implementation plan — read-only. Analyze the codebase thoroughly, then produce \
a numbered list of concrete, independently executable steps. For each step state (a) what changes, \
(b) which file(s) are affected, and (c) the specific modification to make. Another agent will \
execute these steps, so every step must be unambiguous.".into(),
    }
}

/// Software-engineering principles that apply to every role. These shape *what* to do;
/// the workflow block shapes *how* to do it.
fn working_principles() -> &'static str {
    "## Working Principles\n\
     \n\
     - **Root cause over surface fix.** Before editing, state the concrete problem in one \
     sentence. If you cannot name it, the code probably does not need changing — tell the user \
     that instead of editing. \"More idiomatic\" and \"cleaner\" are not concrete problems; a \
     named bug, a measurable improvement, or an explicit user request are.\n\
     - **Minimal, targeted changes.** Do not add features, refactor, or clean up code beyond what \
     the task requires. A bug fix does not need surrounding cleanup; a one-shot task does not \
     need a helper abstraction.\n\
     - **Trust existing code.** Treat existing validation, error handling, and defensive guards \
     as intentional. Remove them only when the user asks, or when you have verified across all \
     callers — not just the current path — that the branch is unreachable. \"It does not fire in \
     today's code path\" is not sufficient.\n\
     - **Follow existing patterns.** Match the naming, formatting, module layout, and helper \
     conventions already in the codebase. If there is a canonical way to do something here, use \
     it instead of inventing a new one.\n\
     - **Let errors surface.** No broad `except`/`catch` blocks, no silent defaults, no catch-all \
     fallbacks that mask real failures. If a failure can happen, it should be visible.\n\
     - **Comments explain why, not what.** Well-named identifiers already describe behaviour. A \
     comment earns its place only when the reason for the code — a constraint, a subtle \
     invariant, a workaround — is not obvious from reading the code."
}

/// How to execute a change end-to-end. Implement-only: readers and planners do not run this loop.
fn workflow_block() -> &'static str {
    "## Workflow\n\
     \n\
     - **Investigate first.** Read the files you are about to touch, and any caller or callee \
     whose behaviour your change depends on. The Architecture Context below is your starting \
     scope — read those files first; branch outside only when the task genuinely requires it.\n\
     - **Plan briefly for multi-file work.** Hold a short mental plan: what changes, in which \
     file, in what order. Think briefly between actions — prefer running a check over reasoning \
     at length about what it would return. A failing test tells you more than a paragraph of \
     speculation.\n\
     - **Edit in batched logical units.** One complete `patch` beats five fragments. Re-read a \
     file only when something you just wrote could have shifted what you need to see next.\n\
     - **Verify after meaningful edits.** Run the most specific check available — a single test \
     file, a focused build, a type-check. Treat green as done. Treat red as your next subtask; \
     iterate until it passes. Never declare the task done while a relevant check is failing.\n\
     - **Verify renames structurally.** When renaming a symbol or changing a signature, \
     `fs_search` the old name across the scope and confirm zero hits before stopping. The test \
     passing does not prove the old name is gone from files the test does not exercise."
}

/// Tool-use failure modes observed in the wild. Shared across roles because every role uses tools.
fn anti_patterns() -> &'static str {
    "## Anti-Patterns\n\
     \n\
     - **Do not stuff file contents into shell heredocs.** `python3 << EOF ... EOF` with an \
     entire module inside bloats the conversation on every subsequent turn. Create or edit files \
     with `write` / `patch`, then invoke the shell with a short command that references the file \
     by path.\n\
     - **Do not use `shell` as a scratchpad.** Trivial probes like `python3 -c \"# thinking \
     about x\"` or `echo checking...` are reasoning dressed up as a tool call. Think in the \
     reasoning channel; reach for `shell` only to run a real command with side effects.\n\
     - **Do not re-read a file you just read or just wrote.** Your conversation context persists \
     across turns — the content is already available unless a tool has modified the file since.\n\
     - **Do not emit tool-call markup in prose.** Never write `<tool_call>`, `<function=...>`, or \
     raw tool-call JSON into your text output. Use the structured tool-call channel — anything \
     else will not execute and the turn ends prematurely.\n\
     - **Do not loop silently.** If you find yourself re-reading or re-patching the same file \
     without new information, stop and say what is blocking you. Repeating the same call with \
     tiny variations is not progress."
}

/// When to hand control back to the user. Implement-only.
fn stopping_criteria() -> &'static str {
    "## When You Are Done\n\
     \n\
     - Verification relevant to the change is green — the test you ran, the build you triggered, \
     or the focused check you executed.\n\
     - No speculative improvements are still pending. The task is the task.\n\
     - You are not ending the turn with a clarifying question unless the user's intent is \
     genuinely ambiguous. Progress being hard is not ambiguity.\n\
     - Report what you did in one short message: the concrete change, where it lives, and the \
     verification you ran. Skip a step-by-step replay — the user can read the diff."
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

    let has_scope = scope.directory.is_some()
        || !scope.files.is_empty()
        || !file_contents.is_empty()
        || !scope.declarations.is_empty();

    if has_scope {
        block.push_str(
            "The items below are your starting scope — what the user selected on the \
             architecture graph for this task. Read these files before searching elsewhere. \
             Branch outside the scope only when the task genuinely requires it, and note why \
             in your reasoning.\n\n",
        );
    }

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
        "- Invoke tools through the structured tool-calling channel only. Never emit \
         `<tool_call>`, `<function=...>`, or raw tool-call JSON in your prose — those will not \
         be executed and the turn ends prematurely.\n\
         - `read` prefixes each line with `N: ` for reference only. These prefixes are NOT part \
         of the file content — strip them before passing text to `patch` or `write`.\n\
         - `patch` requires `old_string` to match the file bytes exactly, including whitespace \
         and indentation. On a miss it returns the current file contents inline, so you can fix \
         your snippet on the next call — you do not need a separate `read` first. If \
         `old_string` appears multiple times, add surrounding lines until it is unique.\n\
         - Prefer `patch` (surgical replacement) over `write` (full overwrite) for existing \
         files. Reach for `write` only when creating a new file or when a full rewrite is \
         genuinely smaller than the equivalent patch. A blind `write` over an unread file is \
         rejected.\n\
         - A successful `patch` or `write` response confirms the edit landed. Trust it and move \
         to the next step (typically a verification command) — do not verify the write with \
         another `read` or encoding probe.\n\
         - Keep `shell` arguments short and reference files by path. Oversized argument blobs \
         (typically a whole file stuffed into a heredoc) are rejected because they bloat context \
         on every subsequent turn.\n\
         - `shell` runs in the project root unless you pass `cwd`. Every `shell` call needs a \
         clear description of what the command does.\n\
         - Prefer `fs_search` over `shell grep`, and prefer specific regex patterns over broad \
         ones — narrower queries return fewer irrelevant hits.\n\
         - Your conversation context persists across turns. Once you have read a file, its \
         contents remain available for the rest of the session unless you have modified it.\n",
    );

    match role {
        AgentRole::Implement => {
            rules.push_str(
                "- You have full read/write/execute access. Use it responsibly — no unasked \
                 refactors, no drive-by edits outside the task.\n",
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

    // ─── New tests for the principles / workflow / anti-patterns / stopping blocks ───

    #[test]
    fn test_working_principles_present_for_all_roles() {
        let scope = TaskScope {
            root_path: "/p".into(),
            files: vec![],
            directory: None,
            declarations: vec![],
            description: None,
            blocked_files: vec![],
        };
        let env = EnvironmentInfo::default();
        for role in [AgentRole::Implement, AgentRole::Research, AgentRole::Plan] {
            let prompt = build_system_prompt(role, &scope, &env, &[], None);
            assert!(
                prompt.contains("Working Principles"),
                "Working Principles missing for {role:?}"
            );
            assert!(
                prompt.contains("Root cause over surface fix"),
                "root-cause principle missing for {role:?}"
            );
            assert!(
                prompt.contains("Minimal, targeted changes"),
                "minimal-change principle missing for {role:?}"
            );
        }
    }

    #[test]
    fn test_anti_patterns_present_for_all_roles() {
        let scope = TaskScope {
            root_path: "/p".into(),
            files: vec![],
            directory: None,
            declarations: vec![],
            description: None,
            blocked_files: vec![],
        };
        let env = EnvironmentInfo::default();
        for role in [AgentRole::Implement, AgentRole::Research, AgentRole::Plan] {
            let prompt = build_system_prompt(role, &scope, &env, &[], None);
            assert!(
                prompt.contains("Anti-Patterns"),
                "Anti-Patterns missing for {role:?}"
            );
            assert!(
                prompt.contains("heredocs"),
                "heredoc warning missing for {role:?}"
            );
            assert!(
                prompt.contains("Do not loop silently"),
                "anti-loop warning missing for {role:?}"
            );
        }
    }

    #[test]
    fn test_workflow_block_implement_only() {
        let scope = TaskScope {
            root_path: "/p".into(),
            files: vec![],
            directory: None,
            declarations: vec![],
            description: None,
            blocked_files: vec![],
        };
        let env = EnvironmentInfo::default();

        let implement = build_system_prompt(AgentRole::Implement, &scope, &env, &[], None);
        assert!(implement.contains("## Workflow"));
        assert!(implement.contains("Verify after meaningful edits"));
        assert!(implement.contains("Verify renames structurally"));

        let research = build_system_prompt(AgentRole::Research, &scope, &env, &[], None);
        assert!(!research.contains("## Workflow"));

        let plan = build_system_prompt(AgentRole::Plan, &scope, &env, &[], None);
        assert!(!plan.contains("## Workflow"));
    }

    #[test]
    fn test_stopping_criteria_implement_only() {
        let scope = TaskScope {
            root_path: "/p".into(),
            files: vec![],
            directory: None,
            declarations: vec![],
            description: None,
            blocked_files: vec![],
        };
        let env = EnvironmentInfo::default();

        let implement = build_system_prompt(AgentRole::Implement, &scope, &env, &[], None);
        assert!(implement.contains("When You Are Done"));
        assert!(implement.contains("Verification relevant to the change is green"));

        let research = build_system_prompt(AgentRole::Research, &scope, &env, &[], None);
        assert!(!research.contains("When You Are Done"));

        let plan = build_system_prompt(AgentRole::Plan, &scope, &env, &[], None);
        assert!(!plan.contains("When You Are Done"));
    }

    #[test]
    fn test_scope_directive_present_when_scope_nonempty() {
        let scope = TaskScope {
            root_path: "/p".into(),
            files: vec!["a.rs".into()],
            directory: None,
            declarations: vec![],
            description: None,
            blocked_files: vec![],
        };
        let block = scope_context_block(&scope, &[]);
        assert!(block.contains("starting scope"));
        assert!(block.contains("note why"));
    }

    #[test]
    fn test_scope_directive_absent_when_scope_empty() {
        let scope = TaskScope {
            root_path: "/p".into(),
            files: vec![],
            directory: None,
            declarations: vec![],
            description: None,
            blocked_files: vec![],
        };
        let block = scope_context_block(&scope, &[]);
        assert!(!block.contains("starting scope"));
    }

    #[test]
    fn test_tool_rules_still_include_core_mechanics() {
        let rules = tool_rules(AgentRole::Implement);
        assert!(rules.contains("N: "), "N-prefix warning must remain");
        assert!(rules.contains("blind `write`"), "blind-write warning must remain");
        assert!(
            rules.contains("returns the current file contents inline"),
            "forgiving-patch explanation must remain"
        );
        assert!(
            rules.contains("structured tool-calling channel"),
            "tool-call-channel rule must remain"
        );
    }
}
