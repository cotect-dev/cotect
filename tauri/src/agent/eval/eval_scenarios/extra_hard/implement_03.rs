//! Implement v2 — Test 03: Add caching layer to existing multi-file service
//!
//! A 3-file system with a data repository (`repo.py`), a computation
//! service (`service.py`), and a configuration module (`config.py`).
//! The model must implement a caching decorator/wrapper in `cache.py`
//! and wire it into the service layer.
//!
//! The model must:
//! 1. Create `cache.py` with a `Cache` class supporting TTL-based expiry
//! 2. Add `cached_get` method to `DataService` that uses the cache
//! 3. Support cache invalidation on writes
//! 4. Respect existing code patterns and config values
//!
//! Existing patterns to follow:
//! - Config provides `CACHE_TTL_SECONDS` and `CACHE_MAX_SIZE`
//! - Service methods return dicts matching repo format
//! - The repo has a `_call_count` tracker for testing
//!
//! Hidden test coverage:
//! - Cache hit avoids repo call (verified via call count)
//! - TTL expiry forces cache miss
//! - Write operations invalidate relevant cache entries
//! - Cache respects max size limit

use std::path::Path;

use super::*;
use crate::agent::types::AgentRole::Implement as I;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let config_file = ap(dir, "config.py");
        std::fs::write(
            &config_file,
            r#"# Application configuration

DATABASE_NAME = "app.db"
MAX_CONNECTIONS = 5
DEBUG = False

# Cache settings
CACHE_TTL_SECONDS = 2
CACHE_MAX_SIZE = 3
"#,
        )
        .unwrap();

        let repo_file = ap(dir, "repo.py");
        std::fs::write(
            &repo_file,
            r#"class DataRepository:
    """Simulated data repository (in-memory for testing)."""

    def __init__(self):
        self._store = {}
        self._call_count = {"get": 0, "put": 0, "delete": 0}

    def get(self, key: str) -> dict | None:
        """Fetch a record by key. Returns None if not found."""
        self._call_count["get"] += 1
        if key not in self._store:
            return None
        return dict(self._store[key])

    def put(self, key: str, value: dict) -> None:
        """Insert or update a record."""
        self._call_count["put"] += 1
        self._store[key] = dict(value)

    def delete(self, key: str) -> bool:
        """Delete a record. Returns True if it existed."""
        self._call_count["delete"] += 1
        return self._store.pop(key, None) is not None

    def list_keys(self) -> list[str]:
        """Return all keys in sorted order."""
        return sorted(self._store.keys())

    @property
    def call_counts(self) -> dict:
        """Return a copy of the call counter."""
        return dict(self._call_count)
"#,
        )
        .unwrap();

        let service_file = ap(dir, "service.py");
        std::fs::write(
            &service_file,
            r#"from repo import DataRepository
from config import CACHE_TTL_SECONDS, CACHE_MAX_SIZE


class DataService:
    """Service layer that wraps the repository with business logic."""

    def __init__(self, repo: DataRepository):
        self._repo = repo

    def get_record(self, key: str) -> dict | None:
        """Get a record directly from the repository (no caching)."""
        return self._repo.get(key)

    def save_record(self, key: str, data: dict) -> None:
        """Save a record to the repository."""
        if not key or not isinstance(key, str):
            raise ValueError("Key must be a non-empty string")
        if not isinstance(data, dict):
            raise ValueError("Data must be a dict")
        self._repo.put(key, data)

    def delete_record(self, key: str) -> bool:
        """Delete a record from the repository."""
        return self._repo.delete(key)

    def list_keys(self) -> list[str]:
        """List all record keys."""
        return self._repo.list_keys()

    @property
    def repo(self) -> DataRepository:
        """Access the underlying repository (for testing)."""
        return self._repo

    # TODO: implement cached_get(self, key: str) -> dict | None
    # Returns the same value as get_record(key) for the caller, but avoids
    # querying the repository when an un-expired cached result exists.
    # Behaviour contract:
    # - Repeated calls for the same key within CACHE_TTL_SECONDS must not
    #   reach the repository again.
    # - Once more than CACHE_TTL_SECONDS have elapsed since the value was
    #   cached, the next call must consult the repository again.
    # - At most CACHE_MAX_SIZE distinct keys are remembered; when the limit
    #   is exceeded, the least-recently-inserted key is forgotten first.
    # - save_record(key, ...) and delete_record(key) must cause the next
    #   cached_get(key) to reflect the new repository state.
    # - get_record() (the uncached entry point) must continue to bypass the
    #   cache entirely.
    # - Negative results (key not present in the repository, i.e. None) are
    #   not stored in the cache and do not count toward CACHE_MAX_SIZE.

    # TODO: implement cache_stats(self) -> dict
    # Returns {"hits": int, "misses": int, "size": int} where:
    #   - "hits" counts cached_get calls served from the cache,
    #   - "misses" counts cached_get calls that consulted the repository,
    #   - "size" is the number of keys currently cached.
"#,
        )
        .unwrap();

        let test_file = ap(dir, "test_service.py");
        std::fs::write(
            &test_file,
            r#"import time
from repo import DataRepository
from service import DataService


def test_cached_get_returns_data():
    repo = DataRepository()
    svc = DataService(repo)
    svc.save_record("user:1", {"name": "Alice", "age": 30})

    result = svc.cached_get("user:1")
    assert result is not None
    assert result["name"] == "Alice"
    assert result["age"] == 30


def test_cached_get_returns_none_for_missing():
    repo = DataRepository()
    svc = DataService(repo)
    result = svc.cached_get("nonexistent")
    assert result is None


def test_cache_avoids_repo_call():
    repo = DataRepository()
    svc = DataService(repo)
    svc.save_record("user:1", {"name": "Alice"})

    repo._call_count["get"] = 0

    svc.cached_get("user:1")
    svc.cached_get("user:1")
    svc.cached_get("user:1")

    assert repo.call_counts["get"] == 1, \
        f"Should hit repo only once, got {repo.call_counts['get']}"


def test_cache_ttl_expiry():
    repo = DataRepository()
    svc = DataService(repo)
    svc.save_record("user:1", {"name": "Alice"})

    repo._call_count["get"] = 0

    svc.cached_get("user:1")
    assert repo.call_counts["get"] == 1

    time.sleep(2.5)

    svc.cached_get("user:1")
    assert repo.call_counts["get"] == 2, \
        f"After TTL, should hit repo again, got {repo.call_counts['get']}"


def test_save_invalidates_cache():
    repo = DataRepository()
    svc = DataService(repo)
    svc.save_record("user:1", {"name": "Alice"})

    svc.cached_get("user:1")
    assert svc.cached_get("user:1")["name"] == "Alice"

    svc.save_record("user:1", {"name": "Bob"})

    result = svc.cached_get("user:1")
    assert result["name"] == "Bob", \
        f"After save, cached_get should return new data, got {result}"


def test_delete_invalidates_cache():
    repo = DataRepository()
    svc = DataService(repo)
    svc.save_record("user:1", {"name": "Alice"})
    svc.cached_get("user:1")

    svc.delete_record("user:1")

    result = svc.cached_get("user:1")
    assert result is None, \
        f"After delete, cached_get should return None, got {result}"


def test_cache_max_size():
    repo = DataRepository()
    svc = DataService(repo)
    svc.save_record("a", {"v": 1})
    svc.save_record("b", {"v": 2})
    svc.save_record("c", {"v": 3})
    svc.save_record("d", {"v": 4})

    svc.cached_get("a")
    svc.cached_get("b")
    svc.cached_get("c")
    svc.cached_get("d")

    stats = svc.cache_stats()
    assert stats["size"] <= 3, \
        f"Cache should hold at most 3 entries, has {stats['size']}"


def test_cache_evicts_oldest():
    repo = DataRepository()
    svc = DataService(repo)
    svc.save_record("a", {"v": 1})
    svc.save_record("b", {"v": 2})
    svc.save_record("c", {"v": 3})
    svc.save_record("d", {"v": 4})

    repo._call_count["get"] = 0

    svc.cached_get("a")
    svc.cached_get("b")
    svc.cached_get("c")
    assert repo.call_counts["get"] == 3

    svc.cached_get("d")
    assert repo.call_counts["get"] == 4

    svc.cached_get("a")
    assert repo.call_counts["get"] == 5, \
        f"'a' should have been evicted, expected 5 calls, got {repo.call_counts['get']}"


def test_cache_stats():
    repo = DataRepository()
    svc = DataService(repo)
    svc.save_record("x", {"v": 1})

    svc.cached_get("x")
    svc.cached_get("x")
    svc.cached_get("missing")

    stats = svc.cache_stats()
    assert stats["hits"] == 1, f"expected 1 hit, got {stats['hits']}"
    assert stats["misses"] == 2, f"expected 2 misses, got {stats['misses']}"
    assert stats["size"] == 1, f"expected size 1, got {stats['size']}"


def test_get_record_bypasses_cache():
    repo = DataRepository()
    svc = DataService(repo)
    svc.save_record("x", {"v": 1})

    repo._call_count["get"] = 0
    svc.get_record("x")
    svc.get_record("x")
    assert repo.call_counts["get"] == 2, \
        f"get_record should always hit repo, got {repo.call_counts['get']}"


def test_existing_methods_still_work():
    repo = DataRepository()
    svc = DataService(repo)
    svc.save_record("k1", {"a": 1})
    svc.save_record("k2", {"b": 2})

    assert svc.get_record("k1") == {"a": 1}
    assert svc.list_keys() == ["k1", "k2"]
    assert svc.delete_record("k1") is True
    assert svc.list_keys() == ["k2"]


if __name__ == "__main__":
    test_cached_get_returns_data()
    test_cached_get_returns_none_for_missing()
    test_cache_avoids_repo_call()
    test_cache_ttl_expiry()
    test_save_invalidates_cache()
    test_delete_invalidates_cache()
    test_cache_max_size()
    test_cache_evicts_oldest()
    test_cache_stats()
    test_get_record_bypasses_cache()
    test_existing_methods_still_work()
    print("ALL_TESTS_PASSED")
"#,
        )
        .unwrap();

        with_blocked(
            with_scope(
                with_checks(
                    pf(format!(
                        "Add caching to the `DataService` in {} by implementing \
             `cached_get` and `cache_stats` as specified in the TODO \
             contracts. The behaviour is fully defined there: TTL is \
             CACHE_TTL_SECONDS, capacity is CACHE_MAX_SIZE, writes invalidate \
             the affected key, and cache_stats reports hits/misses/size.\n\n\
             Verify with `python3 test_service.py`.",
                        service_file
                    )),
                    vec![
                        complete(),
                        succeeded("shell"),
                        run_has("python3 test_service.py", &["ALL_TESTS_PASSED"]),
                    ],
                ),
                vec![config_file, repo_file, service_file],
            ),
            vec![test_file],
        )
    }
    v.push(scen!(
        "xhard_implement_03_caching_layer",
        Category::Implement,
        Difficulty::Hard,
        I,
        setup
    ));
}
