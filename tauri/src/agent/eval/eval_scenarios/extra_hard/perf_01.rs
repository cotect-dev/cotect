//! Performance — Test 01: Quadratic dedupe → linear (Rust)
//!
//! `dedupe(xs)` must return a deduplicated vector that preserves the FIRST
//! occurrence of each value in input order. The seed implementation is
//! O(n²) because it uses `Vec::contains` inside the loop — on the 50_000-
//! element input with heavy duplication the benchmark test wall-clocks past
//! 30 seconds.
//!
//! Fix: use a `HashSet` to track seen keys; the Vec collects order.
//!
//! The test asserts correctness (order + values) AND a wall-clock budget
//! of 500ms in `--release` mode. The model must recognize the quadratic
//! lookup and swap it for a set-based dedupe.

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
        // Linear scan on every push — quadratic in input size.
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
fn perf_budget_50k() {
    // 50_000 elements with many duplicates. The buggy O(n²) version takes
    // tens of seconds; a HashSet-based fix completes in well under 100ms.
    let input: Vec<i64> = (0..50_000).map(|i| (i % 5000) as i64).collect();
    let expected_len = 5000;

    let start = Instant::now();
    let out = dedupe(input);
    let elapsed = start.elapsed();

    assert_eq!(out.len(), expected_len, "output length mismatch");

    // First-occurrence order: the first 5000 values of the input are 0..5000
    // and later copies should not displace them.
    for (i, v) in out.iter().enumerate() {
        assert_eq!(*v, i as i64, "index {}: order broken", i);
    }

    assert!(
        elapsed.as_millis() < 500,
        "dedupe took {}ms for 50k input (budget 500ms) — still quadratic",
        elapsed.as_millis(),
    );

    println!("ALL_TESTS_PASSED");
}
"#).unwrap();

        // `--nocapture` lets println! reach stdout so the rubric can see the marker.
        let run_cmd = "cargo test --release --test bench -- --nocapture 2>&1";

        with_scope(with_checks(pf(
            "The `dedupe` crate in this tempdir has a correctness-correct \
             but performance-quadratic implementation. The `perf_budget_50k` \
             integration test enforces a 500ms wall-clock budget on a \
             50_000-element input and currently times out.\n\n\
             Rewrite `dedupe` in `src/lib.rs` so `cargo test --release` \
             passes both `correctness` and `perf_budget_50k` and prints \
             ALL_TESTS_PASSED. Keep the signature \
             `pub fn dedupe(xs: Vec<i64>) -> Vec<i64>` and preserve \
             first-occurrence insertion order. No new crate dependencies \
             — the Rust standard library is enough."
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
