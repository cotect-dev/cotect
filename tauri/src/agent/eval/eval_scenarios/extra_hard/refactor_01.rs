//! Refactor v2 — Test 01: Deceptive Dead Code
//!
//! A token bucket rate limiter in Python with genuinely duplicated logic
//! between `consume()` and `try_consume()` that should be extracted.
//! However, several pieces of code LOOK like dead weight but are actually
//! critical:
//!
//! 1. `_compact_log()` looks like it only does debug logging and can be
//!    removed, but it also enforces an internal invariant: it trims the
//!    token timestamp list to prevent unbounded memory growth. Removing
//!    it causes the memory-growth test to fail.
//!
//! 2. The `__slots__` declaration looks overly restrictive and like it
//!    could be removed for "flexibility", but removing it changes the
//!    memory semantics and breaks the test that checks `__dict__` absence.
//!
//! 3. A `@staticmethod` `_clamp` is used only once and looks like it
//!    should be inlined, but a test calls it directly as a public API
//!    contract.
//!
//! The refactoring task: extract the shared refill-and-consume logic from
//! `consume()` and `try_consume()` into a single `_do_consume()` helper.
//! The duplicated code is real and should be consolidated — but the model
//! must NOT remove the "suspicious" helper methods.
//!
//! Verification: a test suite must pass after refactoring.

use std::path::Path;

use super::*;
use crate::agent::types::AgentRole::Implement as I;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let limiter_file = ap(dir, "rate_limiter.py");
        std::fs::write(
            &limiter_file,
            r#"import time

class TokenBucket:
    """A token-bucket rate limiter.

    Tokens refill at `rate` tokens per second up to `capacity`.
    """

    __slots__ = ('capacity', 'rate', '_tokens', '_last_refill', '_log')

    def __init__(self, capacity: int, rate: float):
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        if rate <= 0:
            raise ValueError("rate must be positive")
        self.capacity = capacity
        self.rate = rate
        self._tokens = float(capacity)
        self._last_refill = time.monotonic()
        self._log = []

    def _refill(self):
        """Add tokens based on elapsed time."""
        now = time.monotonic()
        elapsed = now - self._last_refill
        added = elapsed * self.rate
        self._tokens = min(self.capacity, self._tokens + added)
        self._last_refill = now

    def _compact_log(self):
        """Housekeeping for the token log."""
        if len(self._log) > self.capacity * 2:
            self._log = self._log[-self.capacity:]

    @staticmethod
    def _clamp(value, lo, hi):
        """Clamp a value between lo and hi."""
        if value < lo:
            return lo
        if value > hi:
            return hi
        return value

    def consume(self, n: int = 1) -> bool:
        """Consume n tokens. Returns True if successful, False if not
        enough tokens (no tokens consumed in that case).

        This method blocks briefly for the refill calculation.
        """
        if n <= 0:
            raise ValueError("n must be positive")
        self._refill()
        if self._tokens >= n:
            self._tokens -= n
            now = time.monotonic()
            for _ in range(n):
                self._log.append(now)
            self._compact_log()
            return True
        return False

    def try_consume(self, n: int = 1) -> tuple[bool, float]:
        """Try to consume n tokens.

        Returns (success, wait_time). If not enough tokens, wait_time
        is how long the caller should wait before retrying.
        """
        if n <= 0:
            raise ValueError("n must be positive")
        self._refill()
        if self._tokens >= n:
            self._tokens -= n
            now = time.monotonic()
            for _ in range(n):
                self._log.append(now)
            self._compact_log()
            return (True, 0.0)
        deficit = n - self._tokens
        wait = deficit / self.rate
        return (False, wait)

    @property
    def tokens(self):
        """Return current token count (triggers refill)."""
        self._refill()
        return self._tokens

    @property
    def log_size(self):
        """Number of entries in the consumption log."""
        return len(self._log)
"#,
        )
        .unwrap();

        let test_file = ap(dir, "test_rate_limiter.py");
        std::fs::write(
            &test_file,
            r#"import time
from rate_limiter import TokenBucket

def test_basic_consume():
    b = TokenBucket(10, 100.0)
    assert b.consume(5), "should consume 5 from 10"
    assert b.consume(5), "should consume remaining 5"
    assert not b.consume(1), "should be empty"

def test_try_consume_returns_wait():
    b = TokenBucket(2, 1.0)
    ok, wait = b.try_consume(2)
    assert ok, "should succeed"
    assert wait == 0.0
    ok, wait = b.try_consume(1)
    assert not ok, "should fail"
    assert wait > 0, f"wait should be positive, got {wait}"

def test_consume_and_try_consume_agree():
    """Both methods should produce identical state changes."""
    b1 = TokenBucket(5, 10.0)
    b2 = TokenBucket(5, 10.0)
    b1.consume(3)
    ok, _ = b2.try_consume(3)
    assert ok
    # After consuming 3 from 5, both should have ~2 tokens
    t1 = b1.tokens
    t2 = b2.tokens
    assert abs(t1 - t2) < 0.5, f"tokens diverged: {t1} vs {t2}"

def test_refill_over_time():
    b = TokenBucket(10, 1000.0)  # 1000 tokens/sec
    b.consume(10)
    time.sleep(0.05)  # ~50 tokens refilled
    assert b.tokens >= 5, f"should have refilled, got {b.tokens}"

def test_no_dict_attribute():
    b = TokenBucket(5, 1.0)
    assert not hasattr(b, '__dict__'), "TokenBucket should not have __dict__"

def test_clamp_static_method():
    assert TokenBucket._clamp(5, 0, 10) == 5
    assert TokenBucket._clamp(-1, 0, 10) == 0
    assert TokenBucket._clamp(100, 0, 10) == 10

def test_log_compaction():
    b = TokenBucket(10, 100000.0)  # very fast refill
    for _ in range(500):
        b.consume(1)
        time.sleep(0.0001)  # tiny sleep to allow refill
    # With capacity 10, log should be compacted to at most 20 entries
    assert b.log_size <= 20, \
        f"log should be compacted to <=20, got {b.log_size}"

def test_consume_invalid():
    b = TokenBucket(5, 1.0)
    try:
        b.consume(0)
        assert False, "should have raised ValueError"
    except ValueError:
        pass

def test_try_consume_invalid():
    b = TokenBucket(5, 1.0)
    try:
        b.try_consume(-1)
        assert False, "should have raised ValueError"
    except ValueError:
        pass

def test_deduplication():
    """consume() and try_consume() should share logic, not duplicate it."""
    import inspect
    src = inspect.getsource(TokenBucket)
    # The original duplicated block has self._log.append appearing in both
    # consume() and try_consume(). After proper refactoring, the log-append
    # logic should appear only once (in the shared helper).
    count = src.count('self._log.append')
    assert count <= 1, (
        f"self._log.append appears {count} times in TokenBucket — "
        f"consume() and try_consume() should share this logic via a helper"
    )

if __name__ == "__main__":
    test_basic_consume()
    test_try_consume_returns_wait()
    test_consume_and_try_consume_agree()
    test_refill_over_time()
    test_no_dict_attribute()
    test_clamp_static_method()
    test_log_compaction()
    test_consume_invalid()
    test_try_consume_invalid()
    test_deduplication()
    print("ALL_TESTS_PASSED")
"#,
        )
        .unwrap();

        with_blocked(
            with_scope(
                with_checks(
                    pf(format!(
                        "The rate limiter in {} has a maintainability problem: `consume()` and \
             `try_consume()` both carry out the same refill/check/deduct/log \
             sequence, so any change to that path has to be made in two places \
             and can easily drift out of sync. Clean the class up so the shared \
             sequence lives in one place while keeping every externally observable \
             behavior identical.\n\n\
             Step 1: Read the code and plan your refactoring.\n\
             Step 2: Apply changes WITHOUT running the code first.\n\
             Step 3: Run the existing `python3 test_rate_limiter.py` to verify your refactoring \
             didn't break anything. If tests fail, iterate until they pass.",
                        limiter_file
                    )),
                    vec![
                        complete(),
                        succeeded("shell"),
                        // Primary: the test suite must still pass — it exercises
                        // consume, try_consume, refill, __slots__, _clamp, and
                        // log compaction, so any correct refactoring will pass.
                        // The test suite itself enforces deduplication (counting
                        // self._log.append occurrences), so we only gate on behavior.
                        run_has("python3 test_rate_limiter.py", &["ALL_TESTS_PASSED"]),
                    ],
                ),
                vec![limiter_file],
            ),
            vec![test_file],
        )
    }
    v.push(scen!(
        "xhard_refactor_01_deceptive_dead_code",
        Category::Refactor,
        Difficulty::Hard,
        I,
        setup
    ));
}
