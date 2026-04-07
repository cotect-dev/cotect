//! Bugfix v2 — Test 01: Warm-up Hard
//!
//! A single-file custom LRU cache in Python with three interacting bugs:
//! 1. `get()` does not promote the accessed key to most-recently-used position
//! 2. `put()` eviction uses `>` instead of `>=`, allowing capacity+1 entries
//! 3. `_evict()` pops from the wrong end of the ordering list (newest instead of oldest)
//!
//! Red herrings:
//! - A `_fingerprint` method that looks suspicious (custom hashing) but is correct
//! - A misleading comment about thread safety that is irrelevant
//! - An `__repr__` method with unusual formatting that works fine
//!
//! Verification: a test script exercises the cache and asserts correct behavior.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let cache_file = ap(dir, "lru_cache.py");
        std::fs::write(&cache_file, r#"class LRUCache:
    """A least-recently-used cache with fixed capacity.

    NOTE: not thread-safe — single-threaded use only.
    """

    def __init__(self, capacity: int):
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        self.capacity = capacity
        self._store = {}      # key -> value
        self._order = []      # tracks access order, index 0 = oldest

    def _fingerprint(self, key):
        """Internal diagnostic hash — used for debug logging only."""
        h = 0
        for ch in str(key):
            h = (h * 31 + ord(ch)) & 0xFFFFFFFF
        return hex(h)

    def get(self, key):
        """Return value for key, or None if not present."""
        if key not in self._store:
            return None
        return self._store[key]

    def put(self, key, value):
        """Insert or update key-value. Evicts LRU entry if over capacity."""
        if key in self._store:
            self._store[key] = value
            return

        if len(self._store) > self.capacity:
            self._evict()

        self._store[key] = value
        self._order.append(key)

    def _evict(self):
        """Remove the least-recently-used entry."""
        if not self._order:
            return
        oldest = self._order.pop()
        if oldest in self._store:
            del self._store[oldest]

    def size(self):
        return len(self._store)

    def __repr__(self):
        items = ", ".join(
            f"{k!r}:{v!r}" for k, v in
            sorted(self._store.items(), key=lambda x: self._order.index(x[0])
                   if x[0] in self._order else -1)
        )
        return f"LRUCache({self.capacity})[{items}]"

    def keys(self):
        """Return keys in access order (oldest first)."""
        return list(self._order)
"#).unwrap();

        let test_file = ap(dir, "test_lru.py");
        std::fs::write(&test_file, r#"from lru_cache import LRUCache

def test_basic_put_get():
    c = LRUCache(3)
    c.put("a", 1)
    c.put("b", 2)
    c.put("c", 3)
    assert c.get("a") == 1, f"expected 1, got {c.get('a')}"
    assert c.get("b") == 2
    assert c.get("c") == 3
    assert c.size() == 3, f"expected size 3, got {c.size()}"

def test_eviction_at_capacity():
    """When cache is full, adding one more should evict the oldest."""
    c = LRUCache(2)
    c.put("x", 10)
    c.put("y", 20)
    # Cache is at capacity (2). Adding "z" should evict "x" (oldest).
    c.put("z", 30)
    assert c.size() == 2, f"expected size 2 after eviction, got {c.size()}"
    assert c.get("x") is None, "x should have been evicted"
    assert c.get("y") == 20, "y should still be present"
    assert c.get("z") == 30, "z should be present"

def test_access_promotes_recency():
    """Accessing an item should prevent it from being evicted next."""
    c = LRUCache(2)
    c.put("a", 1)
    c.put("b", 2)
    # Access "a" so it becomes most-recently-used
    c.get("a")
    # Now adding "c" should evict "b" (the actual least-recently-used), not "a"
    c.put("c", 3)
    assert c.get("b") is None, "b should have been evicted (LRU)"
    assert c.get("a") == 1, "a should still be present (was accessed recently)"
    assert c.get("c") == 3

def test_update_promotes_recency():
    """Updating an existing key should count as an access."""
    c = LRUCache(2)
    c.put("a", 1)
    c.put("b", 2)
    # Update "a" — should promote it
    c.put("a", 100)
    # Adding "c" should evict "b", not "a"
    c.put("c", 3)
    assert c.get("b") is None, "b should have been evicted"
    assert c.get("a") == 100, f"a should be 100, got {c.get('a')}"

def test_eviction_order():
    """Verify eviction always removes the true oldest un-accessed item."""
    c = LRUCache(3)
    c.put("a", 1)
    c.put("b", 2)
    c.put("c", 3)
    # Access pattern: touch b and c, leaving a as LRU
    c.get("b")
    c.get("c")
    c.put("d", 4)
    assert c.get("a") is None, "a should be evicted (oldest un-accessed)"
    assert c.size() == 3

if __name__ == "__main__":
    test_basic_put_get()
    test_eviction_at_capacity()
    test_access_promotes_recency()
    test_update_promotes_recency()
    test_eviction_order()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(format!(
            "The LRU cache in {} is broken — eviction doesn't work correctly \
             and the cache sometimes holds more items than its capacity allows.\n\n\
             Step 1: Read the code, identify all bugs, and apply your fixes \
             WITHOUT running the code first.\n\
             Step 2: Run `python3 test_lru.py` to check your work.\n\
             Step 3: If any tests fail, read the error output, adjust your \
             fix, and re-run until all tests pass.",
            cache_file)),
            vec![
                complete(),
                succeeded("shell"),
                // Primary: the test suite must pass — it exercises eviction,
                // promotion, capacity, and ordering so any correct fix will pass.
                run_has("python3 test_lru.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![cache_file]),
            vec![test_file])
    }
    v.push(scen!("v2_bugfix_01_lru_cache", Category::Bugfix, Difficulty::Hard, I, setup));
}
