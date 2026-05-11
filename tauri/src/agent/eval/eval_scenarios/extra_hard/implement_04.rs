//! Implement v2 — Test 04: Add observer/event system to state manager
//!
//! A 2-file state management system with `StateStore` (key-value store
//! with history) and `computed.py` (derived/computed values). The model
//! must implement an observer pattern so external callbacks are notified
//! when state changes.
//!
//! The model must:
//! 1. Implement `subscribe()` / `unsubscribe()` on StateStore
//! 2. Implement `notify()` that calls registered callbacks on changes
//! 3. Wire notifications into existing `set()`, `delete()`, and `reset()` methods
//! 4. Support both key-specific and wildcard ("*") subscriptions
//! 5. Implement `ComputedValue` class in computed.py that auto-updates
//!
//! Existing patterns to follow:
//! - StateStore uses `_history` list for change tracking
//! - All public methods return/modify copies of data
//! - `_record_change()` is the central mutation hook
//!
//! Hidden test coverage:
//! - Callbacks receive correct event type, key, old_value, new_value
//! - Wildcard subscriptions fire for all keys
//! - Unsubscribe prevents future notifications
//! - ComputedValue stays in sync with store changes
//! - Callbacks for delete events

use std::path::Path;

use super::*;
use crate::agent::types::AgentRole::Implement as I;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let store_file = ap(dir, "store.py");
        std::fs::write(
            &store_file,
            r#"class StateStore:
    """Key-value state store with change history."""

    def __init__(self, initial: dict | None = None):
        self._state: dict = dict(initial) if initial else {}
        self._history: list[dict] = []

    def get(self, key: str, default=None):
        """Get a value by key."""
        return self._state.get(key, default)

    def set(self, key: str, value) -> None:
        """Set a key-value pair."""
        old_value = self._state.get(key)
        self._state[key] = value
        self._record_change("set", key, old_value, value)

    def delete(self, key: str) -> bool:
        """Delete a key. Returns True if it existed."""
        if key not in self._state:
            return False
        old_value = self._state.pop(key)
        self._record_change("delete", key, old_value, None)
        return True

    def has(self, key: str) -> bool:
        """Check if a key exists."""
        return key in self._state

    def keys(self) -> list[str]:
        """Return sorted list of all keys."""
        return sorted(self._state.keys())

    def reset(self) -> None:
        """Clear all state."""
        old_state = dict(self._state)
        self._state.clear()
        for key, value in old_state.items():
            self._record_change("delete", key, value, None)

    def snapshot(self) -> dict:
        """Return a copy of the current state."""
        return dict(self._state)

    def history(self) -> list[dict]:
        """Return a copy of the change history."""
        return list(self._history)

    def _record_change(self, action: str, key: str, old_value, new_value) -> None:
        """Record a state change in history."""
        self._history.append({
            "action": action,
            "key": key,
            "old_value": old_value,
            "new_value": new_value,
        })

    # TODO: implement subscribe(self, key_or_wildcard: str, callback) -> int
    # Register a callback. Returns an integer subscription id that is unique
    # across all live subscriptions on this store.
    # When a key changes via set(), delete(), or reset(), every subscription
    # whose key_or_wildcard equals the changed key OR equals "*" must have
    # its callback invoked once with a single event argument — a dict
    # containing keys "action", "key", "old_value", "new_value" describing
    # the change. The "action" is "set" for set() and "delete" for delete()
    # and reset(). Subscriptions for unrelated keys must not fire.

    # TODO: implement unsubscribe(self, sub_id: int) -> bool
    # Remove the subscription with the given id. Returns True if a
    # subscription with that id existed, False otherwise. After removal,
    # the callback must not be invoked by subsequent state changes.
"#,
        )
        .unwrap();

        let computed_file = ap(dir, "computed.py");
        std::fs::write(
            &computed_file,
            r#"from store import StateStore


class ComputedValue:
    """A value derived from one or more store keys that auto-updates.

    Example usage:
        store = StateStore({"width": 10, "height": 5})
        area = ComputedValue(store, ["width", "height"], lambda w, h: w * h)
        area.value  # => 50
        store.set("width", 20)
        area.value  # => 100  (auto-updated)
    """

    # TODO: ComputedValue(store, keys, compute_fn)
    # Contract:
    # - Constructor takes a StateStore, a list of key names, and a function.
    # - The attribute `value` returns compute_fn(v0, v1, ...) where vi is
    #   the current value of keys[i] in the store (or None if absent).
    # - `value` reflects changes made to any of the watched keys, without
    #   the caller needing to trigger a refresh.
    # - dispose() detaches this ComputedValue from the store so later store
    #   changes no longer affect `value`.
    pass
"#,
        )
        .unwrap();

        let test_file = ap(dir, "test_observer.py");
        std::fs::write(
            &test_file,
            r#"from store import StateStore
from computed import ComputedValue


def test_subscribe_and_notify_on_set():
    store = StateStore()
    events = []
    store.subscribe("name", lambda e: events.append(e))

    store.set("name", "Alice")
    assert len(events) == 1, f"expected 1 event, got {len(events)}"
    assert events[0]["action"] == "set"
    assert events[0]["key"] == "name"
    assert events[0]["old_value"] is None
    assert events[0]["new_value"] == "Alice"


def test_subscribe_fires_on_update():
    store = StateStore({"x": 1})
    events = []
    store.subscribe("x", lambda e: events.append(e))

    store.set("x", 2)
    assert len(events) == 1
    assert events[0]["old_value"] == 1
    assert events[0]["new_value"] == 2


def test_subscribe_does_not_fire_for_other_keys():
    store = StateStore()
    events = []
    store.subscribe("x", lambda e: events.append(e))

    store.set("y", 100)
    assert len(events) == 0, f"should not fire for key 'y', got {len(events)}"


def test_wildcard_subscription():
    store = StateStore()
    events = []
    store.subscribe("*", lambda e: events.append(e))

    store.set("a", 1)
    store.set("b", 2)
    store.delete("a")

    assert len(events) == 3, f"wildcard should catch all 3, got {len(events)}"
    assert events[0]["key"] == "a"
    assert events[1]["key"] == "b"
    assert events[2]["action"] == "delete"


def test_unsubscribe():
    store = StateStore()
    events = []
    sub_id = store.subscribe("x", lambda e: events.append(e))

    store.set("x", 1)
    assert len(events) == 1

    result = store.unsubscribe(sub_id)
    assert result is True, "unsubscribe should return True"

    store.set("x", 2)
    assert len(events) == 1, \
        f"after unsubscribe, should not fire, got {len(events)}"


def test_unsubscribe_invalid_id():
    store = StateStore()
    result = store.unsubscribe(999)
    assert result is False


def test_subscribe_returns_unique_ids():
    store = StateStore()
    id1 = store.subscribe("a", lambda e: None)
    id2 = store.subscribe("b", lambda e: None)
    id3 = store.subscribe("a", lambda e: None)
    assert len({id1, id2, id3}) == 3, \
        f"subscription IDs should be unique: {id1}, {id2}, {id3}"


def test_multiple_subscribers_same_key():
    store = StateStore()
    events_a = []
    events_b = []
    store.subscribe("x", lambda e: events_a.append(e))
    store.subscribe("x", lambda e: events_b.append(e))

    store.set("x", 42)
    assert len(events_a) == 1
    assert len(events_b) == 1


def test_delete_notifies():
    store = StateStore({"x": 10})
    events = []
    store.subscribe("x", lambda e: events.append(e))

    store.delete("x")
    assert len(events) == 1
    assert events[0]["action"] == "delete"
    assert events[0]["old_value"] == 10
    assert events[0]["new_value"] is None


def test_reset_notifies_all():
    store = StateStore({"a": 1, "b": 2, "c": 3})
    events = []
    store.subscribe("*", lambda e: events.append(e))

    store.reset()
    assert len(events) == 3, f"reset should notify for each key, got {len(events)}"
    keys = {e["key"] for e in events}
    assert keys == {"a", "b", "c"}


def test_history_still_works():
    store = StateStore()
    store.set("x", 1)
    store.set("x", 2)
    store.delete("x")
    hist = store.history()
    assert len(hist) == 3


def test_computed_value_initial():
    store = StateStore({"width": 10, "height": 5})
    area = ComputedValue(store, ["width", "height"], lambda w, h: w * h)
    assert area.value == 50, f"expected 50, got {area.value}"


def test_computed_value_updates_on_change():
    store = StateStore({"width": 10, "height": 5})
    area = ComputedValue(store, ["width", "height"], lambda w, h: w * h)

    store.set("width", 20)
    assert area.value == 100, f"expected 100 after width change, got {area.value}"

    store.set("height", 10)
    assert area.value == 200, f"expected 200 after height change, got {area.value}"


def test_computed_value_with_missing_key():
    store = StateStore({"x": 5})
    cv = ComputedValue(store, ["x", "y"], lambda x, y: (x or 0) + (y or 0))
    assert cv.value == 5, f"missing key should pass None, got {cv.value}"


def test_computed_value_dispose():
    store = StateStore({"x": 1})
    cv = ComputedValue(store, ["x"], lambda x: x * 10)
    assert cv.value == 10

    cv.dispose()
    store.set("x", 5)
    assert cv.value == 10, \
        f"after dispose, value should not update, got {cv.value}"


def test_computed_single_key():
    store = StateStore({"count": 0})
    doubled = ComputedValue(store, ["count"], lambda c: c * 2)
    assert doubled.value == 0

    store.set("count", 7)
    assert doubled.value == 14


if __name__ == "__main__":
    test_subscribe_and_notify_on_set()
    test_subscribe_fires_on_update()
    test_subscribe_does_not_fire_for_other_keys()
    test_wildcard_subscription()
    test_unsubscribe()
    test_unsubscribe_invalid_id()
    test_subscribe_returns_unique_ids()
    test_multiple_subscribers_same_key()
    test_delete_notifies()
    test_reset_notifies_all()
    test_history_still_works()
    test_computed_value_initial()
    test_computed_value_updates_on_change()
    test_computed_value_with_missing_key()
    test_computed_value_dispose()
    test_computed_single_key()
    print("ALL_TESTS_PASSED")
"#,
        )
        .unwrap();

        with_blocked(
            with_scope(
                with_checks(
                    pf(format!(
                        "Implement the subscription API on `StateStore` in {} and the \
             `ComputedValue` class in {} according to the contracts in the \
             TODO comments. The store must notify subscribers whenever a \
             key changes through any public mutation (set, delete, reset), \
             and ComputedValue must expose a `value` that always reflects \
             the latest relevant store state until `dispose()` is called.\n\n\
             Verify with `python3 test_observer.py`.",
                        store_file, computed_file
                    )),
                    vec![
                        complete(),
                        succeeded("shell"),
                        run_has("python3 test_observer.py", &["ALL_TESTS_PASSED"]),
                    ],
                ),
                vec![store_file, computed_file],
            ),
            vec![test_file],
        )
    }
    v.push(scen!(
        "xhard_implement_04_observer_pattern",
        Category::Implement,
        Difficulty::Hard,
        I,
        setup
    ));
}
