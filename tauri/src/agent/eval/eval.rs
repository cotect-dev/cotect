//! Model evaluation harness: 30 "extra hard" scenarios designed to stress-test
//! an agentic model's ability to reason, use tools, recover from errors, and
//! complete multi-step workflows. Easier tiers were dropped — modern local
//! models pass them reliably and they produce no useful signal.
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
//!   COTECT_EVAL_TIMEOUT      — per-scenario timeout seconds (default: 600)
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

// Configuration

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
    disable_thinking: Option<bool>,
}

impl EvalConfig {
    fn from_env() -> Option<Self> {
        let endpoint = std::env::var("COTECT_EVAL_ENDPOINT").ok()?;
        let model = std::env::var("COTECT_EVAL_MODEL").ok()?;
        let api_key = std::env::var("COTECT_EVAL_API_KEY").ok();
        // Turn budget: 25 is enough for every scenario in the suite when the
        // model stays on task; beyond ~30 every extra turn is a spiral.
        let max_turns = std::env::var("COTECT_EVAL_MAX_TURNS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(25);
        // Per-scenario wall-clock budget. Defaults to 600s — agentic tasks
        // at ~30 tok/s need room for a genuinely iterative read → edit →
        // test → patch cycle. The streaming-tail cutoff + doom-loop
        // detector trim pathological tails well before this fires. The
        // rubric-side `Check::RunExitOk` timeouts remain independent
        // (30s per shell test by default).
        let timeout_secs = std::env::var("COTECT_EVAL_TIMEOUT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(600u64);
        let filter = std::env::var("COTECT_EVAL_FILTER")
            .ok()
            .filter(|s| !s.is_empty());
        let category = std::env::var("COTECT_EVAL_CATEGORY")
            .ok()
            .and_then(Category::parse);
        let difficulty = std::env::var("COTECT_EVAL_DIFFICULTY")
            .ok()
            .and_then(Difficulty::parse);
        let system_style = std::env::var("COTECT_EVAL_SYSTEM_STYLE")
            .ok()
            .and_then(SystemStyle::parse)
            .unwrap_or(SystemStyle::Default);
        let limit = std::env::var("COTECT_EVAL_LIMIT")
            .ok()
            .and_then(|v| v.parse().ok());
        let transcript_dir = std::env::var("COTECT_EVAL_TRANSCRIPTS")
            .ok()
            .map(std::path::PathBuf::from);
        let format_override = std::env::var("COTECT_EVAL_FORMAT")
            .ok()
            .and_then(|v| parse_format_override(&v));
        let keep_dirs = std::env::var("COTECT_EVAL_KEEP_DIRS")
            .ok()
            .is_some_and(|v| v == "1" || v == "true");
        // Opt the model out of thinking mode. For Qwen this appends `/no_think`
        // to the system prompt; for other formats it's a no-op today. Pair
        // with `--reasoning-budget 0` on the server for a hard cap.
        let disable_thinking = std::env::var("COTECT_EVAL_NO_THINK")
            .ok()
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"));

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
            disable_thinking,
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
            disable_thinking: self.disable_thinking,
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

// Category / Difficulty / System prompt style

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Category {
    Bugfix,
    Refactor,
    Implement,
    Patch,
    Understanding,
    Search,
    CrossFile,
    Testing,
    Security,
    Concurrency,
    Performance,
    Context,
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
            "testing" | "test" => Some(Self::Testing),
            "security" | "sec" => Some(Self::Security),
            "concurrency" | "concur" => Some(Self::Concurrency),
            "performance" | "perf" => Some(Self::Performance),
            "context" | "ctx" => Some(Self::Context),
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
            Self::Testing => "testing",
            Self::Security => "security",
            Self::Concurrency => "concurrency",
            Self::Performance => "performance",
            Self::Context => "context",
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

// Scenario spec

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
    /// Executables that must be available in PATH for the scenario to run.
    /// If any is missing the runner marks SKIPPED (rather than FAIL) before
    /// calling setup, so scenarios whose setup itself needs the tool (e.g.
    /// `git init` for the regression hunt) don't panic on hosts without it.
    pub(super) required_tools: &'static [&'static str],
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
    /// File at `target_rel` must differ from `reference_abs` by AT MOST
    /// `max_changed_lines` (counted via `diff` added+removed lines). Used to
    /// enforce localized edits on a large seed file — e.g. "touch only these
    /// three TODOs, leave the other 2497 lines alone".
    FileDiffLinesAtMost(String, String, usize),
}

// Result collection

#[derive(Debug)]
#[allow(dead_code)]
struct EvalResult {
    id: String,
    category: Category,
    difficulty: Difficulty,
    passed: bool,
    /// True when the scenario never ran because a required tool (cargo, go,
    /// node, ...) is absent from PATH. Skipped scenarios are excluded from
    /// pass/fail totals in the final report.
    skipped: bool,
    /// Whether the first shell test run already passed (None if no test run detected).
    first_try: Option<bool>,
    turns: usize,
    tool_calls: Vec<String>,
    elapsed: Duration,
    failed_checks: Vec<String>,
    output_preview: String,
    interrupted: Option<String>,
}

// Event accumulator helpers

struct RunOutcome {
    events: Vec<TaskEvent>,
    /// Wall seconds since scenario start at which each `events[i]` was
    /// received. Same length as `events`. Used by the transcript writer
    /// to surface inter-tool gaps in saved markdown — invaluable when
    /// scrolling through a long run looking for where the budget went.
    event_times: Vec<f64>,
    tool_calls: Vec<String>,
    full_text: String,
    reasoning_text: String,
    interrupted: Option<String>,
    completed: bool,
}

fn used_tool(events: &[TaskEvent], name: &str) -> bool {
    events
        .iter()
        .any(|e| matches!(e, TaskEvent::ToolStart { tool_name, .. } if tool_name == name))
}

fn tool_succeeded(events: &[TaskEvent], name: &str) -> bool {
    events.iter().any(|e| matches!(e, TaskEvent::ToolEnd { tool_name, success, .. } if tool_name == name && *success))
}

/// Check whether the first shell execution that produced test-like output
/// already contained ALL_TESTS_PASSED — i.e. the model fixed it on the
/// first try without needing to iterate.
fn first_shell_passed(events: &[TaskEvent]) -> Option<bool> {
    for ev in events {
        if let TaskEvent::ToolEnd {
            tool_name,
            output: Some(out),
            ..
        } = ev
        {
            if tool_name == "shell"
                && (out.contains("ALL_TESTS_PASSED")
                    || out.contains("assert")
                    || out.contains("Traceback"))
            {
                return Some(out.contains("ALL_TESTS_PASSED"));
            }
        }
    }
    None // no test-like shell run found
}

/// Returns true if no tool call failed (no `success: false` in ToolEnd events).
fn all_tools_succeeded(events: &[TaskEvent]) -> bool {
    !events
        .iter()
        .any(|e| matches!(e, TaskEvent::ToolEnd { success, .. } if !success))
}

/// Determine "1st try": for test-running scenarios use shell output heuristic,
/// otherwise check that no tool calls failed during the run.
fn determine_first_try(events: &[TaskEvent]) -> Option<bool> {
    match first_shell_passed(events) {
        some @ Some(_) => some,
        None => Some(all_tools_succeeded(events)),
    }
}

fn contains_ci(hay: &str, needle: &str) -> bool {
    hay.to_lowercase().contains(&needle.to_lowercase())
}

// Check evaluation

fn evaluate_checks(checks: &[Check], outcome: &RunOutcome, dir: &Path) -> (bool, Vec<String>) {
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
            } else {
                None
            }
        }
        Check::OutputContainsAll(needles) => {
            let missing: Vec<&str> = needles
                .iter()
                .filter(|n| !contains_ci(&outcome.full_text, n))
                .map(|s| s.as_str())
                .collect();
            if !missing.is_empty() {
                Some(format!("output missing all-of: {:?}", missing))
            } else {
                None
            }
        }
        Check::OutputContainsAny(needles) => {
            if !needles.iter().any(|n| contains_ci(&outcome.full_text, n)) {
                Some(format!("output missing any-of: {:?}", needles))
            } else {
                None
            }
        }
        Check::OutputDoesNotContain(needles) => {
            let found: Vec<&str> = needles
                .iter()
                .filter(|n| contains_ci(&outcome.full_text, n))
                .map(|s| s.as_str())
                .collect();
            if !found.is_empty() {
                Some(format!("output contains forbidden: {:?}", found))
            } else {
                None
            }
        }
        Check::UsedTool(name) => {
            if !used_tool(&outcome.events, name) {
                Some(format!("tool not used: {}", name))
            } else {
                None
            }
        }
        Check::ToolSucceeded(name) => {
            if !tool_succeeded(&outcome.events, name) {
                Some(format!("tool not succeeded: {}", name))
            } else {
                None
            }
        }
        Check::UsedAnyTool(names) => {
            if !names.iter().any(|n| used_tool(&outcome.events, n)) {
                Some(format!("none of tools used: {:?}", names))
            } else {
                None
            }
        }
        Check::Completed => {
            if !outcome.completed {
                Some("scenario did not complete".into())
            } else {
                None
            }
        }
        Check::FileExists(rel) => {
            let p = dir.join(rel);
            if !p.exists() {
                Some(format!("file missing: {}", rel))
            } else {
                None
            }
        }
        Check::FileContains(rel, needles) => {
            let p = dir.join(rel);
            match std::fs::read_to_string(&p) {
                Ok(content) => {
                    let missing: Vec<&str> = needles
                        .iter()
                        .filter(|n| !content.contains(n.as_str()))
                        .map(|s| s.as_str())
                        .collect();
                    if !missing.is_empty() {
                        Some(format!("file {} missing: {:?}", rel, missing))
                    } else {
                        None
                    }
                }
                Err(e) => Some(format!("file {} unreadable: {}", rel, e)),
            }
        }
        Check::FileDoesNotContain(rel, needles) => {
            let p = dir.join(rel);
            match std::fs::read_to_string(&p) {
                Ok(content) => {
                    let found: Vec<&str> = needles
                        .iter()
                        .filter(|n| content.contains(n.as_str()))
                        .map(|s| s.as_str())
                        .collect();
                    if !found.is_empty() {
                        Some(format!("file {} contains forbidden: {:?}", rel, found))
                    } else {
                        None
                    }
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
                        Some(format!(
                            "file {} has {} lines, expected {}..={}",
                            rel, n, min, max
                        ))
                    } else {
                        None
                    }
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
                if c.is_ascii_digit()
                    || (c == b'-' && i + 1 < bytes.len() && bytes[i + 1].is_ascii_digit())
                {
                    // Skip negative sign only if preceded by non-alphanumeric
                    let start = i;
                    if c == b'-' {
                        i += 1;
                    }
                    while i < bytes.len() && bytes[i].is_ascii_digit() {
                        i += 1;
                    }
                    // Allow commas inside numbers (like 1,234) - skip them
                    let slice = &text[start..i];
                    let cleaned: String = slice
                        .chars()
                        .filter(|c| c.is_ascii_digit() || *c == '-')
                        .collect();
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
                    Some(format!(
                        "command `{}` exited with code {}",
                        cmd_preview(cmd),
                        code
                    ))
                } else {
                    None
                }
            })
        }
        Check::RunOutputContains(cmd, timeout_secs, needles) => {
            run_check_shell(cmd, *timeout_secs, dir, |output, code| {
                if code != 0 {
                    return Some(format!(
                        "command `{}` exited with code {} (expected 0). output: {}",
                        cmd_preview(cmd),
                        code,
                        output_preview(&output)
                    ));
                }
                let missing: Vec<&str> = needles
                    .iter()
                    .filter(|n| !contains_ci(&output, n))
                    .map(|s| s.as_str())
                    .collect();
                if !missing.is_empty() {
                    Some(format!(
                        "command `{}` output missing: {:?}. got: {}",
                        cmd_preview(cmd),
                        missing,
                        output_preview(&output)
                    ))
                } else {
                    None
                }
            })
        }
        Check::RunOutputLacks(cmd, timeout_secs, needles) => {
            run_check_shell(cmd, *timeout_secs, dir, |output, code| {
                if code != 0 {
                    return Some(format!(
                        "command `{}` exited with code {} (expected 0). output: {}",
                        cmd_preview(cmd),
                        code,
                        output_preview(&output)
                    ));
                }
                let found: Vec<&str> = needles
                    .iter()
                    .filter(|n| contains_ci(&output, n))
                    .map(|s| s.as_str())
                    .collect();
                if !found.is_empty() {
                    Some(format!(
                        "command `{}` output contains forbidden: {:?}",
                        cmd_preview(cmd),
                        found
                    ))
                } else {
                    None
                }
            })
        }
        Check::FileDiffLinesAtMost(reference_abs, target_rel, max_changed) => {
            let target_abs = dir.join(target_rel);
            if !target_abs.exists() {
                return Some(format!("file missing: {}", target_rel));
            }
            let cmd = format!(
                "diff -u {:?} {:?} | grep -E '^[+-][^+-]' | wc -l",
                reference_abs, target_abs,
            );
            run_check_shell(&cmd, 30, dir, |output, _code| {
                let count: usize = output.trim().parse().unwrap_or(usize::MAX);
                if count > *max_changed {
                    Some(format!(
                        "file {} diffs by {} lines vs reference, max allowed {}",
                        target_rel, count, max_changed,
                    ))
                } else {
                    None
                }
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
    if cmd.len() > 80 {
        format!("{}...", &cmd[..77])
    } else {
        cmd.to_string()
    }
}

fn output_preview(output: &str) -> String {
    if output.len() > 200 {
        format!("{}...", &output[..197])
    } else {
        output.to_string()
    }
}

// Prompt prefix based on system style

/// Build an evaluation-time notice listing files the model must not read.
/// Returns `None` when the scenario has no blocked files. Paths are shown by
/// basename only — absolute tempdir paths are noise to the model and the
/// sandbox matches on `ends_with`, so the basename is the identifying part.
fn blocked_files_notice(blocked: &[String]) -> Option<String> {
    if blocked.is_empty() {
        return None;
    }
    let names: Vec<String> = blocked
        .iter()
        .map(|p| {
            std::path::Path::new(p)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| p.clone())
        })
        .collect();
    let list = names
        .iter()
        .map(|n| format!("- {n}"))
        .collect::<Vec<_>>()
        .join("\n");
    Some(format!(
        "## Evaluation sandbox\n\n\
         You are being evaluated. The following files are hidden test artifacts used \
         to score your work:\n\n\
         {list}\n\n\
         Rules:\n\
         - You MAY execute them (e.g. `python3 <file>`, `sh <file>`, `node <file>`) and \
         inspect stdout/stderr/exit code — that is the intended signal.\n\
         - You MUST NOT read, print, or otherwise inspect their contents. The `read` \
         tool will refuse, and any shell attempt (`cat`, `head`, `grep`, `less`, \
         `open(...).read()`, etc.) will be flagged as a cheat in the transcript.\n\
         - Diagnose from the source files you have access to plus the runtime output \
         of executing the hidden files. Do not try to reverse-engineer the test \
         assertions directly."
    ))
}

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

// Transcript building

#[allow(clippy::too_many_arguments)]
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
    //
    // Tool events get two timestamps:
    //   `T+XX.Xs` — wall seconds since scenario start (matches the live
    //               heartbeat's `T+` column)
    //   `Δ XX.Xs` — gap to the previous tool event, so you can scroll
    //               the transcript and see at a glance where the
    //               wall-clock budget went between actions.
    let _ = writeln!(s, "## Event Timeline\n");
    let mut last_tool_time: Option<f64> = None;
    for (i, ev) in outcome.events.iter().enumerate() {
        let t = outcome.event_times.get(i).copied().unwrap_or(0.0);
        match ev {
            TaskEvent::Text { content, partial } => {
                if !partial {
                    let _ = writeln!(s, "**{i}. Text (final):**\n```\n{}\n```\n", content);
                }
            }
            TaskEvent::Reasoning { .. } => {
                // Skipped — see consolidated "Reasoning" section above.
            }
            TaskEvent::ToolStart {
                tool_name,
                file_path,
                description,
                arguments,
            } => {
                let gap_marker = match last_tool_time {
                    None => " · Δ start".to_string(),
                    Some(prev) => format!(" · Δ{:.1}s", t - prev),
                };
                last_tool_time = Some(t);
                let _ = writeln!(
                    s,
                    "**{i}. [T+{:.1}s{}] Tool start: `{}`**  file={:?}  desc={:?}",
                    t, gap_marker, tool_name, file_path, description,
                );
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
            TaskEvent::ToolEnd {
                tool_name,
                success,
                output,
                file_path: _,
            } => {
                let marker = if *success { "OK" } else { "ERR" };
                let out = output.as_deref().unwrap_or("");
                let out = truncate_for_transcript(out, 4000);
                let _ = writeln!(
                    s,
                    "**{i}. [T+{:.1}s] Tool end: `{}` [{marker}]**\n```\n{}\n```\n",
                    t, tool_name, out,
                );
            }
            TaskEvent::Error { message } => {
                let _ = writeln!(s, "**{i}. [T+{:.1}s] Error:** {}\n", t, message);
            }
            TaskEvent::Interrupted { reason } => {
                let _ = writeln!(s, "**{i}. [T+{:.1}s] Interrupted:** {}\n", t, reason);
            }
            TaskEvent::Complete => {
                let _ = writeln!(s, "**{i}. [T+{:.1}s] Complete.**\n", t);
            }
            other => {
                let _ = writeln!(s, "**{i}. [T+{:.1}s] Other event:** {:?}\n", t, other);
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
        format!(
            "{prefix}\n... [truncated, {} chars total]",
            s.chars().count()
        )
    }
}

// Display helpers — ANSI colors + layout for terminal output.
// All eval output is meant for interactive consumption, so colors are
// emitted unconditionally.

const INDENT: &str = "            "; // 12 spaces — aligns under `[  1/125] `
const DETAIL_INDENT: &str = "              "; // 14 spaces — nested one step
const RULE_WIDTH: usize = 78;

fn rule_heavy() -> String {
    "═".repeat(RULE_WIDTH)
}
fn rule_light() -> String {
    "─".repeat(RULE_WIDTH)
}

fn diff_badge(d: Difficulty) -> &'static str {
    match d {
        Difficulty::Easy => "\x1b[1;32m[E]\x1b[0m",
        Difficulty::Medium => "\x1b[1;33m[M]\x1b[0m",
        Difficulty::Hard => "\x1b[1;31m[H]\x1b[0m",
    }
}

fn progress_bar(passed: usize, total: usize, width: usize) -> String {
    if total == 0 {
        return "\x1b[2m".to_string() + &"░".repeat(width) + "\x1b[0m";
    }
    let frac = passed as f64 / total as f64;
    let filled = (frac * width as f64).round() as usize;
    let filled = filled.min(width);
    let pct = frac * 100.0;
    let color = if pct >= 80.0 {
        "\x1b[32m"
    } else if pct >= 50.0 {
        "\x1b[33m"
    } else {
        "\x1b[31m"
    };
    format!(
        "{}{}\x1b[0m\x1b[2m{}\x1b[0m",
        color,
        "█".repeat(filled),
        "░".repeat(width - filled),
    )
}

/// Strip tempdir prefix for readable display.
fn rel_path_str(full: &str, base: &Path) -> String {
    std::path::Path::new(full)
        .strip_prefix(base)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| {
            std::path::Path::new(full)
                .file_name()
                .map(|f| f.to_string_lossy().into_owned())
                .unwrap_or_else(|| full.to_string())
        })
}

/// Render a byte count as a short human-readable string (B / KB / MB).
/// Used by the live status line to surface streamed-text volume during
/// runaway-tail generation phases.
fn fmt_bytes(n: usize) -> String {
    if n < 1024 {
        format!("{n} B")
    } else if n < 1024 * 1024 {
        format!("{:.1} KB", n as f64 / 1024.0)
    } else {
        format!("{:.1} MB", n as f64 / (1024.0 * 1024.0))
    }
}

fn truncate_display(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let prefix: String = s.chars().take(max.saturating_sub(1)).collect();
        format!("{prefix}…")
    }
}

/// Build the dim-grey timestamp prefix that precedes every tool-call
/// line in the live heartbeat. Two pieces of info on one row:
///
/// - `T+XX.Xs` — wall seconds since the scenario started. Lets you
///   correlate against the final `elapsed` total.
/// - `Δ XX.Xs` — gap since the previous tool call. The "delay
///   between tool calls" the eye scans for. First tool of a scenario
///   shows ` start ` instead of a delta.
///
/// Output width is fixed (~19 visible chars). Non-tool heartbeat lines
/// (streaming/thinking) keep the original 12-space `INDENT` and so
/// don't line up perfectly with tool lines — that's intentional, the
/// tool line is the permanent record and gets the wider prefix.
fn format_tool_timestamp_prefix(
    last_tool_start_at: &mut Option<std::time::Instant>,
    scenario_start: std::time::Instant,
) -> String {
    let now = std::time::Instant::now();
    let total = now.duration_since(scenario_start).as_secs_f64();
    let gap_part = match *last_tool_start_at {
        None => " start ".to_string(),
        Some(prev) => format!("Δ{:5.1}s", now.duration_since(prev).as_secs_f64()),
    };
    *last_tool_start_at = Some(now);
    format!("\x1b[90m[T+{:5.1}s {}]\x1b[0m ", total, gap_part)
}

/// Render a streaming tool-call line.
/// Layout:  `· <name pad>  <detail>` — name is cyan, detail is dim.
fn format_tool_line(tool_name: &str, arguments: Option<&str>, dir: &Path) -> String {
    let args_val: Option<serde_json::Value> = arguments.and_then(|a| serde_json::from_str(a).ok());

    let detail = match tool_name {
        "shell" => args_val
            .as_ref()
            .and_then(|v| v.get("command").and_then(|c| c.as_str()))
            .map(|c| {
                let one_line = c.replace('\n', " ");
                format!("\x1b[2m$ {}\x1b[0m", truncate_display(&one_line, 60))
            }),
        "fs_search" => args_val
            .as_ref()
            .and_then(|v| {
                v.get("pattern")
                    .and_then(|p| p.as_str())
                    .map(str::to_string)
            })
            .map(|p| format!("\x1b[2m/{}/\x1b[0m", truncate_display(&p, 60))),
        "fetch" => args_val
            .as_ref()
            .and_then(|v| v.get("url").and_then(|p| p.as_str()).map(str::to_string))
            .map(|u| format!("\x1b[2m{}\x1b[0m", truncate_display(&u, 60))),
        _ => {
            // Single-path tools surface the path. Batch reads (`read`
            // with `file_paths: [...]`) surface a count + the first
            // path so the heartbeat doesn't go blank.
            args_val.as_ref().and_then(|v| {
                if let Some(p) = v
                    .get("file_path")
                    .or_else(|| v.get("path"))
                    .and_then(|p| p.as_str())
                {
                    return Some(format!("\x1b[2m{}\x1b[0m", rel_path_str(p, dir)));
                }
                if let Some(arr) = v.get("file_paths").and_then(|p| p.as_array()) {
                    let first = arr.first().and_then(|p| p.as_str()).unwrap_or("?");
                    let extra = arr.len().saturating_sub(1);
                    let suffix = if extra > 0 {
                        format!(" \x1b[90m+{} more\x1b[0m", extra)
                    } else {
                        String::new()
                    };
                    return Some(format!(
                        "\x1b[2m{}\x1b[0m{}",
                        rel_path_str(first, dir),
                        suffix,
                    ));
                }
                None
            })
        }
    };

    // Tool names fit in 9 cols (longest is `fs_search`).
    let padded_name = format!("{:<9}", tool_name);
    match detail {
        Some(d) => format!("\x1b[90m·\x1b[0m \x1b[36m{}\x1b[0m  {}", padded_name, d),
        None => format!("\x1b[90m·\x1b[0m \x1b[36m{}\x1b[0m", padded_name),
    }
}

/// Render the per-scenario result line (PASS/FAIL + stats).
fn format_result_line(
    passed: bool,
    first_try: Option<bool>,
    elapsed: Duration,
    tool_count: usize,
) -> String {
    let status = if passed {
        "\x1b[1;32m✓ PASS\x1b[0m"
    } else {
        "\x1b[1;31m✗ FAIL\x1b[0m"
    };
    let first_try_tag = if passed && first_try == Some(true) {
        " \x1b[90m·\x1b[0m \x1b[1;36m1st try\x1b[0m"
    } else {
        ""
    };
    format!(
        "{}{} \x1b[90m·\x1b[0m \x1b[33m{:>5.1}s\x1b[0m \x1b[90m·\x1b[0m \x1b[2m{} tool{}\x1b[0m",
        status,
        first_try_tag,
        elapsed.as_secs_f64(),
        tool_count,
        if tool_count == 1 { "" } else { "s" },
    )
}

/// Emit a section banner: heavy rule · title · heavy rule.
fn print_banner(title: &str) {
    println!();
    println!("\x1b[34m{}\x1b[0m", rule_heavy());
    println!("  \x1b[1m{}\x1b[0m", title);
    println!("\x1b[34m{}\x1b[0m", rule_heavy());
}

/// Emit a section banner on stderr (for eval_suite before scenarios stream).
fn eprint_banner(title: &str) {
    eprintln!();
    eprintln!("\x1b[34m{}\x1b[0m", rule_heavy());
    eprintln!("  \x1b[1m{}\x1b[0m", title);
    eprintln!("\x1b[34m{}\x1b[0m", rule_heavy());
}

// Scenario runner

async fn run_scenario(cfg: &EvalConfig, spec: &ScenarioSpec) -> EvalResult {
    use std::io::Write;

    // Tool-availability preflight: if the scenario needs `cargo`/`go`/`node`/...
    // and the host doesn't have it, skip rather than fail. This runs BEFORE
    // `setup` so scenarios whose setup itself shells out to the tool (e.g.
    // `git init` for the regression-hunt scenario) don't panic on hosts that
    // simply lack the binary. Lets multi-language scenarios ship without
    // forcing every toolchain onto every eval host.
    if let Some(missing) = first_missing_tool(spec.required_tools) {
        eprintln!("{} \x1b[1m{}\x1b[0m", diff_badge(spec.difficulty), spec.id);
        eprintln!(
            "{}\x1b[2;33m⊘ SKIP\x1b[0m \x1b[90m·\x1b[0m missing tool: \x1b[33m{}\x1b[0m",
            INDENT, missing,
        );
        eprintln!();
        return EvalResult {
            id: spec.id.into(),
            category: spec.category,
            difficulty: spec.difficulty,
            passed: false,
            skipped: true,
            first_try: None,
            turns: 0,
            tool_calls: vec![],
            elapsed: Duration::from_secs(0),
            failed_checks: vec![format!("skipped: missing tool `{}`", missing)],
            output_preview: String::new(),
            interrupted: None,
        };
    }

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

    // Prepend an evaluation-specific warning listing blocked files so the model
    // knows up-front which files are hidden — avoids confused `cat <test>`
    // attempts being counted against it. Only injected when the scenario
    // actually has blocked files.
    let styled_body = user_prompt_with_style(cfg.system_style, &setup.prompt);
    let final_prompt = match blocked_files_notice(&setup.blocked_files) {
        Some(notice) => format!("{notice}\n\n{styled_body}"),
        None => styled_body,
    };

    let (tx, rx) = mpsc::unbounded_channel::<TaskEvent>();

    let request = TaskRequest {
        id: format!("eval-{}", spec.id),
        prompt: final_prompt,
        scope,
        role: spec.role,
        conversation_id: None,
    };

    let start = Instant::now();
    // Copy of the scenario start time captured by the events task. Used
    // to compute the `T+` (since-start) and `Δ` (since-previous-tool)
    // timestamps that prefix each tool-call line so the user can see at
    // a glance where the wall-clock budget went.
    let start_for_events = start;

    // Scenario header continues from the `[  N/M] ` progress prefix printed by the caller.
    eprintln!("{} \x1b[1m{}\x1b[0m", diff_badge(spec.difficulty), spec.id);
    let _ = std::io::stderr().flush();

    let dir_for_events = dir_path.clone();
    let events_handle = tokio::spawn(async move {
        let dir_for_events = dir_for_events;
        let mut rx = rx;
        let mut events = Vec::new();
        let mut event_times: Vec<f64> = Vec::new();
        let mut tool_calls = Vec::new();
        let mut full_text = String::new();
        let mut reasoning_text = String::new();
        let mut interrupted: Option<String> = None;
        let mut completed = false;
        // Heartbeat: print a live status line on the same terminal row between
        // tool calls so the user can tell the model is working vs. hung.
        // Distinguishes three states:
        //   · `thinking…`  — true silence (no tokens flowing, just waiting on a tool call)
        //   · `streaming…` — model is emitting text/reasoning but hasn't called a tool
        //     for a while (catches "runaway tail" generation that would otherwise
        //     look identical to silence)
        //   · `tool error` / `cheat attempt` / etc. — surfaced inline on tool end
        //
        // The heartbeat is reset only by *action* events (tool start/end, complete,
        // interrupted). Streaming text/reasoning bumps byte counters but does NOT
        // reset the timer — so a model spewing 500 KB of post-tool reasoning still
        // shows up as `streaming… [120s · 500 KB]` instead of looking idle.
        let mut heartbeat = tokio::time::interval(std::time::Duration::from_millis(500));
        heartbeat.tick().await; // consume the immediate first tick
        let silence_start = std::time::Instant::now();
        let mut silence_started: Option<std::time::Instant> = None;
        let mut thinking_line_open = false;
        const SPINNER: [char; 10] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let mut spin_idx: usize = 0;
        // Bytes of text/reasoning streamed since the last action event.
        let mut text_bytes_since_action: usize = 0;
        let mut reasoning_bytes_since_action: usize = 0;
        // Timestamp tracker for the per-tool `[T+...s Δ...s]` prefix.
        // `None` until the first tool fires; updated on every ToolStart
        // so the next tool's Δ shows the gap from THIS one.
        let mut last_tool_start_at: Option<std::time::Instant> = None;

        // Helper: close out the in-place thinking line (if any) before printing
        // real output. Short silences erase the line (keeps output clean);
        // silences ≥ 5 s are preserved as a permanent record by printing a
        // newline instead, so the user can see that the model actually thought
        // for a meaningful while.
        fn close_thinking(open: &mut bool, silence_started: &Option<std::time::Instant>) {
            if *open {
                let kept = silence_started
                    .map(|s| s.elapsed().as_secs_f64() >= 5.0)
                    .unwrap_or(false);
                if kept {
                    eprintln!(); // keep the thinking line, advance to next row
                } else {
                    eprint!("\r\x1b[K"); // carriage return + clear to end of line
                }
                let _ = std::io::stderr().flush();
                *open = false;
            }
        }

        // True when the next action event should reset the silence/byte
        // counters. Streaming events (Text/Reasoning) accumulate but do NOT
        // reset, so a runaway generation tail stays visible as `streaming…`.
        let reset_action_state =
            |silence_started: &mut Option<std::time::Instant>,
             text_bytes: &mut usize,
             reasoning_bytes: &mut usize,
             heartbeat: &mut tokio::time::Interval| {
                heartbeat.reset();
                *silence_started = None;
                *text_bytes = 0;
                *reasoning_bytes = 0;
            };

        loop {
            tokio::select! {
                ev = rx.recv() => {
                    let Some(ev) = ev else { break };
                    let mut is_action = false;
                    match &ev {
                        TaskEvent::Text { content, partial } => {
                            if *partial { full_text.push_str(content); } else { full_text = content.clone(); }
                            text_bytes_since_action += content.len();
                        }
                        TaskEvent::Reasoning { content } => {
                            reasoning_text.push_str(content);
                            reasoning_bytes_since_action += content.len();
                        }
                        TaskEvent::ToolStart { tool_name, arguments, .. } => {
                            is_action = true;
                            tool_calls.push(tool_name.clone());
                            close_thinking(&mut thinking_line_open, &silence_started);
                            let line = format_tool_line(tool_name, arguments.as_deref(), &dir_for_events);
                            let prefix = format_tool_timestamp_prefix(
                                &mut last_tool_start_at,
                                start_for_events,
                            );
                            eprintln!("{}{}", prefix, line);
                            let _ = std::io::stderr().flush();
                        }
                        TaskEvent::ToolEnd { success, output, tool_name, .. } => {
                            is_action = true;
                            // Sandbox signals surfaced visually:
                            //   · `fs_read` returns Ok(...) with an "Access denied" refusal
                            //     when the file is on the eval sandbox block-list.
                            //   · `shell` prepends "[EVAL CHEAT DETECTED]" when the command
                            //     looked like it was dumping a blocked file.
                            // Both render in yellow so the evaluator can see them at a glance
                            // without opening the transcript.
                            let out = output.as_deref().unwrap_or("");
                            let blocked_read = *success
                                && tool_name == "read"
                                && out.starts_with("Access denied:");
                            let shell_cheat = *success
                                && tool_name == "shell"
                                && out.starts_with("[EVAL CHEAT DETECTED]");
                            if blocked_read {
                                close_thinking(&mut thinking_line_open, &silence_started);
                                eprintln!("{}\x1b[33m  └─ blocked (hidden from eval)\x1b[0m", INDENT);
                                let _ = std::io::stderr().flush();
                            } else if shell_cheat {
                                close_thinking(&mut thinking_line_open, &silence_started);
                                eprintln!("{}\x1b[33m  └─ cheat attempt (tried to read blocked file)\x1b[0m", INDENT);
                                let _ = std::io::stderr().flush();
                            } else if !*success {
                                close_thinking(&mut thinking_line_open, &silence_started);
                                eprintln!("{}\x1b[31m  └─ tool error\x1b[0m", INDENT);
                                let _ = std::io::stderr().flush();
                            }
                        }
                        TaskEvent::Complete => { completed = true; is_action = true; }
                        TaskEvent::Interrupted { reason } => { interrupted = Some(reason.clone()); is_action = true; }
                        _ => {}
                    }
                    if is_action {
                        reset_action_state(
                            &mut silence_started,
                            &mut text_bytes_since_action,
                            &mut reasoning_bytes_since_action,
                            &mut heartbeat,
                        );
                    }
                    event_times.push(start_for_events.elapsed().as_secs_f64());
                    events.push(ev);
                }
                _ = heartbeat.tick() => {
                    // Start tracking silence window lazily so the first few frames don't flash.
                    let start = *silence_started.get_or_insert_with(std::time::Instant::now);
                    let elapsed = start.elapsed().as_secs_f64();
                    // Wait ~1s before showing the live line, to avoid churn during normal gaps.
                    if elapsed >= 1.0 {
                        let total = silence_start.elapsed().as_secs();
                        let _ = total; // reserved for future use
                        let glyph = SPINNER[spin_idx % SPINNER.len()];
                        spin_idx = spin_idx.wrapping_add(1);
                        let streamed = text_bytes_since_action + reasoning_bytes_since_action;
                        let label = if streamed >= 256 {
                            // Tokens flowing between tool calls — surface the
                            // tail so the user can tell the model is
                            // generating but not acting (runaway-reasoning
                            // failure mode). "streaming" alone already
                            // implies no tool call is in flight.
                            format!(
                                "streaming… [{:>4.1}s · {}]",
                                elapsed,
                                fmt_bytes(streamed),
                            )
                        } else {
                            format!("thinking… [{:>4.1}s]", elapsed)
                        };
                        // Overwrite the same line in place (carriage return + clear to EOL).
                        eprint!("\r\x1b[K{}\x1b[2m{} {}\x1b[0m", INDENT, glyph, label);
                        let _ = std::io::stderr().flush();
                        thinking_line_open = true;
                    }
                }
            }
        }
        close_thinking(&mut thinking_line_open, &silence_started);
        // Surface a final summary if the run ended (timeout / completion) while
        // the model was still streaming text or reasoning without ever calling
        // another tool. This is what makes "runaway tail" failures visible in
        // the static, post-run log even after the spinner is gone.
        let stream_tail = text_bytes_since_action + reasoning_bytes_since_action;
        if stream_tail >= 256 {
            let elapsed_since_action = silence_started
                .map(|s| s.elapsed().as_secs_f64())
                .unwrap_or(0.0);
            eprintln!(
                "{}\x1b[33m  └─ tail: {} of text/reasoning over {:.1}s with no tool call\x1b[0m",
                INDENT,
                fmt_bytes(stream_tail),
                elapsed_since_action,
            );
            let _ = std::io::stderr().flush();
        }
        RunOutcome {
            events,
            event_times,
            tool_calls,
            full_text,
            reasoning_text,
            interrupted,
            completed,
        }
    });

    let orch_result = tokio::time::timeout(cfg.timeout, async {
        let mut orch = Orchestrator::new(&cfg.provider(), &request, tx, None, None);
        orch.set_max_turns(cfg.max_turns);
        orch.run().await
    })
    .await;

    let elapsed = start.elapsed();
    let outcome = events_handle.await.unwrap_or_else(|_| RunOutcome {
        events: vec![],
        event_times: vec![],
        tool_calls: vec![],
        full_text: String::new(),
        reasoning_text: String::new(),
        interrupted: Some("join failed".into()),
        completed: false,
    });

    let approx_turns = (outcome.tool_calls.len() + 1).min(cfg.max_turns);

    let (passed, failed_checks, interrupted) = match orch_result {
        Ok(Ok(())) => {
            // If the orchestrator ended with an interrupt (max_turns
            // reached, doom loop, too many tool errors, …) but the model's
            // work on disk still satisfies the file/shell rubric, treat
            // the scenario as passed. `Check::Completed` is a process
            // signal ("the model emitted a clean done event"), not a
            // correctness signal, so it's skipped in the interrupted case.
            // Otherwise we'd mark scenarios that already wrote the right
            // code as FAIL purely because the model didn't say "done" in
            // time — which happened on refactor_05 in our eval run.
            let effective_checks: Vec<Check> = if outcome.interrupted.is_some() {
                setup
                    .checks
                    .iter()
                    .filter(|c| !matches!(c, Check::Completed))
                    .cloned()
                    .collect()
            } else {
                setup.checks.clone()
            };
            let (ok, failures) = evaluate_checks(&effective_checks, &outcome, &dir_path);
            (ok, failures, outcome.interrupted.clone())
        }
        Ok(Err(e)) => (
            false,
            vec![format!("orch error: {e}")],
            outcome.interrupted.clone(),
        ),
        Err(_) => {
            // Wall-clock timeout — same treatment as an interrupt.
            let timeout_checks: Vec<Check> = setup
                .checks
                .iter()
                .filter(|c| !matches!(c, Check::Completed))
                .cloned()
                .collect();
            let (ok, mut failures) = evaluate_checks(&timeout_checks, &outcome, &dir_path);
            failures.insert(0, format!("timeout {}s", cfg.timeout.as_secs()));
            (ok && failures.len() <= 1, failures, Some("timeout".into()))
        }
    };

    let first_try = if passed {
        determine_first_try(&outcome.events)
    } else {
        None
    };
    eprintln!(
        "{}{}",
        INDENT,
        format_result_line(passed, first_try, elapsed, outcome.tool_calls.len()),
    );
    if !passed {
        for reason in &failed_checks {
            let s = truncate_display(reason, 100);
            eprintln!("{}\x1b[31m└─ {}\x1b[0m", DETAIL_INDENT, s);
        }
    }
    if let Some(reason) = &interrupted {
        let s = truncate_display(reason, 60);
        eprintln!("{}\x1b[33m└─ interrupted:\x1b[0m {}", DETAIL_INDENT, s);
    }
    eprintln!();

    let output_preview: String = outcome.full_text.chars().take(300).collect();

    // Write full transcript if requested
    if let Some(ref tdir) = cfg.transcript_dir {
        let transcript_path = tdir.join(format!("{}.md", spec.id));
        let transcript = build_transcript(
            spec,
            &setup.prompt,
            &setup.scope_files,
            &outcome,
            passed,
            first_try,
            &failed_checks,
            elapsed,
            &interrupted,
            &dir_path,
        );
        let _ = std::fs::write(&transcript_path, transcript);
    }

    // Optionally preserve the temp directory for manual inspection
    if cfg.keep_dirs {
        let kept = dir.keep(); // prevents cleanup
        eprintln!("{}\x1b[2mdir:\x1b[0m {}", DETAIL_INDENT, kept.display());
    }

    EvalResult {
        id: spec.id.into(),
        category: spec.category,
        difficulty: spec.difficulty,
        passed,
        skipped: false,
        first_try,
        turns: approx_turns,
        tool_calls: outcome.tool_calls,
        elapsed,
        failed_checks,
        output_preview,
        interrupted,
    }
}

/// Return the first required tool absent from PATH, or None if all are present.
fn first_missing_tool(tools: &[&'static str]) -> Option<&'static str> {
    for tool in tools {
        let status = std::process::Command::new("sh")
            .arg("-c")
            .arg(format!("command -v {} >/dev/null 2>&1", tool))
            .status();
        if !matches!(status, Ok(s) if s.success()) {
            return Some(*tool);
        }
    }
    None
}

// Report printing

fn print_report(cfg: &EvalConfig, results: &[EvalResult]) {
    // Skipped scenarios (missing toolchain) don't count toward totals — treat
    // as "not run" rather than "failed". They're surfaced separately in the
    // summary line so users know why the scored total is lower than the spec
    // count.
    let skipped: usize = results.iter().filter(|r| r.skipped).count();
    let scored: Vec<&EvalResult> = results.iter().filter(|r| !r.skipped).collect();
    let total = scored.len();
    let passed: usize = scored.iter().filter(|r| r.passed).count();
    let total_time: Duration = scored.iter().map(|r| r.elapsed).sum();
    let total_tools: usize = scored.iter().map(|r| r.tool_calls.len()).sum();
    let first_try_count = scored
        .iter()
        .filter(|r| r.passed && r.first_try == Some(true))
        .count();

    print_banner(&format!(
        "RESULTS \x1b[90m·\x1b[0m \x1b[36m{}\x1b[0m \x1b[90m·\x1b[0m style=\x1b[35m{}\x1b[0m",
        cfg.model,
        cfg.system_style.label(),
    ));

    // By category
    println!();
    println!("  \x1b[1mBy category\x1b[0m");
    let cats = [
        Category::Bugfix,
        Category::Refactor,
        Category::Implement,
        Category::Patch,
        Category::Understanding,
        Category::Search,
        Category::CrossFile,
        Category::Testing,
        Category::Security,
        Category::Concurrency,
        Category::Performance,
        Category::Context,
    ];
    for cat in cats {
        let cat_results: Vec<&&EvalResult> = scored.iter().filter(|r| r.category == cat).collect();
        if cat_results.is_empty() {
            continue;
        }
        let p = cat_results.iter().filter(|r| r.passed).count();
        let ft = cat_results
            .iter()
            .filter(|r| r.passed && r.first_try == Some(true))
            .count();
        let t = cat_results.len();
        let pct = (p as f64 / t as f64) * 100.0;
        let ft_str = if ft > 0 {
            format!("   \x1b[36m{} first-try\x1b[0m", ft)
        } else {
            String::new()
        };
        println!(
            "    {:<15}  {}  {:>3}/{:<3}  {:>5.1}%{}",
            cat.label(),
            progress_bar(p, t, 20),
            p,
            t,
            pct,
            ft_str,
        );
    }

    // By difficulty
    println!();
    println!("  \x1b[1mBy difficulty\x1b[0m");
    for diff in [Difficulty::Easy, Difficulty::Medium, Difficulty::Hard] {
        let d_results: Vec<&&EvalResult> = scored.iter().filter(|r| r.difficulty == diff).collect();
        if d_results.is_empty() {
            continue;
        }
        let p = d_results.iter().filter(|r| r.passed).count();
        let ft = d_results
            .iter()
            .filter(|r| r.passed && r.first_try == Some(true))
            .count();
        let t = d_results.len();
        let pct = (p as f64 / t as f64) * 100.0;
        let ft_str = if ft > 0 {
            format!("   \x1b[36m{} first-try\x1b[0m", ft)
        } else {
            String::new()
        };
        let label = format!("{:?}", diff);
        let label_plain = format!("{:<10}", label); // pad to match category column visually
        let label_colored = match diff {
            Difficulty::Easy => format!("\x1b[32m{}\x1b[0m", label_plain),
            Difficulty::Medium => format!("\x1b[33m{}\x1b[0m", label_plain),
            Difficulty::Hard => format!("\x1b[31m{}\x1b[0m", label_plain),
        };
        println!(
            "    {} {}  {}  {:>3}/{:<3}  {:>5.1}%{}",
            diff_badge(diff),
            label_colored,
            progress_bar(p, t, 20),
            p,
            t,
            pct,
            ft_str,
        );
    }

    // Failures
    let fails: Vec<&&EvalResult> = scored.iter().filter(|r| !r.passed).collect();
    if !fails.is_empty() {
        println!();
        println!(
            "  \x1b[1;31mFailures\x1b[0m \x1b[2m({})\x1b[0m",
            fails.len()
        );
        for r in &fails {
            let first = r.failed_checks.first().map(|s| s.as_str()).unwrap_or("?");
            let tools = r.tool_calls.len();
            println!(
                "    {} \x1b[1m{:<40}\x1b[0m  \x1b[33m{:>5.1}s\x1b[0m  \x1b[2m{:>2} tool{}\x1b[0m  \x1b[31m{}\x1b[0m",
                diff_badge(r.difficulty),
                r.id,
                r.elapsed.as_secs_f64(),
                tools,
                if tools == 1 { " " } else { "s" },
                truncate_display(first, 70),
            );
        }
    }

    // Skipped (missing toolchain)
    let skips: Vec<&EvalResult> = results.iter().filter(|r| r.skipped).collect();
    if !skips.is_empty() {
        println!();
        println!("  \x1b[1;33mSkipped\x1b[0m \x1b[2m({})\x1b[0m", skips.len());
        for r in &skips {
            let reason = r
                .failed_checks
                .first()
                .map(|s| s.as_str())
                .unwrap_or("missing tool");
            println!(
                "    {} \x1b[1m{:<40}\x1b[0m  \x1b[2m{}\x1b[0m",
                diff_badge(r.difficulty),
                r.id,
                reason,
            );
        }
    }

    // Summary
    let pct_total = if total > 0 {
        (passed as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    let pct_ft = if total > 0 {
        (first_try_count as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    let avg = if total > 0 {
        total_time.as_secs_f64() / total as f64
    } else {
        0.0
    };

    println!();
    println!("\x1b[34m{}\x1b[0m", rule_light());
    let skip_tag = if skipped > 0 {
        format!(
            "   \x1b[90m·\x1b[0m   \x1b[1;33mskipped\x1b[0m  {}",
            skipped
        )
    } else {
        String::new()
    };
    println!(
        "  \x1b[1mScore\x1b[0m   \x1b[1;32m{}\x1b[0m/{}  (\x1b[1m{:.1}%\x1b[0m)   \x1b[90m·\x1b[0m   \x1b[1;36m1st try\x1b[0m  {} ({:.1}%){}",
        passed, total, pct_total, first_try_count, pct_ft, skip_tag,
    );
    println!(
        "  \x1b[1mTime\x1b[0m    {:.1}s   \x1b[90m·\x1b[0m   \x1b[2mavg\x1b[0m {:.1}s/scenario   \x1b[90m·\x1b[0m   \x1b[2m{} tool calls\x1b[0m",
        total_time.as_secs_f64(), avg, total_tools,
    );
    println!("\x1b[34m{}\x1b[0m", rule_heavy());
}

// Scenario definitions — 30 extra-hard scenarios under eval_scenarios/

#[path = "eval_scenarios/mod.rs"]
mod eval_scenarios;

use eval_scenarios::make_scenarios;

// Main test entry points

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

    eprint_banner(&format!(
        "COTECT EVAL SUITE \x1b[90m·\x1b[0m \x1b[1m{}\x1b[0m scenarios",
        total,
    ));
    eprintln!("  \x1b[36mmodel\x1b[0m      {}", cfg.model);
    eprintln!("  \x1b[36mendpoint\x1b[0m   {}", cfg.endpoint);
    eprintln!("  \x1b[36mstyle\x1b[0m      {}", cfg.system_style.label());
    eprintln!(
        "  \x1b[36mtimeout\x1b[0m    {}s/scenario",
        cfg.timeout.as_secs()
    );
    eprintln!("  \x1b[36mmax turns\x1b[0m  {}", cfg.max_turns);
    if cfg.disable_thinking == Some(true) {
        eprintln!("  \x1b[36mthinking\x1b[0m   disabled (/no_think for Qwen)");
    }
    if let Some(c) = cfg.category {
        eprintln!("  \x1b[36mcategory\x1b[0m   {}", c.label());
    }
    if let Some(d) = cfg.difficulty {
        eprintln!("  \x1b[36mdifficulty\x1b[0m {}", d.label());
    }
    if let Some(f) = &cfg.filter {
        eprintln!("  \x1b[36mfilter\x1b[0m     {}", f);
    }
    eprintln!("\x1b[34m{}\x1b[0m", rule_light());
    eprintln!();

    let mut results: Vec<EvalResult> = Vec::with_capacity(total);
    let idx_width = total.to_string().len();
    for (i, spec) in scenarios.iter().enumerate() {
        eprint!(
            "\x1b[90m[\x1b[0m{:>w$}\x1b[90m/{}]\x1b[0m ",
            i + 1,
            total,
            w = idx_width,
        );
        let r = run_scenario(&cfg, spec).await;
        results.push(r);
    }

    print_report(&cfg, &results);

    // Don't assert; let the user see the report.
}

// Also expose legacy single-category shortcuts so we can easily rerun a
// subset from cargo test by name.

async fn run_category(cat: Category) {
    let Some(mut cfg) = EvalConfig::from_env() else {
        panic!("Set COTECT_EVAL_ENDPOINT and COTECT_EVAL_MODEL");
    };
    cfg.category = Some(cat);
    let scenarios = collect_scenarios(&cfg);
    let total = scenarios.len();

    eprint_banner(&format!(
        "Category \x1b[35m{}\x1b[0m \x1b[90m·\x1b[0m \x1b[1m{}\x1b[0m scenarios",
        cat.label(),
        total,
    ));
    eprintln!();
    let mut results = Vec::with_capacity(total);
    let idx_width = total.to_string().len();
    for (i, spec) in scenarios.iter().enumerate() {
        eprint!(
            "\x1b[90m[\x1b[0m{:>w$}\x1b[90m/{}]\x1b[0m ",
            i + 1,
            total,
            w = idx_width,
        );
        let r = run_scenario(&cfg, spec).await;
        results.push(r);
    }
    print_report(&cfg, &results);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_bugfix() {
    run_category(Category::Bugfix).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_refactor() {
    run_category(Category::Refactor).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_implement() {
    run_category(Category::Implement).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_patch() {
    run_category(Category::Patch).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_understanding() {
    run_category(Category::Understanding).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_search() {
    run_category(Category::Search).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_cross_file() {
    run_category(Category::CrossFile).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_testing() {
    run_category(Category::Testing).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_security() {
    run_category(Category::Security).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_concurrency() {
    run_category(Category::Concurrency).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_performance() {
    run_category(Category::Performance).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_category_context() {
    run_category(Category::Context).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn eval_extra_hard() {
    let Some(mut cfg) = EvalConfig::from_env() else {
        panic!("Set COTECT_EVAL_ENDPOINT and COTECT_EVAL_MODEL");
    };
    cfg.filter = Some("xhard".into());
    let scenarios = collect_scenarios(&cfg);
    let total = scenarios.len();

    eprint_banner(&format!(
        "Extra-hard suite \x1b[90m·\x1b[0m \x1b[1m{}\x1b[0m scenarios",
        total,
    ));
    eprintln!();
    let mut results = Vec::with_capacity(total);
    let idx_width = total.to_string().len();
    for (i, spec) in scenarios.iter().enumerate() {
        eprint!(
            "\x1b[90m[\x1b[0m{:>w$}\x1b[90m/{}]\x1b[0m ",
            i + 1,
            total,
            w = idx_width,
        );
        let r = run_scenario(&cfg, spec).await;
        results.push(r);
    }
    print_report(&cfg, &results);
}
