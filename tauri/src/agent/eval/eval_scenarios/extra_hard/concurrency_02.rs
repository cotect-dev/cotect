//! Concurrency — Test 02: asyncio.gather swallows non-first exceptions (Python)
//!
//! Classic `asyncio` pitfall. `fetch_all()` launches N concurrent fetches.
//! Every fetch raises a `FetchError` with a different `.url` attribute. The
//! contract is that `fetch_all` must raise a `BatchError` whose `.errors` list
//! contains ONE entry per failed source.
//!
//! BUG: the buggy implementation uses `asyncio.gather(*tasks)`, which raises
//! the first exception and cancels the rest — downstream callers only see one
//! FetchError and never learn that sources B, C, D, E also failed.
//!
//! Fixes (any of): `asyncio.gather(..., return_exceptions=True)` and build a
//! BatchError; or an `asyncio.TaskGroup` + ExceptionGroup translation; or
//! manual per-task awaiting inside `try/except`.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let src = ap(dir, "fetcher.py");
        std::fs::write(&src, r#""""Concurrent fetch helper with batched error reporting."""

import asyncio


class FetchError(Exception):
    def __init__(self, url: str, reason: str):
        super().__init__(f"{url}: {reason}")
        self.url = url
        self.reason = reason


class BatchError(Exception):
    def __init__(self, errors: list[FetchError]):
        super().__init__(f"{len(errors)} fetches failed")
        self.errors = errors


async def _fetch(url: str) -> str:
    # Simulated latency + guaranteed failure. All five sources fail in the
    # test — the point is to verify ALL of them are surfaced to the caller.
    await asyncio.sleep(0.001)
    raise FetchError(url, "simulated")


async def fetch_all(urls: list[str]) -> list[str]:
    """Fetch every URL concurrently. On any failures, raise BatchError whose
    `.errors` list contains one FetchError per failed URL."""
    tasks = [asyncio.create_task(_fetch(u)) for u in urls]
    # BUG: `gather` without `return_exceptions=True` surfaces only the first
    # exception and silently cancels the rest, so callers lose 4/5 failures.
    return await asyncio.gather(*tasks)
"#).unwrap();

        let test = ap(dir, "test_fetcher.py");
        std::fs::write(&test, r#""""Verify BatchError surfaces every failure."""

import asyncio
import fetcher


def test_all_errors_are_reported():
    urls = ["https://a", "https://b", "https://c", "https://d", "https://e"]
    try:
        asyncio.run(fetcher.fetch_all(urls))
    except fetcher.BatchError as be:
        got = {e.url for e in be.errors}
        assert got == set(urls), (
            f"expected all 5 URLs in BatchError.errors, got {got}"
        )
        assert len(be.errors) == 5
    except fetcher.FetchError as fe:
        raise AssertionError(
            f"fetch_all surfaced a single FetchError ({fe.url}) — should have "
            "collected all 5 into BatchError"
        )
    else:
        raise AssertionError("fetch_all should have raised BatchError")


def test_happy_path_preserved():
    # Monkey-patch _fetch to return instead of raising, to check the success
    # path still works after the fix.
    async def ok(u: str) -> str:
        await asyncio.sleep(0)
        return u.upper()

    original = fetcher._fetch
    fetcher._fetch = ok
    try:
        out = asyncio.run(fetcher.fetch_all(["a", "b", "c"]))
        assert out == ["A", "B", "C"], f"happy-path output mismatch: {out}"
    finally:
        fetcher._fetch = original


if __name__ == "__main__":
    test_all_errors_are_reported()
    test_happy_path_preserved()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(
            "`fetcher.py` has a subtle asyncio bug: when `fetch_all` is \
             called with URLs that all fail, callers only see ONE error \
             instead of the full batch. The test suite (`test_fetcher.py`) \
             expects a `BatchError` containing every failure.\n\n\
             Fix `fetch_all` so `python3 test_fetcher.py` prints \
             ALL_TESTS_PASSED. Preserve the public API of FetchError / \
             BatchError; feel free to restructure the implementation. The \
             happy-path test also re-runs fetch_all with a monkey-patched \
             `_fetch` that succeeds — make sure success still returns a list \
             of results."
            .to_string()
        ),
            vec![
                complete(),
                succeeded("shell"),
                run_has("python3 test_fetcher.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![src]),
            vec![test])
    }
    v.push(scen!("xhard_concurrency_02_async_gather_partial", Category::Concurrency, Difficulty::Hard, I, setup));
}
