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

    prompt.push_str(&role_instructions(role));
    prompt.push_str("\n\n");

    prompt.push_str(working_principles());
    prompt.push_str("\n\n");

    // Workflow + stopping criteria are Implement-only (readers don't edit).
    if is_implement {
        prompt.push_str(workflow_block());
        prompt.push_str("\n\n");
    }

    prompt.push_str(anti_patterns());
    prompt.push_str("\n\n");

    if is_implement {
        prompt.push_str(stopping_criteria());
        prompt.push_str("\n\n");
    }

    prompt.push_str(&environment_block(env));
    prompt.push_str("\n\n");

    if let Some(stats) = workspace_stats {
        prompt.push_str("## Workspace\n\n");
        prompt.push_str(stats);
        prompt.push_str("\n\n");
    }

    prompt.push_str(&scope_context_block(scope, file_contents));
    prompt.push_str("\n\n");

    // Tool usage rules go last so they're fresh at act-time.
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
     - **\"No change required\" is a valid outcome.** When the user asks you to investigate or \
     refactor something and the code is already correct, say so and stop. A short, accurate \
     report that nothing needs changing is more useful than a manufactured edit. Do not invent \
     work to look productive.\n\
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
     - **Investigate first, in one batch.** Read the files you are about to touch, and any \
     caller or callee whose behaviour your change depends on. The Architecture Context below is \
     your starting scope — read those files first; branch outside only when the task genuinely \
     requires it. When the scope has more than one file, your first tool call should be a single \
     `read` with `{\"file_paths\": [\"/abs/a\", \"/abs/b\", \"/abs/c\"]}`, not three separate \
     reads. Three reads in one call is one round-trip; three separate calls is three. There is \
     no rule against reading any particular file unless the user explicitly says so; read \
     whatever helps.\n\
     - **Enumerate before coordinated edits.** Before any change that touches multiple files \
     (renames, signature changes, parameter additions, return-type changes), run `fs_search` \
     for the symbol or pattern across the scope to enumerate every call site. Reads only show \
     you what you remember to look at; search shows you what you missed. A renamed symbol that \
     still appears in one forgotten file is a runtime bug.\n\
     - **Plan briefly for multi-file work.** Hold a short mental plan: what changes, in which \
     file, in what order. Think briefly between actions — prefer running a check over reasoning \
     at length about what it would return. A failing test tells you more than a paragraph of \
     speculation.\n\
     - **Edit by patching, not rewriting.** Use `patch` to change existing files. It accepts \
     three interchangeable forms — pick whichever is shortest to write: \
     (a) line range — `start_line` + `end_line` + `new_string`; \
     (b) exact string — `old_string` (must match once) + `new_string`; \
     (c) anchored elision — `old_string` like `\"def foo():\\n[...]\\n    return None\"` + \
     `new_string`. The `[...]` placeholder matches everything between the prefix and suffix \
     anchors, useful for replacing whole functions or blocks without copying the body. \
     For pure deletion, pass an empty `new_string`. Use `write` only for new files or \
     wholesale rewrites. Both `patch` and `write` return the post-edit file body in the same \
     shape `read` produces — you don't need a follow-up `read` to see what you just wrote.\n\
     - **Verify after meaningful edits.** Run the most specific check available — a single test \
     file, a focused build, a type-check. Treat green as done. Treat red as your next subtask; \
     iterate until it passes. Never declare the task done while a relevant check is failing."
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
     - **Do not re-read a file you just read or just wrote.** `patch` and `write` already \
     return the post-edit file body in the same line-numbered shape `read` produces — that \
     response IS the new state of the file. The previous read's content is also still \
     available in your conversation context unless a tool has modified the file since.\n\
     - **Do not emit tool-call markup in prose.** Never write `<tool_call>`, `<function=...>`, or \
     raw tool-call JSON into your text output. Use the structured tool-call channel — anything \
     else will not execute and the turn ends prematurely.\n\
     - **Do not invent rules that nobody set.** There is no prohibition against reading any \
     file unless the user — or, in evaluation, the harness — has explicitly marked it \
     off-limits. When a tool reports `Access denied`, respect it; do not try to circumvent it \
     via `shell` (`cat`, `python3 -c \"open(...)\"`, etc.) — that is a circumvention and is \
     flagged. Phrases like \"the rules say I must not read the test file\" when the rules say \
     no such thing also waste turns; the asymmetry is the rules say what they say, neither more \
     nor less.\n\
     - **Do not relitigate decisions you already made.** Hedging phrases (\"Wait, actually...\", \
     \"Let me reconsider...\", \"Hmm, but...\") two or three times in a row are a signal to \
     call a tool, not to keep deliberating. If you've stated a conclusion twice, act on it; \
     the failing test or successful patch will tell you if you were wrong.\n\
     - **Do not regress to `write` to recover from a `patch` error.** If a `patch` hits a \
     bad line range or an ambiguous match, fix the input and re-issue the `patch` — full-file \
     rewrites tend to drop unrelated content (helpers, imports, methods you forgot were there).\n\
     - **Do not loop silently.** If you find yourself re-reading or re-editing the same file \
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
        "- **Never re-read a file you just wrote or patched.** This is the single most common \
         waste pattern. `patch` and `write` already return the post-edit file body in the \
         same line-numbered shape `read` produces — that response IS the new state of the \
         file. A follow-up `read` would just re-fetch what you already have.\n\
         - Invoke tools through the structured tool-calling channel only. Never emit \
         `<tool_call>`, `<function=...>`, or raw tool-call JSON in your prose — those will not \
         be executed and the turn ends prematurely.\n\
         - `read` prefixes each line with `N: ` for reference only. These prefixes are NOT part \
         of the file content — strip them before passing text to `patch` or `write`. The line \
         numbers `N` are exactly what `patch`'s `start_line`/`end_line` form refers to.\n\
         - `patch` is the primary tool for modifying existing files. It accepts three \
         interchangeable forms: by line range (`start_line`+`end_line`+`new_string`), by exact \
         string (`old_string`+`new_string`, must match once), or by anchored elision \
         (`old_string` containing `[...]` between two anchor lines). For pure deletion pass \
         empty `new_string`. On any failure the tool returns the file body inline — fix the \
         input and retry rather than falling back to `write`.\n\
         - Use `write` for creating new files or when a wholesale rewrite is genuinely smaller \
         than the equivalent `patch`. A blind `write` over an unread file is rejected.\n\
         - Keep `shell` arguments short and reference files by path. Oversized argument blobs \
         (typically a whole file stuffed into a heredoc) are rejected because they bloat context \
         on every subsequent turn.\n\
         - `shell` runs in the project root unless you pass `cwd`. Every `shell` call needs a \
         clear description of what the command does.\n\
         - Prefer `fs_search` over `shell grep`, and prefer specific regex patterns over broad \
         ones — narrower queries return fewer irrelevant hits. Reach for `fs_search` *before* \
         coordinated multi-file edits to enumerate every call site.\n\
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
        assert!(
            implement.contains("Enumerate before coordinated edits"),
            "workflow must promote fs_search before multi-file edits",
        );
        assert!(
            implement.contains("return the post-edit file body"),
            "workflow must explain that patch/write already return the post-edit body",
        );

        let research = build_system_prompt(AgentRole::Research, &scope, &env, &[], None);
        assert!(!research.contains("## Workflow"));

        let plan = build_system_prompt(AgentRole::Plan, &scope, &env, &[], None);
        assert!(!plan.contains("## Workflow"));
    }

    #[test]
    fn test_anti_patterns_cover_new_failure_modes() {
        // Coverage assertions for the failure modes the eval surfaced:
        // hallucinated rules, reasoning loops, write-as-edit-recovery,
        // re-read-after-edit (now obviated by patch/write returning
        // the post-edit body), and shell circumvention of
        // access-denied responses.
        let block = anti_patterns();
        assert!(
            block.contains("post-edit file body"),
            "no-re-read antipattern must explain that patch/write return the post-edit body",
        );
        assert!(
            block.contains("invent rules that nobody set"),
            "anti-patterns must call out fabricated rules",
        );
        assert!(
            block.contains("relitigate decisions"),
            "anti-patterns must call out reasoning-loop rederivation",
        );
        assert!(
            block.contains("regress to `write`"),
            "anti-patterns must forbid write-as-edit-recovery",
        );
        // The "no fabricated rules" antipattern must also forbid the
        // inverse — circumventing a real `Access denied` via shell.
        // refactor_02 in eval surfaced this: the model used `python3
        // -c "open(...)"` to bypass a blocked-file restriction.
        assert!(
            block.contains("Access denied"),
            "anti-patterns must cite the access-denied response by name",
        );
        assert!(
            block.contains("circumvent"),
            "anti-patterns must explicitly forbid circumventing access-denied",
        );
    }

    #[test]
    fn test_working_principles_endorse_no_change_outcome() {
        // The trap-style refactor scenarios surfaced this: the model
        // could not land on "no change required" even when its own
        // analysis pointed there.
        let block = working_principles();
        assert!(
            block.contains("\"No change required\" is a valid outcome"),
            "working principles must license the no-change outcome",
        );
    }

    #[test]
    fn test_tool_rules_lead_with_no_reread() {
        // Recency-tail position is the strongest spot in the prompt;
        // the no-re-read rule lives there now because it's the most
        // violated rule across the eval.
        let rules = tool_rules(AgentRole::Implement);
        let no_reread_idx = rules
            .find("Never re-read a file you just wrote or patched")
            .expect("no-re-read rule must be present");
        let structured_channel_idx = rules
            .find("structured tool-calling channel")
            .expect("structured-channel rule must be present");
        assert!(
            no_reread_idx < structured_channel_idx,
            "no-re-read rule should come first in tool rules",
        );
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

}
