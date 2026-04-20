//! Performance — Test 02: N+1 database-query pattern (Python)
//!
//! `fetch_user_names(ids)` looks up user rows one-at-a-time via the mock
//! repository's `get_user(id)` — the textbook N+1 pattern. The repo offers
//! a batched alternative, `get_users_batch(ids)`, but the model only
//! discovers it by READING the repository module (it's not exported at the
//! top of `repo.py`). The fix is to switch to batched reads and preserve
//! insertion order on the response (the batch may return rows in any
//! order).
//!
//! The test exercises three axes:
//!   1. Correctness on small input (5 ids).
//!   2. Order preservation on a shuffled-id input (the batch must not
//!      reorder the output).
//!   3. Database call budget: ≤5 total `MockDB` invocations when looking
//!      up 1 000 users. Naive N+1 produces 1 000+ calls and trips this.
//!
//! Why it's harder than the previous "streaming refactor" scenario:
//!   * The optimisation isn't a one-line pattern match (`f.read()` →
//!     chunked loop); the model has to traverse the module to find the
//!     batch API, and understand that batch responses may reorder.
//!   * Wrong fixes are silent: the code still works functionally, it just
//!     calls the DB 1 000 times. Only the call counter surfaces the bug.
//!   * Classic production failure mode, not a microbenchmark toy.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let repo = ap(dir, "repo.py");
        std::fs::write(&repo, r#""""Mock user repository.

Exposes two ways to look up users:

  * `get_user(id)`         — single-row lookup.
  * `get_users_batch(ids)` — batched lookup; returns rows in arbitrary
    order (the underlying store is a hashmap), so callers must re-order
    the response to match the request.

Both paths bump the same call counter so downstream tests can enforce a
database-call budget.
"""

import time

# All users live here. Ids are 1..=N for simplicity.
_STORE = {i: {"id": i, "name": f"user_{i}", "email": f"u{i}@example.com"} for i in range(1, 10_001)}


class MockDB:
    _calls = 0

    @classmethod
    def reset(cls):
        cls._calls = 0

    @classmethod
    def calls(cls):
        return cls._calls

    @classmethod
    def get_user(cls, user_id):
        """Fetch a single user by id. One database call."""
        cls._calls += 1
        # Simulated per-call latency — a 1 000-row N+1 loop under this
        # costs >500 ms wall clock. The budget-enforcement test will time
        # out long before it reaches the call counter for extra safety.
        time.sleep(0.0005)
        row = _STORE.get(user_id)
        if row is None:
            raise KeyError(f"user not found: {user_id}")
        return dict(row)

    @classmethod
    def get_users_batch(cls, user_ids):
        """Fetch many users at once. Exactly ONE database call regardless of
        batch size. Returns a list of user dicts in UNSPECIFIED order —
        callers must reorder against `user_ids` if insertion order matters.
        """
        cls._calls += 1
        time.sleep(0.001)
        # Intentionally return in hash order, not input order, so naive
        # "just swap get_user for get_users_batch" fixes break the
        # order-preservation test.
        rows = [dict(_STORE[i]) for i in user_ids if i in _STORE]
        rows.sort(key=lambda r: hash(r["id"]) & 0xFFFF)
        return rows
"#).unwrap();

        let service = ap(dir, "service.py");
        std::fs::write(&service, r#""""User-facing service layer.

`fetch_user_names(user_ids)` currently loops over ids one at a time —
a classic N+1 pattern. Fix so the number of `MockDB` calls scales with
batches, not with the size of `user_ids`, while preserving insertion
order in the return value.
"""

from repo import MockDB


def fetch_user_names(user_ids):
    """Return the display names of `user_ids`, in the same order as the
    input. Must scale — the test runs with 1 000 ids under a strict
    database-call budget.
    """
    names = []
    for uid in user_ids:
        user = MockDB.get_user(uid)
        names.append(user["name"])
    return names
"#).unwrap();

        let test = ap(dir, "test_service.py");
        std::fs::write(&test, r#""""Three-axis N+1 rubric."""

from repo import MockDB
from service import fetch_user_names


def test_correctness_small():
    MockDB.reset()
    result = fetch_user_names([1, 2, 3, 4, 5])
    assert result == ["user_1", "user_2", "user_3", "user_4", "user_5"], \
        f"basic lookup wrong: {result}"


def test_order_preserved_on_shuffled_ids():
    # `get_users_batch` returns rows in arbitrary order. The service must
    # re-key the response against the input so order is preserved.
    MockDB.reset()
    ids = [17, 3, 499, 28, 9912, 1, 7, 4000, 256, 2]
    result = fetch_user_names(ids)
    expected = [f"user_{i}" for i in ids]
    assert result == expected, (
        "output order must match input order; got:\n  "
        + "\n  ".join(f"{got} (expected {exp})" for got, exp in zip(result, expected))
    )


def test_db_call_budget_under_batching():
    # Under batching, 1 000 ids should fit in a handful of DB calls.
    # Naive N+1 (one call per id) lands at 1 000+ — trivially trips this.
    # We allow up to 5 so the model can legitimately chunk if it wants to.
    MockDB.reset()
    ids = list(range(1, 1001))
    _ = fetch_user_names(ids)
    calls = MockDB.calls()
    assert calls <= 5, (
        f"N+1 pattern: made {calls} database calls to resolve 1 000 users. "
        "Use the batched API on the repository."
    )


if __name__ == "__main__":
    test_correctness_small()
    test_order_preserved_on_shuffled_ids()
    test_db_call_budget_under_batching()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(
            "The `fetch_user_names` function in `service.py` has a classic \
             N+1 database problem: it calls `MockDB.get_user` once per id, \
             so looking up 1 000 users makes 1 000 database round trips. \
             `test_service.py` enforces a budget of at most 5 `MockDB` calls \
             for a 1 000-id input, and also checks that the output order \
             matches the input order (the batched API returns rows in \
             arbitrary order).\n\n\
             Read `repo.py` to find the batched lookup, rewrite \
             `fetch_user_names` to use it, and run `python3 test_service.py` \
             until it prints ALL_TESTS_PASSED.\n\n\
             Keep the signature `fetch_user_names(user_ids: list[int]) -> list[str]`."
            .to_string()
        ),
            vec![
                complete(),
                succeeded("shell"),
                run_has("python3 test_service.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![service]),
            vec![test])
    }
    v.push(scen!("xhard_perf_02_n_plus_one", Category::Performance, Difficulty::Hard, I, setup));
}
