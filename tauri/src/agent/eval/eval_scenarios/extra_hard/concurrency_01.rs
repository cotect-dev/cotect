//! Concurrency — Test 01: Goroutine shutdown sentinel bug (Go)
//!
//! Producer/consumer pipeline in Go. Producer publishes N items, then sends a
//! single sentinel (struct-zero) to signal shutdown. N workers read from the
//! shared channel.
//!
//! BUG: only one worker sees the sentinel and exits; the others block forever
//! on the receive, so `Run()` never returns. Observable only with ≥2 workers.
//!
//! Fix: close the channel after producing (range-over-chan exits cleanly) OR
//! send N sentinels OR cancel via `context.Context`.
//!
//! The test runs with 4 workers under a 2-second deadline and verifies:
//!   * `Run` returns (no deadlock)
//!   * every produced item is accounted for (no drops)
//!   * exit is clean within budget

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let gomod = ap(dir, "go.mod");
        std::fs::write(&gomod, "module pipeline\n\ngo 1.20\n").unwrap();

        let src = ap(dir, "pipeline.go");
        std::fs::write(&src, r#"package pipeline

import (
	"context"
	"sync"
	"sync/atomic"
)

// Run spawns `workers` consumer goroutines, a single producer that publishes
// 100 integers, and returns when every worker has exited. The total count
// of items consumed is returned via `*consumed`.
//
// The function must not leak goroutines and must return within ctx.Deadline.
func Run(ctx context.Context, workers int, consumed *int64) error {
	ch := make(chan int)
	var wg sync.WaitGroup

	// Workers
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				v, ok := <-ch
				if !ok {
					return
				}
				if v == 0 {
					return
				}
				atomic.AddInt64(consumed, 1)
			}
		}()
	}

	// Producer
	go func() {
		for i := 1; i <= 100; i++ {
			select {
			case ch <- i:
			case <-ctx.Done():
				return
			}
		}
		ch <- 0
	}()

	wg.Wait()
	return nil
}
"#).unwrap();

        let test_src = ap(dir, "pipeline_test.go");
        std::fs::write(&test_src, r#"package pipeline

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestCleanShutdownFourWorkers(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	var consumed int64
	done := make(chan error, 1)
	start := time.Now()
	go func() { done <- Run(ctx, 4, &consumed) }()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run returned error: %v", err)
		}
	case <-ctx.Done():
		t.Fatalf("Run did not return within 2s — goroutines leaking / blocked")
	}

	if elapsed := time.Since(start); elapsed > 1500*time.Millisecond {
		t.Fatalf("shutdown took too long: %v", elapsed)
	}
	if consumed != 100 {
		t.Fatalf("expected 100 items consumed, got %d", consumed)
	}
	fmt.Println("ALL_TESTS_PASSED")
}
"#).unwrap();

        // Runner invokes `go test` with -count=1 to bypass cached passes.
        let run_cmd = "go test -run TestCleanShutdownFourWorkers -v -count=1 -timeout 10s . 2>&1";

        with_scope(with_checks(pf(
            "The `pipeline` package in this tempdir (Go, go.mod present) \
             has a bug: `go test -run TestCleanShutdownFourWorkers` times \
             out. Fix it so the test prints ALL_TESTS_PASSED within the \
             deadline. Preserve the signature of `Run(ctx context.Context, \
             workers int, consumed *int64) error`. No third-party \
             dependencies."
            .to_string()
        ),
            vec![
                complete(),
                succeeded("shell"),
                run_has(run_cmd, &["ALL_TESTS_PASSED"]),
            ]),
            vec![src.clone(), gomod, test_src])
    }
    v.push(scen!(
        "xhard_concurrency_01_shutdown_signal",
        Category::Concurrency, Difficulty::Hard, I, setup,
        tools = &["go"]
    ));
}
