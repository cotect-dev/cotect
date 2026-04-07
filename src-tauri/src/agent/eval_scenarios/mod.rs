//! Scenario registry for the eval harness — 125 scenarios across 10 categories.
//!
//! Each category lives in its own submodule for maintainability.
//! The `extra_hard` module adds 25 devious scenarios designed to challenge
//! even frontier models with multi-step reasoning, red herrings, and gotchas.
//! See `eval.rs` for the runner, check types, and report logic.

mod bugfix;
mod refactor;
mod implement;
mod patch;
mod understanding;
mod search;
mod cross_file;
mod error_handling;
mod recovery;
mod planning;
mod extra_hard;
mod v2_bugfix;

use std::path::Path;

#[allow(unused_imports)]
use crate::agent::types::AgentRole;
use super::{Category, Check, Difficulty, ScenarioSpec, SetupResult};

// ────────────────────────────────────────────────────────────────────────
// Shared shorthand builders used by every category module
// ────────────────────────────────────────────────────────────────────────

/// Build a bare `SetupResult` with only a prompt.
pub(crate) fn pf(prompt: impl Into<String>) -> SetupResult {
    SetupResult { prompt: prompt.into(), scope_files: vec![], checks: vec![] }
}

pub(crate) fn with_checks(mut s: SetupResult, checks: Vec<Check>) -> SetupResult {
    s.checks = checks;
    s
}

pub(crate) fn with_scope(mut s: SetupResult, files: Vec<String>) -> SetupResult {
    s.scope_files = files;
    s
}

// ── Common check helpers ────────────────────────────────────────────────

#[allow(dead_code)]
pub(crate) fn oc(needle: &str) -> Check {
    Check::OutputContains(needle.into())
}

pub(crate) fn oc_all(needles: &[&str]) -> Check {
    Check::OutputContainsAll(needles.iter().map(|s| s.to_string()).collect())
}

pub(crate) fn oc_any(needles: &[&str]) -> Check {
    Check::OutputContainsAny(needles.iter().map(|s| s.to_string()).collect())
}

#[allow(dead_code)]
pub(crate) fn oc_not(needles: &[&str]) -> Check {
    Check::OutputDoesNotContain(needles.iter().map(|s| s.to_string()).collect())
}

#[allow(dead_code)]
pub(crate) fn num(n: i64) -> Check {
    Check::LastNumberEquals(n)
}

#[allow(dead_code)]
pub(crate) fn used(tool: &str) -> Check {
    Check::UsedTool(tool.into())
}

pub(crate) fn succeeded(tool: &str) -> Check {
    Check::ToolSucceeded(tool.into())
}

pub(crate) fn used_any(tools: &[&str]) -> Check {
    Check::UsedAnyTool(tools.iter().map(|s| s.to_string()).collect())
}

pub(crate) fn complete() -> Check {
    Check::Completed
}

#[allow(dead_code)]
pub(crate) fn file_exists(path: &str) -> Check {
    Check::FileExists(path.into())
}

pub(crate) fn file_has(path: &str, needles: &[&str]) -> Check {
    Check::FileContains(path.into(), needles.iter().map(|s| s.to_string()).collect())
}

pub(crate) fn file_lacks(path: &str, needles: &[&str]) -> Check {
    Check::FileDoesNotContain(path.into(), needles.iter().map(|s| s.to_string()).collect())
}

#[allow(dead_code)]
pub(crate) fn file_lines(path: &str, min: usize, max: usize) -> Check {
    Check::FileLineCount(path.into(), min, max)
}

/// Run a command in the temp dir; pass if exit code == 0.
#[allow(dead_code)]
pub(crate) fn run_ok(cmd: &str) -> Check {
    Check::RunExitOk(cmd.into(), 30)
}

/// Run a command in the temp dir with custom timeout; pass if exit code == 0.
#[allow(dead_code)]
pub(crate) fn run_ok_t(cmd: &str, timeout: u64) -> Check {
    Check::RunExitOk(cmd.into(), timeout)
}

/// Run a command in the temp dir; pass if exit == 0 AND output contains all needles.
#[allow(dead_code)]
pub(crate) fn run_has(cmd: &str, needles: &[&str]) -> Check {
    Check::RunOutputContains(cmd.into(), 30, needles.iter().map(|s| s.to_string()).collect())
}

/// Run a command in the temp dir; pass if exit == 0 AND output does NOT contain any needle.
#[allow(dead_code)]
pub(crate) fn run_lacks(cmd: &str, needles: &[&str]) -> Check {
    Check::RunOutputLacks(cmd.into(), 30, needles.iter().map(|s| s.to_string()).collect())
}

/// Absolute path under the temp dir.
pub(crate) fn ap(dir: &Path, rel: &str) -> String {
    dir.join(rel).to_string_lossy().into_owned()
}

/// Scenario construction shortcut.
macro_rules! scen {
    ($id:expr, $cat:expr, $diff:expr, $role:expr, $setup:ident) => {
        ScenarioSpec {
            id: $id,
            category: $cat,
            difficulty: $diff,
            role: $role,
            setup: $setup,
        }
    };
}

pub(crate) use scen;

// ────────────────────────────────────────────────────────────────────────
// Aggregate all scenarios
// ────────────────────────────────────────────────────────────────────────

pub(super) fn make_scenarios() -> Vec<ScenarioSpec> {
    let mut v = Vec::with_capacity(125);
    bugfix::scenarios(&mut v);
    refactor::scenarios(&mut v);
    implement::scenarios(&mut v);
    patch::scenarios(&mut v);
    understanding::scenarios(&mut v);
    search::scenarios(&mut v);
    cross_file::scenarios(&mut v);
    error_handling::scenarios(&mut v);
    recovery::scenarios(&mut v);
    planning::scenarios(&mut v);
    extra_hard::scenarios(&mut v);
    v2_bugfix::scenarios(&mut v);
    v
}
