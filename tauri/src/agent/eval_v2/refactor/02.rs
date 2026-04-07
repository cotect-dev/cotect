//! Refactor v2 — Test 02: Already Optimal
//!
//! A well-structured ring buffer implementation in Python. The code looks
//! like it has refactoring opportunities, but every "improvement" breaks
//! correctness:
//!
//! 1. The `_wrap` method looks trivially inlineable (`return idx % self._cap`),
//!    but it also handles the edge case when `self._cap` is 0 (raises a clear
//!    error). Inlining would scatter the zero-check or lose it.
//!
//! 2. Two properties `is_full` and `is_empty` look like they could be combined
//!    into one method, but they have subtly different semantics used in
//!    different contexts. Tests check them independently.
//!
//! 3. The `__iter__` method uses an explicit index loop instead of yielding
//!    from an internal list. This looks like it should use a simpler approach,
//!    but the ring buffer's physical layout differs from logical order —
//!    the iterator must walk from `_head` wrapping around.
//!
//! 4. There is a `_sentinel` class attribute set to `object()`. It looks unused
//!    but is compared via `is` identity in `peek()` to distinguish "empty" from
//!    "the user stored None". Removing or replacing it breaks `peek()`.
//!
//! The correct response is to make minimal or no structural changes. The prompt
//! tempts heavy refactoring. The test suite is tight and any semantic change fails.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let ring_file = ap(dir, "ring_buffer.py");
        std::fs::write(&ring_file, r#"class RingBuffer:
    """Fixed-capacity ring buffer (circular queue).

    Supports push, pop, peek, iteration, and length.
    When full, pushing overwrites the oldest element.
    """

    _sentinel = object()

    def __init__(self, capacity: int):
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        self._cap = capacity
        self._buf = [None] * capacity
        self._head = 0
        self._count = 0

    def _wrap(self, idx: int) -> int:
        """Wrap index around the buffer capacity."""
        if self._cap == 0:
            raise ZeroDivisionError("ring buffer capacity is zero")
        return idx % self._cap

    def push(self, item) -> None:
        """Add an item. Overwrites oldest if full."""
        tail = self._wrap(self._head + self._count)
        self._buf[tail] = item
        if self._count == self._cap:
            # Buffer is full — advance head (oldest is overwritten)
            self._head = self._wrap(self._head + 1)
        else:
            self._count += 1

    def pop(self):
        """Remove and return the oldest item. Raises IndexError if empty."""
        if self._count == 0:
            raise IndexError("pop from empty ring buffer")
        item = self._buf[self._head]
        self._buf[self._head] = None  # help GC
        self._head = self._wrap(self._head + 1)
        self._count -= 1
        return item

    def peek(self):
        """Return the oldest item without removing it, or a sentinel if empty."""
        if self._count == 0:
            return RingBuffer._sentinel
        return self._buf[self._head]

    @property
    def is_full(self) -> bool:
        """True when buffer has reached capacity."""
        return self._count == self._cap

    @property
    def is_empty(self) -> bool:
        """True when buffer has no elements."""
        return self._count == 0

    def __len__(self) -> int:
        return self._count

    def __iter__(self):
        """Iterate from oldest to newest."""
        for i in range(self._count):
            idx = self._wrap(self._head + i)
            yield self._buf[idx]

    def __repr__(self):
        items = list(self)
        return f"RingBuffer({self._cap}, items={items})"

    def clear(self):
        """Remove all elements."""
        self._buf = [None] * self._cap
        self._head = 0
        self._count = 0

    def to_list(self) -> list:
        """Return elements as a list from oldest to newest."""
        return list(self)
"#).unwrap();

        let test_file = ap(dir, "test_ring_buffer.py");
        std::fs::write(&test_file, r#"from ring_buffer import RingBuffer

def test_basic_push_pop():
    r = RingBuffer(3)
    r.push("a")
    r.push("b")
    r.push("c")
    assert r.pop() == "a"
    assert r.pop() == "b"
    assert r.pop() == "c"

def test_overwrite_oldest():
    r = RingBuffer(3)
    r.push(1)
    r.push(2)
    r.push(3)
    r.push(4)  # overwrites 1
    assert r.to_list() == [2, 3, 4], f"got {r.to_list()}"

def test_is_full_and_is_empty():
    r = RingBuffer(2)
    assert r.is_empty
    assert not r.is_full
    r.push("x")
    assert not r.is_empty
    assert not r.is_full
    r.push("y")
    assert not r.is_empty
    assert r.is_full

def test_peek_empty_returns_sentinel():
    r = RingBuffer(3)
    result = r.peek()
    assert result is RingBuffer._sentinel, \
        f"peek on empty should return sentinel, got {result!r}"

def test_peek_with_none_value():
    """Storing None should be distinguishable from empty."""
    r = RingBuffer(3)
    r.push(None)
    result = r.peek()
    assert result is None, f"peek should return None (the stored value), got {result!r}"
    assert result is not RingBuffer._sentinel

def test_iteration_order():
    r = RingBuffer(4)
    for x in [10, 20, 30, 40, 50]:  # 50 overwrites 10
        r.push(x)
    items = list(r)
    assert items == [20, 30, 40, 50], f"got {items}"

def test_len():
    r = RingBuffer(5)
    assert len(r) == 0
    r.push(1)
    r.push(2)
    assert len(r) == 2
    r.push(3)
    r.push(4)
    r.push(5)
    assert len(r) == 5
    r.push(6)  # overwrite
    assert len(r) == 5

def test_pop_empty_raises():
    r = RingBuffer(3)
    try:
        r.pop()
        assert False, "should raise IndexError"
    except IndexError:
        pass

def test_clear():
    r = RingBuffer(3)
    r.push(1)
    r.push(2)
    r.clear()
    assert r.is_empty
    assert len(r) == 0

def test_wrap_method_exists():
    r = RingBuffer(5)
    assert r._wrap(7) == 2
    assert r._wrap(5) == 0
    assert r._wrap(0) == 0

def test_capacity_validation():
    try:
        RingBuffer(0)
        assert False, "should raise ValueError"
    except ValueError:
        pass
    try:
        RingBuffer(-1)
        assert False, "should raise ValueError"
    except ValueError:
        pass

def test_sentinel_is_unique():
    assert RingBuffer._sentinel is not None
    assert RingBuffer._sentinel is not False
    assert RingBuffer._sentinel is not 0

def test_repr():
    r = RingBuffer(3)
    r.push("a")
    r.push("b")
    s = repr(r)
    assert "RingBuffer" in s
    assert "a" in s and "b" in s

if __name__ == "__main__":
    test_basic_push_pop()
    test_overwrite_oldest()
    test_is_full_and_is_empty()
    test_peek_empty_returns_sentinel()
    test_peek_with_none_value()
    test_iteration_order()
    test_len()
    test_pop_empty_raises()
    test_clear()
    test_wrap_method_exists()
    test_capacity_validation()
    test_sentinel_is_unique()
    test_repr()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(format!(
            "The ring buffer in {} looks like it has dead code and overly complex \
             methods. Refactor it:\n\
             - Inline trivial helper methods that aren't pulling their weight.\n\
             - Remove dead code and unused attributes.\n\
             - Simplify the iteration logic.\n\
             - Consolidate redundant properties.\n\n\
             Step 1: Read the code carefully and identify what to simplify.\n\
             Step 2: Apply your refactoring changes.\n\
             Step 3: Run `python3 test_ring_buffer.py` to verify nothing is broken. \
             If tests fail, revert and reconsider — some things that look dead may \
             actually be needed.",
            ring_file)),
            vec![
                complete(),
                succeeded("shell"),
                // Primary: tests must pass — the suite directly calls _wrap,
                // _sentinel, is_full, is_empty, __iter__, and exercises all
                // ring buffer operations. Any semantic change fails a test.
                run_has("python3 test_ring_buffer.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![ring_file]),
            vec![test_file])
    }
    v.push(scen!("v2_refactor_02_already_optimal", Category::Refactor, Difficulty::Hard, I, setup));
}
