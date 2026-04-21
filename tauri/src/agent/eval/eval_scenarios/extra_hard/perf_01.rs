//! Performance — Test 01: Quadratic dedupe → linear (Rust)
//!
//! `dedupe(xs)` must return a deduplicated vector that preserves the FIRST
//! occurrence of each value in input order. The seed implementation is
//! O(n²) because it uses `Vec::contains` inside the loop — on the 200_000-
//! element input with heavy duplication the benchmark wall-clocks well
//! past the 150ms budget.
//!
//! Fix: use a `HashSet` to track seen keys; the Vec collects order.
//!
//! The test asserts correctness (order + values) AND a wall-clock budget
//! of 150 ms in `--release` mode. That budget is tight enough that
//! "slightly smarter quadratic" variants (sorting first, early-break on
//! `Vec::contains`, etc.) still fail — the model must pick a set-based
//! O(n) approach.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let cargo_toml = ap(dir, "Cargo.toml");
        std::fs::write(&cargo_toml, r#"[package]
name = "dedupe"
version = "0.1.0"
edition = "2021"

[lib]
path = "src/lib.rs"

[profile.release]
opt-level = 3
"#).unwrap();

        std::fs::create_dir_all(dir.join("src")).unwrap();
        let lib = ap(dir, "src/lib.rs");
        std::fs::write(&lib, r#"//! First-occurrence-preserving deduplication.
//!
//! Returns a new Vec containing each distinct value from `xs` in the order
//! of its first appearance. Examples:
//!   dedupe(vec![3, 1, 2, 1, 3, 4]) == vec![3, 1, 2, 4]

pub fn dedupe(xs: Vec<i64>) -> Vec<i64> {
    let mut result: Vec<i64> = Vec::new();
    for x in xs {
        if !result.contains(&x) {
            result.push(x);
        }
    }
    result
}
"#).unwrap();

        std::fs::create_dir_all(dir.join("tests")).unwrap();
        let test = ap(dir, "tests/bench.rs");
        std::fs::write(&test, r#"use std::time::Instant;

use dedupe::dedupe;

#[test]
fn correctness() {
    let input = vec![3, 1, 2, 1, 3, 4, 2, 5];
    let out = dedupe(input);
    assert_eq!(out, vec![3, 1, 2, 4, 5]);
}

#[test]
fn perf_budget_200k() {
    let input: Vec<i64> = (0..200_000).map(|i| (i % 10_000) as i64).collect();
    let expected_len = 10_000;

    let start = Instant::now();
    let out = dedupe(input);
    let elapsed = start.elapsed();

    assert_eq!(out.len(), expected_len, "output length mismatch");

    // First-occurrence order: the first 10 000 values of the input are
    // 0..10_000 and later copies should not displace them.
    for (i, v) in out.iter().enumerate() {
        assert_eq!(*v, i as i64, "index {}: order broken", i);
    }

    assert!(
        elapsed.as_millis() < 150,
        "dedupe took {}ms for 200k input (budget 150ms) — need a set-based O(n) approach",
        elapsed.as_millis(),
    );

    println!("ALL_TESTS_PASSED");
}
"#).unwrap();

        // `--nocapture` lets println! reach stdout so the rubric can see the marker.
        let run_cmd = "cargo test --release --test bench -- --nocapture 2>&1";

        with_scope(with_checks(pf(
            "The `dedupe` crate in this tempdir has a correctness-correct \
             but performance-quadratic implementation. The `perf_budget_200k` \
             integration test enforces a 150 ms wall-clock budget on a \
             200_000-element input and currently times out.\n\n\
             Rewrite `dedupe` in `src/lib.rs` so `cargo test --release` \
             passes both `correctness` and `perf_budget_200k` and prints \
             ALL_TESTS_PASSED. Keep the signature \
             `pub fn dedupe(xs: Vec<i64>) -> Vec<i64>` and preserve \
             first-occurrence insertion order. No new crate dependencies; \
             the Rust standard library is enough."
            .to_string()
        ),
            vec![
                complete(),
                succeeded("shell"),
                run_has(run_cmd, &["ALL_TESTS_PASSED"]),
            ]),
            vec![lib, cargo_toml, test])
    }
    v.push(scen!(
        "xhard_perf_01_quadratic_dedupe",
        Category::Performance, Difficulty::Hard, I, setup,
        tools = &["cargo"]
    ));
}
