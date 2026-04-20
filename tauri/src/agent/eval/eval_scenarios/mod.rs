//! Scenario registry for the eval harness — 25 expert-level scenarios.
//!
//! The suite is organized across 12 categories: classical software-engineering
//! skills (bugfix/refactor/implement/patch/cross-file/testing) plus the
//! axes that previous rounds were silent on — security, concurrency,
//! performance, long-context reasoning, git-driven regression hunting, and
//! pure comprehension. See `eval.rs` for the runner, check types, report
//! logic, and harness primitives (skip-on-missing-tool, diff budgets).

mod extra_hard_bugfix;
mod extra_hard_refactor;
mod extra_hard_patch;
mod extra_hard_implement;
mod extra_hard_testing;
mod extra_hard_cross_file;
mod extra_hard_security;
mod extra_hard_concurrency;
mod extra_hard_performance;
mod extra_hard_context;
mod extra_hard_search;
mod extra_hard_understanding;

use std::path::Path;

#[allow(unused_imports)]
use crate::agent::types::AgentRole;
use super::{Category, Check, Difficulty, ScenarioSpec, SetupResult};

// Shared shorthand builders used by every category module

/// Build a bare `SetupResult` with only a prompt.
pub(crate) fn pf(prompt: impl Into<String>) -> SetupResult {
    SetupResult {
        prompt: prompt.into(),
        scope_files: vec![],
        checks: vec![],
        blocked_files: vec![],
    }
}

pub(crate) fn with_checks(mut s: SetupResult, checks: Vec<Check>) -> SetupResult {
    s.checks = checks;
    s
}

pub(crate) fn with_scope(mut s: SetupResult, files: Vec<String>) -> SetupResult {
    s.scope_files = files;
    s
}

pub(crate) fn with_blocked(mut s: SetupResult, files: Vec<String>) -> SetupResult {
    s.blocked_files = files;
    s
}


#[allow(dead_code)]
pub(crate) fn oc(needle: &str) -> Check {
    Check::OutputContains(needle.into())
}

#[allow(dead_code)]
pub(crate) fn oc_all(needles: &[&str]) -> Check {
    Check::OutputContainsAll(needles.iter().map(|s| s.to_string()).collect())
}

#[allow(dead_code)]
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

#[allow(dead_code)]
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

/// Assert that the edited file differs from a reference snapshot by at most
/// `max_changed` lines (unified-diff added+removed). `reference_abs` is an
/// absolute path (typically written into the tempdir during setup);
/// `target_rel` is the relative path of the edited file.
#[allow(dead_code)]
pub(crate) fn diff_at_most(reference_abs: &str, target_rel: &str, max_changed: usize) -> Check {
    Check::FileDiffLinesAtMost(reference_abs.into(), target_rel.into(), max_changed)
}

/// Absolute path under the temp dir.
pub(crate) fn ap(dir: &Path, rel: &str) -> String {
    dir.join(rel).to_string_lossy().into_owned()
}

/// Scenario construction shortcut.
///
/// Two forms:
///
///   scen!(id, cat, diff, role, setup)
///       — default: no tool prerequisites.
///
///   scen!(id, cat, diff, role, setup, tools = &["cargo", "go", ...])
///       — declare PATH executables the scenario needs. If any is missing
///         the runner marks the scenario SKIPPED (not FAIL) before running
///         setup, so scenarios whose setup itself shells out to `git` / `go`
///         / `cargo` don't panic on under-provisioned hosts.
macro_rules! scen {
    ($id:expr, $cat:expr, $diff:expr, $role:expr, $setup:ident) => {
        ScenarioSpec {
            id: $id,
            category: $cat,
            difficulty: $diff,
            role: $role,
            setup: $setup,
            required_tools: &[],
        }
    };
    ($id:expr, $cat:expr, $diff:expr, $role:expr, $setup:ident, tools = $tools:expr) => {
        ScenarioSpec {
            id: $id,
            category: $cat,
            difficulty: $diff,
            role: $role,
            setup: $setup,
            required_tools: $tools,
        }
    };
}

pub(crate) use scen;

// Aggregate all scenarios

pub(super) fn make_scenarios() -> Vec<ScenarioSpec> {
    let mut v = Vec::with_capacity(25);
    extra_hard_bugfix::scenarios(&mut v);
    extra_hard_refactor::scenarios(&mut v);
    extra_hard_patch::scenarios(&mut v);
    extra_hard_implement::scenarios(&mut v);
    extra_hard_testing::scenarios(&mut v);
    extra_hard_cross_file::scenarios(&mut v);
    extra_hard_security::scenarios(&mut v);
    extra_hard_concurrency::scenarios(&mut v);
    extra_hard_performance::scenarios(&mut v);
    extra_hard_context::scenarios(&mut v);
    extra_hard_search::scenarios(&mut v);
    extra_hard_understanding::scenarios(&mut v);
    v
}
