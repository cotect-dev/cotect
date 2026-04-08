//! Elaborate model evaluation harness: 125 scenarios across 10 categories
//! and 3 difficulty tiers (plus 25 "extra hard" scenarios). The goal is to stress-test an agentic model's
//! ability to reason, use tools, recover from errors, and complete multi-
//! step workflows.
//!
//! Run the full suite with:
//!   COTECT_EVAL_ENDPOINT=http://server.local:8080/v1 \
//!   COTECT_EVAL_MODEL=unsloth/gemma-4-26B-A4B-it-GGUF:UD-Q4_K_XL \
//!   cargo test -p cotect eval_suite -- --ignored --nocapture
//!
//! Filter env vars (optional):
//!   COTECT_EVAL_FILTER       — substring match on scenario id
//!   COTECT_EVAL_CATEGORY     — one of: bugfix, refactor, implement, patch,
//!                               understanding, search, cross_file,
//!                               error_handling, recovery, planning
//!   COTECT_EVAL_DIFFICULTY   — easy | medium | hard
//!   COTECT_EVAL_MAX_TURNS    — per-scenario turn cap (default: 25)
//!   COTECT_EVAL_TIMEOUT      — per-scenario timeout seconds (default: 120)
//!   COTECT_EVAL_SYSTEM_STYLE — default | terse | detailed | cot | answer_first
//!   COTECT_EVAL_LIMIT        — only run first N matching scenarios
//!   COTECT_EVAL_FORMAT       — prompt format: auto (default) | plain | gemma |
//!                              llama3 | qwen | chatml | openai
//!   COTECT_EVAL_TRANSCRIPTS  — directory for per-scenario transcript .md files
//!   COTECT_EVAL_KEEP_DIRS    — 1 or true to preserve temp dirs for inspection
//!
//! Environment-only tuning — no code changes needed to try new prompts.

#![cfg(test)]
#![allow(clippy::too_many_lines)]

use std::path::Path;
use std::time::{Duration, Instant};

use tempfile::TempDir;
use tokio::sync::mpsc;

use crate::agent::orch::Orchestrator;
use crate::agent::types::*;

// ────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────

struct EvalConfig {
    endpoint: String,
    model: String,
    api_key: Option<String>,
    max_turns: usize,
    timeout: Duration,
    filter: Option<String>,
    category: Option<Category>,
    difficulty: Option<Difficulty>,
    system_style: SystemStyle,
    limit: Option<usize>,
    transcript_dir: Option<std::path::PathBuf>,
    format_override: Option<super::adapter::PromptFormat>,
    keep_dirs: bool,
}

impl EvalConfig {
    fn from_env() -> Option<Self> {
        let endpoint = std::env::var("COTECT_EVAL_ENDPOINT").ok()?;
        let model = std::env::var("COTECT_EVAL_MODEL").ok()?;
        let api_key = std::env::var("COTECT_EVAL_API_KEY").ok();
        let max_turns = std::env::var("COTECT_EVAL_MAX_TURNS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(25);
        let timeout_secs = std::env::var("COTECT_EVAL_TIMEOUT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(120u64);
        let filter = std::env::var("COTECT_EVAL_FILTER").ok().filter(|s| !s.is_empty());
        let category = std::env::var("COTECT_EVAL_CATEGORY").ok().and_then(Category::parse);
        let difficulty = std::env::var("COTECT_EVAL_DIFFICULTY").ok().and_then(Difficulty::parse);
        let system_style = std::env::var("COTECT_EVAL_SYSTEM_STYLE")
            .ok()
            .and_then(SystemStyle::parse)
            .unwrap_or(SystemStyle::Default);
        let limit = std::env::var("COTECT_EVAL_LIMIT").ok().and_then(|v| v.parse().ok());
        let transcript_dir = std::env::var("COTECT_EVAL_TRANSCRIPTS").ok().map(std::path::PathBuf::from);
        let format_override = std::env::var("COTECT_EVAL_FORMAT")
            .ok()
            .and_then(|v| parse_format_override(&v));
        let keep_dirs = std::env::var("COTECT_EVAL_KEEP_DIRS").ok().map_or(false, |v| v == "1" || v == "true");

        if let Some(ref d) = transcript_dir {
            let _ = std::fs::create_dir_all(d);
        }

        Some(Self {
            endpoint,
            model,
            api_key,
            max_turns,
            timeout: Duration::from_secs(timeout_secs),
            filter,
            category,
            difficulty,
            system_style,
            limit,
            transcript_dir,
            format_override,
            keep_dirs,
        })
    }

    fn provider(&self) -> ProviderConfig {
        ProviderConfig {
            id: "eval".into(),
            name: "Eval Provider".into(),
            endpoint: self.endpoint.clone(),
            api_key: self.api_key.clone(),
            model: self.model.clone(),
            format: self.format_override,
        }
    }
}

fn parse_format_override(s: &str) -> Option<super::adapter::PromptFormat> {
    use super::adapter::PromptFormat;
    match s.trim().to_lowercase().as_str() {
        "auto" | "" => None,
        "plain" => Some(PromptFormat::Plain),
        "gemma" => Some(PromptFormat::Gemma),
        "llama3" | "llama-3" => Some(PromptFormat::Llama3),
        "qwen" => Some(PromptFormat::Qwen),
        "chatml" => Some(PromptFormat::ChatML),
        "openai" | "openai_compat" | "openai-compat" => Some(PromptFormat::OpenAICompat),
        _ => None,
    }
}

// ────────────────────────────────────────────────────────────────────────
// Category / Difficulty / System prompt style
// ────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Category {
    Bugfix,
    Refactor,
    Implement,
    Patch,
    Understanding,
    Search,
    CrossFile,
    ErrorHandling,
    Recovery,
    Planning,
    Testing,
}

impl Category {
    fn parse(s: String) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "bugfix" | "bug" => Some(Self::Bugfix),
            "refactor" => Some(Self::Refactor),
            "implement" | "impl" => Some(Self::Implement),
            "patch" => Some(Self::Patch),
            "understanding" | "understand" => Some(Self::Understanding),
            "search" => Some(Self::Search),
            "cross_file" | "crossfile" | "cross-file" => Some(Self::CrossFile),
            "error_handling" | "errorhandling" | "error-handling" | "errh" => Some(Self::ErrorHandling),
            "recovery" => Some(Self::Recovery),
            "planning" | "plan" => Some(Self::Planning),
            "testing" | "test" => Some(Self::Testing),
            _ => None,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Bugfix => "bugfix",
            Self::Refactor => "refactor",
            Self::Implement => "implement",
            Self::Patch => "patch",
            Self::Understanding => "understanding",
            Self::Search => "search",
            Self::CrossFile => "cross_file",
            Self::ErrorHandling => "error_handling",
            Self::Recovery => "recovery",
            Self::Planning => "planning",
            Self::Testing => "testing",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Difficulty {
    Easy,
    Medium,
    Hard,
}

impl Difficulty {
    fn parse(s: String) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "easy" => Some(Self::Easy),
            "medium" | "med" => Some(Self::Medium),
            "hard" => Some(Self::Hard),
            _ => None,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Easy => "E",
            Self::Medium => "M",
            Self::Hard => "H",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SystemStyle {
    /// Use the production system prompt (from system_prompt::build_system_prompt)
    Default,
    /// Extremely short system prompt — terse
    Terse,
    /// Verbose, detailed instructions
    Detailed,
    /// Explicit chain-of-thought encouraged
    Cot,
    /// Answer-first style — discourage long reasoning
    AnswerFirst,
}

impl SystemStyle {
    fn parse(s: String) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "default" => Some(Self::Default),
            "terse" => Some(Self::Terse),
            "detailed" => Some(Self::Detailed),
            "cot" => Some(Self::Cot),
            "answer_first" | "answerfirst" | "answer-first" => Some(Self::AnswerFirst),
            _ => None,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Terse => "terse",
            Self::Detailed => "detailed",
            Self::Cot => "cot",
            Self::AnswerFirst => "answer_first",
        }
    }
}

// ────────────────────────────────────────────────────────────────────────
// Scenario spec
// ────────────────────────────────────────────────────────────────────────

type SetupFn = fn(&Path) -> SetupResult;

pub(super) struct SetupResult {
    pub(super) prompt: String,
    pub(super) scope_files: Vec<String>,
    pub(super) checks: Vec<Check>,
    pub(super) blocked_files: Vec<String>,
}

pub(super) struct ScenarioSpec {
    pub(super) id: &'static str,
    pub(super) category: Category,
    pub(super) difficulty: Difficulty,
    pub(super) role: AgentRole,
    pub(super) setup: SetupFn,
}

/// A single pass/fail check applied after a scenario runs.
#[derive(Clone)]
#[allow(dead_code)]
pub(super) enum Check {
    /// The final text output must contain this substring (case-insensitive).
    OutputContains(String),
    /// The final text output must contain all of these substrings (case-insensitive).
    OutputContainsAll(Vec<String>),
    /// The final text output must contain at least one of these substrings.
    OutputContainsAny(Vec<String>),
    /// The final text output must NOT contain any of these substrings (case-insensitive).
    OutputDoesNotContain(Vec<String>),
    /// A specific tool must have been invoked.
    UsedTool(String),
    /// A specific tool must have been invoked and succeeded at least once.
    ToolSucceeded(String),
    /// At least one of these tools was used.
    UsedAnyTool(Vec<String>),
    /// The scenario must reach TaskEvent::Complete.
    Completed,
    /// File at (TempDir-relative path) must exist on disk after the run.
    FileExists(String),
    /// File must exist and contain all of these substrings.
    FileContains(String, Vec<String>),
    /// File must NOT contain any of these substrings.
    FileDoesNotContain(String, Vec<String>),
    /// File line count within inclusive range.
    FileLineCount(String, usize, usize),
    /// The last integer found in the output must equal this value.
    /// Useful for numeric answers where the model may reason before answering.
    LastNumberEquals(i64),
    /// Run a shell command in the temp dir. Pass if exit code == 0.
    /// Fields: (command, timeout_seconds).
    RunExitOk(String, u64),
    /// Run a shell command in the temp dir. Pass if stdout+stderr contains all needles.
    /// Fields: (command, timeout_seconds, needles).
    RunOutputContains(String, u64, Vec<String>),
    /// Run a shell command in the temp dir. Pass if stdout+stderr does NOT contain any needle.
    /// Fields: (command, timeout_seconds, needles).
    RunOutputLacks(String, u64, Vec<String>),
}

// ────────────────────────────────────────────────────────────────────────
// Result collection
// ────────────────────────────────────────────────────────────────────────

#[derive(Debug)]
#[allow(dead_code)]
struct EvalResult {
    id: String,
    category: Category,
    difficulty: Difficulty,
    passed: bool,
    /// Whether the first shell test run already passed (None if no test run detected).
    first_try: Option<bool>,
    turns: usize,
    tool_calls: Vec<String>,
    elapsed: Duration,
    failed_checks: Vec<String>,
    output_preview: String,
    interrupted: Option<String>,
}

// ────────────────────────────────────────────────────────────────────────
// Event accumulator helpers
// ────────────────────────────────────────────────────────────────────────

struct RunOutcome {
    events: Vec<TaskEvent>,
    tool_calls: Vec<String>,
    full_text: String,
    reasoning_text: String,
    interrupted: Option<String>,
    completed: bool,
}

fn used_tool(events: &[TaskEvent], name: &str) -> bool {
    events.iter().any(|e| matches!(e, TaskEvent::ToolStart { tool_name, .. } if tool_name == name))
}

fn tool_succeeded(events: &[TaskEvent], name: &str) -> bool {
    events.iter().any(|e| matches!(e, TaskEvent::ToolEnd { tool_name, success, .. } if tool_name == name && *success))
}

/// Check whether the first shell execution that produced test-like output
/// already contained ALL_TESTS_PASSED — i.e. the model fixed it on the
/// first try without needing to iterate.
fn first_shell_passed(events: &[TaskEvent]) -> Option<bool> {
    for ev in events {
        if let TaskEvent::ToolEnd { tool_name, output: Some(out), .. } = ev {
            if tool_name == "shell" && (out.contains("ALL_TESTS_PASSED") || out.contains("assert") || out.contains("Traceback")) {
                return Some(out.contains("ALL_TESTS_PASSED"));
            }
        }
    }
    None // no test-like shell run found
}

fn contains_ci(hay: &str, needle: &str) -> bool {
    hay.to_lowercase().contains(&needle.to_lowercase())
}

// ────────────────────────────────────────────────────────────────────────
// Check evaluation
// ────────────────────────────────────────────────────────────────────────

fn evaluate_checks(
    checks: &[Check],
    outcome: &RunOutcome,
    dir: &Path,
) -> (bool, Vec<String>) {
    let mut failures = Vec::new();
    for check in checks {
        if let Some(err) = evaluate_one_check(check, outcome, dir) {
            failures.push(err);
        }
    }
    (failures.is_empty(), failures)
}

fn evaluate_one_check(check: &Check, outcome: &RunOutcome, dir: &Path) -> Option<String> {
    match check {
        Check::OutputContains(needle) => {
            if !contains_ci(&outcome.full_text, needle) {
                Some(format!("output missing: {:?}", needle))
            } else { None }
        }
        Check::OutputContainsAll(needles) => {
            let missing: Vec<&str> = needles.iter().filter(|n| !contains_ci(&outcome.full_text, n)).map(|s| s.as_str()).collect();
            if !missing.is_empty() {
                Some(format!("output missing all-of: {:?}", missing))
            } else { None }
        }
        Check::OutputContainsAny(needles) => {
            if !needles.iter().any(|n| contains_ci(&outcome.full_text, n)) {
                Some(format!("output missing any-of: {:?}", needles))
            } else { None }
        }
        Check::OutputDoesNotContain(needles) => {
            let found: Vec<&str> = needles.iter().filter(|n| contains_ci(&outcome.full_text, n)).map(|s| s.as_str()).collect();
            if !found.is_empty() {
                Some(format!("output contains forbidden: {:?}", found))
            } else { None }
        }
        Check::UsedTool(name) => {
            if !used_tool(&outcome.events, name) {
                Some(format!("tool not used: {}", name))
            } else { None }
        }
        Check::ToolSucceeded(name) => {
            if !tool_succeeded(&outcome.events, name) {
                Some(format!("tool not succeeded: {}", name))
            } else { None }
        }
        Check::UsedAnyTool(names) => {
            if !names.iter().any(|n| used_tool(&outcome.events, n)) {
                Some(format!("none of tools used: {:?}", names))
            } else { None }
        }
        Check::Completed => {
            if !outcome.completed {
                Some("scenario did not complete".into())
            } else { None }
        }
        Check::FileExists(rel) => {
            let p = dir.join(rel);
            if !p.exists() {
                Some(format!("file missing: {}", rel))
            } else { None }
        }
        Check::FileContains(rel, needles) => {
            let p = dir.join(rel);
            match std::fs::read_to_string(&p) {
                Ok(content) => {
                    let missing: Vec<&str> = needles.iter().filter(|n| !content.contains(n.as_str())).map(|s| s.as_str()).collect();
                    if !missing.is_empty() {
                        Some(format!("file {} missing: {:?}", rel, missing))
                    } else { None }
                }
                Err(e) => Some(format!("file {} unreadable: {}", rel, e)),
            }
        }
        Check::FileDoesNotContain(rel, needles) => {
            let p = dir.join(rel);
            match std::fs::read_to_string(&p) {
                Ok(content) => {
                    let found: Vec<&str> = needles.iter().filter(|n| content.contains(n.as_str())).map(|s| s.as_str()).collect();
                    if !found.is_empty() {
                        Some(format!("file {} contains forbidden: {:?}", rel, found))
                    } else { None }
                }
                Err(e) => Some(format!("file {} unreadable: {}", rel, e)),
            }
        }
        Check::FileLineCount(rel, min, max) => {
            let p = dir.join(rel);
            match std::fs::read_to_string(&p) {
                Ok(content) => {
                    let n = content.lines().count();
                    if n < *min || n > *max {
                        Some(format!("file {} has {} lines, expected {}..={}", rel, n, min, max))
                    } else { None }
                }
                Err(e) => Some(format!("file {} unreadable: {}", rel, e)),
            }
        }
        Check::LastNumberEquals(expected) => {
            // Extract the last signed integer from the output.
            // Scan right-to-left to find the final numeric token.
            let text = outcome.full_text.as_str();
            let mut last: Option<i64> = None;
            let bytes = text.as_bytes();
            let mut i = 0;
            while i < bytes.len() {
                let c = bytes[i];
                if c.is_ascii_digit() || (c == b'-' && i + 1 < bytes.len() && bytes[i + 1].is_ascii_digit()) {
                    // Skip negative sign only if preceded by non-alphanumeric
                    let start = i;
                    if c == b'-' { i += 1; }
                    while i < bytes.len() && bytes[i].is_ascii_digit() { i += 1; }
                    // Allow commas inside numbers (like 1,234) - skip them
                    let slice = &text[start..i];
                    let cleaned: String = slice.chars().filter(|c| c.is_ascii_digit() || *c == '-').collect();
                    if let Ok(n) = cleaned.parse::<i64>() {
                        last = Some(n);
                    }
                } else {
                    i += 1;
                }
            }
            match last {
                Some(n) if n == *expected => None,
                Some(n) => Some(format!("last number was {}, expected {}", n, expected)),
                None => Some(format!("no number found in output, expected {}", expected)),
            }
        }
        Check::RunExitOk(cmd, timeout_secs) => {
            run_check_shell(cmd, *timeout_secs, dir, |_output, code| {
                if code != 0 {
                    Some(format!("command `{}` exited with code {}", cmd_preview(cmd), code))
                } else { None }
            })
        }
        Check::RunOutputContains(cmd, timeout_secs, needles) => {
            run_check_shell(cmd, *timeout_secs, dir, |output, code| {
                if code != 0 {
                    return Some(format!("command `{}` exited with code {} (expected 0). output: {}",
                        cmd_preview(cmd), code, output_preview(&output)));
                }
                let missing: Vec<&str> = needles.iter()
                    .filter(|n| !contains_ci(&output, n))
                    .map(|s| s.as_str()).collect();
                if !missing.is_empty() {
                    Some(format!("command `{}` output missing: {:?}. got: {}",
                        cmd_preview(cmd), missing, output_preview(&output)))
                } else { None }
            })
        }
        Check::RunOutputLacks(cmd, timeout_secs, needles) => {
            run_check_shell(cmd, *timeout_secs, dir, |output, code| {
                if code != 0 {
                    return Some(format!("command `{}` exited with code {} (expected 0). output: {}",
                        cmd_preview(cmd), code, output_preview(&output)));
                }
                let found: Vec<&str> = needles.iter()
                    .filter(|n| contains_ci(&output, n))
                    .map(|s| s.as_str()).collect();
                if !found.is_empty() {
                    Some(format!("command `{}` output contains forbidden: {:?}",
                        cmd_preview(cmd), found))
                } else { None }
            })
        }
    }
}

/// Execute a shell command in the temp directory and apply a checker function.
fn run_check_shell(
    cmd: &str,
    timeout_secs: u64,
    dir: &Path,
    checker: impl FnOnce(String, i32) -> Option<String>,
) -> Option<String> {
    use std::process::Command;
    let child = Command::new("sh")
        .arg("-c")
        .arg(cmd)
        .current_dir(dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn();
    match child {
        Ok(child) => {
            let result = child.wait_with_output();
            match result {
                Ok(output) => {
                    let combined = format!(
                        "{}{}",
                        String::from_utf8_lossy(&output.stdout),
                        String::from_utf8_lossy(&output.stderr),
                    );
                    let code = output.status.code().unwrap_or(-1);
                    let _ = timeout_secs; // timeout enforced by the overall scenario timeout
                    checker(combined, code)
                }
                Err(e) => Some(format!("failed to wait for `{}`: {}", cmd_preview(cmd), e)),
            }
        }
        Err(e) => Some(format!("failed to run `{}`: {}", cmd_preview(cmd), e)),
    }
}

fn cmd_preview(cmd: &str) -> String {
    if cmd.len() > 80 { format!("{}...", &cmd[..77]) } else { cmd.to_string() }
}

fn output_preview(output: &str) -> String {
    if output.len() > 200 { format!("{}...", &output[..197]) } else { output.to_string() }
}

// ────────────────────────────────────────────────────────────────────────
// Prompt prefix based on system style
// ────────────────────────────────────────────────────────────────────────

fn user_prompt_with_style(style: SystemStyle, body: &str) -> String {
    match style {
        SystemStyle::Default => body.to_string(),
        SystemStyle::Terse => format!(
            "Be concise. Use tools when needed. Task:\n\n{body}"
        ),
        SystemStyle::Detailed => format!(
            "Read the task carefully. Use tools as needed. For file edits, always read the file first. \
             Verify your work. If a tool call fails, adjust your approach. Provide a clear final answer.\n\n\
             Task:\n\n{body}"
        ),
        SystemStyle::Cot => format!(
            "Think step-by-step before acting. Plan your approach, then execute it with tools. Task:\n\n{body}"
        ),
        SystemStyle::AnswerFirst => format!(
            "Answer directly and concisely. Do not explain your reasoning unless asked. Use tools only when necessary. Task:\n\n{body}"
        ),
    }
}

// ────────────────────────────────────────────────────────────────────────
// Transcript building
// ────────────────────────────────────────────────────────────────────────

fn build_transcript(
    spec: &ScenarioSpec,
    prompt: &str,
    scope_files: &[String],
    outcome: &RunOutcome,
    passed: bool,
    first_try: Option<bool>,
    failed_checks: &[String],
    elapsed: Duration,
    interrupted: &Option<String>,
    dir: &Path,
) -> String {
    use std::fmt::Write as _;
    let mut s = String::with_capacity(16384);

    let status = if passed { "PASS" } else { "FAIL" };
    let _ = writeln!(s, "# {} \u{2014} {}", spec.id, status);
    let _ = writeln!(s);
    let _ = writeln!(s, "- **category**: {}", spec.category.label());
    let _ = writeln!(s, "- **difficulty**: {:?}", spec.difficulty);
    let _ = writeln!(s, "- **role**: {:?}", spec.role);
    let _ = writeln!(s, "- **elapsed**: {:.1}s", elapsed.as_secs_f64());
    let _ = writeln!(s, "- **tool calls**: {}", outcome.tool_calls.len());
    let _ = writeln!(s, "- **tools used**: {:?}", outcome.tool_calls);
    let _ = writeln!(s, "- **completed**: {}", outcome.completed);
    if passed {
        let ft_label = match first_try {
            Some(true) => "yes",
            Some(false) => "no",
            None => "n/a",
        };
        let _ = writeln!(s, "- **1st try**: {}", ft_label);
    }
    if let Some(r) = interrupted {
        let _ = writeln!(s, "- **interrupted**: {}", r);
    }
    if !failed_checks.is_empty() {
        let _ = writeln!(s, "- **failed checks**:");
        for f in failed_checks {
            let _ = writeln!(s, "  - {}", f);
        }
    }
    let _ = writeln!(s);
    // User prompt
    let _ = writeln!(s, "## User Prompt\n\n```\n{}\n```\n", prompt);

    // Scope
    if !scope_files.is_empty() {
        let _ = writeln!(s, "## Scope Files\n");
        for f in scope_files {
            let _ = writeln!(s, "- {}", f);
        }
        let _ = writeln!(s);
    }

    // Reasoning
    if !outcome.reasoning_text.is_empty() {
        let _ = writeln!(s, "## Reasoning\n\n```\n{}\n```\n", outcome.reasoning_text);
    }

    // Final assistant output
    let _ = writeln!(s, "## Final Output\n\n```\n{}\n```\n", outcome.full_text);

    // Event timeline — skip streaming deltas (reasoning/partial text) to keep
    // it readable. The consolidated Reasoning and Final Output sections above
    // already include the full text.
    let _ = writeln!(s, "## Event Timeline\n");
    for (i, ev) in outcome.events.iter().enumerate() {
        match ev {
            TaskEvent::Text { content, partial } => {
                if !partial {
                    let _ = writeln!(s, "**{i}. Text (final):**\n```\n{}\n```\n", content);
                }
            }
            TaskEvent::Reasoning { .. } => {
                // Skipped — see consolidated "Reasoning" section above.
            }
            TaskEvent::ToolStart { tool_name, file_path, description, arguments } => {
                let _ = writeln!(s, "**{i}. Tool start: `{}`**  file={:?}  desc={:?}", tool_name, file_path, description);
                if let Some(args) = arguments {
                    // Pretty-print JSON arguments if possible, otherwise raw
                    let display = serde_json::from_str::<serde_json::Value>(args)
                        .ok()
                        .and_then(|v| serde_json::to_string_pretty(&v).ok())
                        .unwrap_or_else(|| args.clone());
                    let _ = writeln!(s, "\n```json\n{}\n```\n", display);
                } else {
                    let _ = writeln!(s);
                }
            }
            TaskEvent::ToolEnd { tool_name, success, output, file_path: _ } => {
                let marker = if *success { "OK" } else { "ERR" };
                let out = output.as_deref().unwrap_or("");
                let out = truncate_for_transcript(out, 4000);
                let _ = writeln!(s, "**{i}. Tool end: `{}` [{marker}]**\n```\n{}\n```\n", tool_name, out);
            }
            TaskEvent::Error { message } => {
                let _ = writeln!(s, "**{i}. Error:** {}\n", message);
            }
            TaskEvent::Interrupted { reason } => {
                let _ = writeln!(s, "**{i}. Interrupted:** {}\n", reason);
            }
            TaskEvent::Complete => {
                let _ = writeln!(s, "**{i}. Complete.**\n");
            }
            other => {
                let _ = writeln!(s, "**{i}. Other event:** {:?}\n", other);
            }
        }
    }

    // Final file contents — dump all files in the temp dir for post-mortem analysis
    let _ = writeln!(s, "## Final Files\n");
    if let Ok(entries) = collect_files_recursive(dir) {
        if entries.is_empty() {
            let _ = writeln!(s, "_No files in temp directory._\n");
        }
        for entry in entries {
            let rel = entry.strip_prefix(dir).unwrap_or(&entry);
            let _ = writeln!(s, "### `{}`\n", rel.display());
            match std::fs::read_to_string(&entry) {
                Ok(content) => {
                    let content = truncate_for_transcript(&content, 8000);
                    let _ = writeln!(s, "```\n{}\n```\n", content);
                }
                Err(e) => {
                    let _ = writeln!(s, "_Could not read: {}_\n", e);
                }
            }
        }
    }

    s
}

/// Recursively collect all files under `dir`, sorted.
fn collect_files_recursive(dir: &Path) -> std::io::Result<Vec<std::path::PathBuf>> {
    let mut files = Vec::new();
    fn walk(dir: &Path, files: &mut Vec<std::path::PathBuf>) -> std::io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                walk(&path, files)?;
            } else {
                files.push(path);
            }
        }
        Ok(())
    }
    walk(dir, &mut files)?;
    files.sort();
    Ok(files)
}

fn truncate_for_transcript(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let prefix: String = s.chars().take(max_chars).collect();
        format!("{prefix}\n... [truncated, {} chars total]", s.chars().count())
    }
}

// ────────────────────────────────────────────────────────────────────────
// Scenario runner
// ────────────────────────────────────────────────────────────────────────

async fn run_scenario(cfg: &EvalConfig, spec: &ScenarioSpec) -> EvalResult {
    use std::io::Write;

    let dir = TempDir::new().expect("tempdir");
    let dir_path = dir.path().to_path_buf();

    // Call setup to create files + build prompt + checks
    let setup = (spec.setup)(&dir_path);

    let scope = TaskScope {
        root_path: dir_path.to_string_lossy().into(),
        files: setup.scope_files.clone(),
        directory: None,
        declarations: vec![],
        description: None,
        blocked_files: setup.blocked_files.clone(),
    };

    let final_prompt = user_prompt_with_style(cfg.system_style, &setup.prompt);

    let (tx, rx) = mpsc::unbounded_channel::<TaskEvent>();

    let request = TaskRequest {
        id: format!("eval-{}", spec.id),
        prompt: final_prompt,
        scope,
        role: spec.role,
        conversation_id: None,
    };

    let start = Instant::now();

    eprint!(
        "  [{}] {:<40} ",
        spec.difficulty.label(),
        spec.id,
    );
    let _ = std::io::stderr().flush();

    let events_handle = tokio::spawn(async move {
        let mut rx = rx;
        let mut events = Vec::new();
        let mut tool_calls = Vec::new();
        let mut full_text = String::new();
        let mut reasoning_text = String::new();
        let mut interrupted: Option<String> = None;
        let mut completed = false;
        let mut heartbeat = tokio::time::interval(std::time::Duration::from_secs(10));
        heartbeat.tick().await; // consume the immediate first tick

        loop {
            tokio::select! {
                ev = rx.recv() => {
                    let Some(ev) = ev else { break };
                    match &ev {
                        TaskEvent::Text { content, partial } => {
                            if *partial { full_text.push_str(content); } else { full_text = content.clone(); }
                        }
                        TaskEvent::Reasoning { content } => {
                            reasoning_text.push_str(content);
                        }
                        TaskEvent::ToolStart { tool_name, .. } => {
                            tool_calls.push(tool_name.clone());
                            eprint!(".{}", &tool_name[..3.min(tool_name.len())]);
                            let _ = std::io::stderr().flush();
                            heartbeat.reset();
                        }
                        TaskEvent::ToolEnd { success, .. } => {
                            if !*success {
                                eprint!("!");
                                let _ = std::io::stderr().flush();
                            }
                            heartbeat.reset();
                        }
                        TaskEvent::Complete => { completed = true; }
                        TaskEvent::Interrupted { reason } => { interrupted = Some(reason.clone()); }
                        _ => {}
                    }
                    events.push(ev);
                }
                _ = heartbeat.tick() => {
                    eprint!("~");
                    let _ = std::io::stderr().flush();
                }
            }
        }
        RunOutcome { events, tool_calls, full_text, reasoning_text, interrupted, completed }
    });

    let orch_result = tokio::time::timeout(cfg.timeout, async {
        let mut orch = Orchestrator::new(&cfg.provider(), &request, tx);
        orch.set_max_turns(cfg.max_turns);
        orch.run().await
    }).await;

    let elapsed = start.elapsed();
    let outcome = events_handle.await.unwrap_or_else(|_| RunOutcome {
        events: vec![], tool_calls: vec![], full_text: String::new(), reasoning_text: String::new(),
        interrupted: Some("join failed".into()), completed: false,
    });

    let approx_turns = (outcome.tool_calls.len() + 1).min(cfg.max_turns);

    let (passed, failed_checks, interrupted) = match orch_result {
        Ok(Ok(())) => {
            let (ok, failures) = evaluate_checks(&setup.checks, &outcome, &dir_path);
            (ok, failures, outcome.interrupted.clone())
        }
        Ok(Err(e)) => (false, vec![format!("orch error: {e}")], outcome.interrupted.clone()),
        Err(_) => {
            // Timeout — still evaluate file-based checks since files may already
            // be written to disk. Skip the Completed check (scenario didn't finish).
            let timeout_checks: Vec<Check> = setup.checks.iter()
                .filter(|c| !matches!(c, Check::Completed))
                .cloned()
                .collect();
            let (ok, mut failures) = evaluate_checks(&timeout_checks, &outcome, &dir_path);
            failures.insert(0, format!("timeout {}s", cfg.timeout.as_secs()));
            (ok && failures.len() <= 1, failures, Some("timeout".into()))
        }
    };

    let first_try = first_shell_passed(&outcome.events);
    let status = if passed {
        match first_try {
            Some(true) => "\x1b[32mPASS\x1b[0m \x1b[36m1st try\x1b[0m",
            _ => "\x1b[32mPASS\x1b[0m",
        }
    } else { "\x1b[31mFAIL\x1b[0m" };
    eprintln!(" {} {:>5.1}s {:>2}t", status, elapsed.as_secs_f64(), outcome.tool_calls.len());
    if !passed {
        for reason in &failed_checks {
            let s: String = reason.chars().take(100).collect();
            eprintln!("             \x1b[31m> {}\x1b[0m", s);
        }
    }
    if let Some(reason) = &interrupted {
        let s: String = reason.chars().take(60).collect();
        eprintln!("             > interrupted: {}", s);
    }

    let output_preview: String = outcome.full_text.chars().take(300).collect();

    // Write full transcript if requested
    if let Some(ref tdir) = cfg.transcript_dir {
        let transcript_path = tdir.join(format!("{}.md", spec.id));
        let transcript = build_transcript(
            spec, &setup.prompt, &setup.scope_files, &outcome,
            passed, first_try, &failed_checks, elapsed, &interrupted, &dir_path,
        );
        let _ = std::fs::write(&transcript_path, transcript);
    }

    // Optionally preserve the temp directory for manual inspection
    if cfg.keep_dirs {
        let kept = dir.keep(); // prevents cleanup
        eprintln!("             dir: {}", kept.display());
    }

    EvalResult {
        id: spec.id.into(),
        category: spec.category,
        difficulty: spec.difficulty,
        passed,
        first_try,
        turns: approx_turns,
        tool_calls: outcome.tool_calls,
        elapsed,
        failed_checks,
        output_preview,
        interrupted,
    }
}

// ────────────────────────────────────────────────────────────────────────
// Report printing
// ────────────────────────────────────────────────────────────────────────

fn print_report(cfg: &EvalConfig, results: &[EvalResult]) {
    let total = results.len();
    let passed: usize = results.iter().filter(|r| r.passed).count();
    let total_time: Duration = results.iter().map(|r| r.elapsed).sum();
    let total_tools: usize = results.iter().map(|r| r.tool_calls.len()).sum();

    println!("\n{}", "=".repeat(78));
    println!("RESULTS  model={} style={}", cfg.model, cfg.system_style.label());
    println!("{}", "=".repeat(78));

    // By category
    let cats = [
        Category::Bugfix, Category::Refactor, Category::Implement, Category::Patch,
        Category::Understanding, Category::Search, Category::CrossFile,
        Category::ErrorHandling, Category::Recovery, Category::Planning,
        Category::Testing,
    ];
    println!("\nBy category:");
    for cat in cats {
        let cat_results: Vec<&EvalResult> = results.iter().filter(|r| r.category == cat).collect();
        if cat_results.is_empty() { continue; }
        let p = cat_results.iter().filter(|r| r.passed).count();
        let ft = cat_results.iter().filter(|r| r.passed && r.first_try == Some(true)).count();
        let t = cat_results.len();
        let pct = (p as f64 / t as f64) * 100.0;
        let ft_str = if ft > 0 { format!("  ({} 1st try)", ft) } else { String::new() };
        println!("  {:>14}  {}/{}  ({:>5.1}%){}", cat.label(), p, t, pct, ft_str);
    }

    // By difficulty
    println!("\nBy difficulty:");
    for diff in [Difficulty::Easy, Difficulty::Medium, Difficulty::Hard] {
        let d_results: Vec<&EvalResult> = results.iter().filter(|r| r.difficulty == diff).collect();
        if d_results.is_empty() { continue; }
        let p = d_results.iter().filter(|r| r.passed).count();
        let ft = d_results.iter().filter(|r| r.passed && r.first_try == Some(true)).count();
        let t = d_results.len();
        let pct = (p as f64 / t as f64) * 100.0;
        let ft_str = if ft > 0 { format!("  ({} 1st try)", ft) } else { String::new() };
        println!("  {:>14}  {}/{}  ({:>5.1}%){}", format!("{:?}", diff), p, t, pct, ft_str);
    }

    // Failed
    let fails: Vec<&EvalResult> = results.iter().filter(|r| !r.passed).collect();
    if !fails.is_empty() {
        println!("\nFailures ({}):", fails.len());
        for r in &fails {
            let first = r.failed_checks.first().map(|s| s.as_str()).unwrap_or("?");
            println!(
                "  [{}] {:<40} {:>5.1}s {:>2}t  {}",
                r.difficulty.label(), r.id, r.elapsed.as_secs_f64(), r.tool_calls.len(),
                first.chars().take(70).collect::<String>(),
            );
        }
    }

    let first_try_count = results.iter()
        .filter(|r| r.passed && r.first_try == Some(true))
        .count();

    println!("\n{}", "─".repeat(78));
    println!(
        "Score: {}/{} ({:.1}%)  1st try: {}  total {:.1}s  tools {}  avg {:.1}s/scenario",
        passed, total,
        (passed as f64 / total as f64) * 100.0,
        first_try_count,
        total_time.as_secs_f64(),
        total_tools,
        total_time.as_secs_f64() / total.max(1) as f64,
    );
    println!("{}", "=".repeat(78));
}

// ────────────────────────────────────────────────────────────────────────
// Scenario definitions — 125 total, split by category under eval_scenarios/
// ────────────────────────────────────────────────────────────────────────

#[path = "eval_scenarios/mod.rs"]
mod eval_scenarios;

use eval_scenarios::make_scenarios;

// ────────────────────────────────────────────────────────────────────────
// Main test entry points
// ────────────────────────────────────────────────────────────────────────

fn collect_scenarios(cfg: &EvalConfig) -> Vec<ScenarioSpec> {
    let mut all = make_scenarios();

    if let Some(cat) = cfg.category {
        all.retain(|s| s.category == cat);
    }
    if let Some(diff) = cfg.difficulty {
        all.retain(|s| s.difficulty == diff);
    }
    if let Some(filter) = &cfg.filter {
        all.retain(|s| s.id.contains(filter.as_str()));
    }
    if let Some(lim) = cfg.limit {
        all.truncate(lim);
    }
    all
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_suite() {
    let cfg = EvalConfig::from_env()
        .expect("Set COTECT_EVAL_ENDPOINT and COTECT_EVAL_MODEL to run eval tests");

    let scenarios = collect_scenarios(&cfg);
    let total = scenarios.len();

    println!("\n{}", "=".repeat(78));
    println!("COTECT EVAL SUITE — 125 scenarios");
    println!("  model      : {}", cfg.model);
    println!("  endpoint   : {}", cfg.endpoint);
    println!("  style      : {}", cfg.system_style.label());
    println!("  timeout    : {}s/scenario", cfg.timeout.as_secs());
    println!("  max turns  : {}", cfg.max_turns);
    println!("  running    : {} scenarios", total);
    if let Some(c) = cfg.category { println!("  category   : {}", c.label()); }
    if let Some(d) = cfg.difficulty { println!("  difficulty : {}", d.label()); }
    if let Some(f) = &cfg.filter { println!("  filter     : {}", f); }
    println!("{}", "=".repeat(78));

    let mut results: Vec<EvalResult> = Vec::with_capacity(total);
    for (i, spec) in scenarios.iter().enumerate() {
        eprint!("[{:>3}/{}] ", i + 1, total);
        let r = run_scenario(&cfg, spec).await;
        results.push(r);
    }

    print_report(&cfg, &results);

    // Don't assert; let the user see the report.
}

// ────────────────────────────────────────────────────────────────────────
// Also expose legacy single-category shortcuts so we can easily rerun a
// subset from cargo test by name.
// ────────────────────────────────────────────────────────────────────────

async fn run_category(cat: Category) {
    let Some(mut cfg) = EvalConfig::from_env() else {
        panic!("Set COTECT_EVAL_ENDPOINT and COTECT_EVAL_MODEL");
    };
    cfg.category = Some(cat);
    let scenarios = collect_scenarios(&cfg);
    let total = scenarios.len();

    println!("\nCategory {} — {} scenarios\n", cat.label(), total);
    let mut results = Vec::with_capacity(total);
    for (i, spec) in scenarios.iter().enumerate() {
        eprint!("[{:>3}/{}] ", i + 1, total);
        let r = run_scenario(&cfg, spec).await;
        results.push(r);
    }
    print_report(&cfg, &results);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_bugfix() { run_category(Category::Bugfix).await; }

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_refactor() { run_category(Category::Refactor).await; }

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_implement() { run_category(Category::Implement).await; }

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_patch() { run_category(Category::Patch).await; }

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_understanding() { run_category(Category::Understanding).await; }

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_search() { run_category(Category::Search).await; }

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_cross_file() { run_category(Category::CrossFile).await; }

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_error_handling() { run_category(Category::ErrorHandling).await; }

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_recovery() { run_category(Category::Recovery).await; }

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_planning() { run_category(Category::Planning).await; }

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_testing() { run_category(Category::Testing).await; }

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_extra_hard() {
    let Some(mut cfg) = EvalConfig::from_env() else {
        panic!("Set COTECT_EVAL_ENDPOINT and COTECT_EVAL_MODEL");
    };
    cfg.filter = Some("xhard".into());
    let scenarios = collect_scenarios(&cfg);
    let total = scenarios.len();

    println!("\nExtra-hard suite — {} scenarios\n", total);
    let mut results = Vec::with_capacity(total);
    for (i, spec) in scenarios.iter().enumerate() {
        eprint!("[{:>3}/{}] ", i + 1, total);
        let r = run_scenario(&cfg, spec).await;
        results.push(r);
    }
    print_report(&cfg, &results);
}
