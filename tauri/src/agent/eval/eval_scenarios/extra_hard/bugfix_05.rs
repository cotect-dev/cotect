//! Bugfix v2 — Test 05: Diabolical (3+ files, cascading interacting bugs)
//!
//! An event-sourcing system across 4 files with three interacting bugs.
//! Fixing one reveals the next — each is invisible until the previous is resolved.
//!
//! Files:
//! - event_store.py: stores events with sequence numbers
//! - projector.py: rebuilds state from events
//! - snapshot.py: serializes state snapshots
//! - system.py: orchestrator (contains red herrings but no bugs)
//!
//! Bug chain:
//!
//! Bug 1 (event_store.py): `_seq` is a CLASS variable incremented with `+=`.
//!   All EventStore instances share it. When a test creates a fresh store,
//!   sequences continue from where the previous store left off instead of
//!   starting at 0. This causes the projector to miss events if it filters
//!   by sequence range.
//!
//! Bug 2 (projector.py): The dedup logic skips events whose timestamp
//!   matches a previously seen timestamp. But legitimate events CAN share
//!   timestamps (sub-millisecond). This incorrectly drops valid events.
//!   Only visible after Bug 1 is fixed because the broken sequence numbers
//!   previously caused events to be skipped before the dedup check.
//!
//! Bug 3 (snapshot.py): Custom JSON encoder checks `isinstance(obj, date)`
//!   but imports `date` from `datetime`, not `datetime` itself. Python's
//!   `datetime` IS a subclass of `date`, so this does match — but the
//!   encoder formats it as a date (no time component), losing the time
//!   portion. The snapshot round-trip then deserializes to `date` objects
//!   instead of `datetime`, causing type mismatches downstream.
//!   Only visible after Bug 2 is fixed because without correct event
//!   replay, timestamps never make it into the projected state.
//!
//! Red herrings in system.py:
//! - A bare except in a retry loop (looks bad, but is fine for this use case)
//! - A comment about a "known race condition" that doesn't actually exist
//! - An unused import of `threading` that suggests concurrency issues

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let store_file = ap(dir, "event_store.py");
        std::fs::write(&store_file, r#"from datetime import datetime

class EventStore:
    """Append-only event store with sequence numbering."""

    _seq = 0

    def __init__(self):
        self._events = []

    def append(self, event_type: str, data: dict) -> dict:
        """Append an event and return it with metadata."""
        event = {
            "seq": EventStore._seq,
            "type": event_type,
            "data": data,
            "timestamp": datetime.now(),
        }
        EventStore._seq += 1
        self._events.append(event)
        return event

    def get_events(self, after_seq: int = -1) -> list[dict]:
        """Return events with sequence number > after_seq."""
        return [e for e in self._events if e["seq"] > after_seq]

    def get_all(self) -> list[dict]:
        return list(self._events)

    def count(self) -> int:
        return len(self._events)

    @property
    def last_seq(self) -> int:
        if not self._events:
            return -1
        return self._events[-1]["seq"]
"#).unwrap();

        let projector_file = ap(dir, "projector.py");
        std::fs::write(&projector_file, r#""""Event projector — rebuilds current state from events."""

class Projector:
    """Projects an event stream into a materialized state dict."""

    def __init__(self):
        self._state = {}
        self._seen_timestamps = set()
        self._applied_count = 0

    def apply(self, event: dict) -> None:
        """Apply a single event to the projected state."""
        ts = event["timestamp"]

        # Dedup by timestamp to prevent replaying the same event
        # twice during recovery.
        if ts in self._seen_timestamps:
            return  # skip duplicate
        self._seen_timestamps.add(ts)

        etype = event["type"]
        data = event["data"]

        if etype == "account_created":
            acct_id = data["account_id"]
            self._state[acct_id] = {
                "balance": data.get("initial_balance", 0),
                "name": data["name"],
                "created_at": ts,
                "last_updated": ts,
                "tx_count": 0,
            }
        elif etype == "deposit":
            acct_id = data["account_id"]
            if acct_id in self._state:
                self._state[acct_id]["balance"] += data["amount"]
                self._state[acct_id]["last_updated"] = ts
                self._state[acct_id]["tx_count"] += 1
        elif etype == "withdrawal":
            acct_id = data["account_id"]
            if acct_id in self._state:
                self._state[acct_id]["balance"] -= data["amount"]
                self._state[acct_id]["last_updated"] = ts
                self._state[acct_id]["tx_count"] += 1
        elif etype == "name_changed":
            acct_id = data["account_id"]
            if acct_id in self._state:
                self._state[acct_id]["name"] = data["new_name"]
                self._state[acct_id]["last_updated"] = ts

        self._applied_count += 1

    def rebuild(self, events: list[dict]) -> dict:
        """Apply all events and return the projected state."""
        self._state = {}
        self._seen_timestamps = set()
        self._applied_count = 0
        for event in events:
            self.apply(event)
        return dict(self._state)

    @property
    def state(self) -> dict:
        return dict(self._state)

    @property
    def applied_count(self) -> int:
        return self._applied_count
"#).unwrap();

        let snapshot_file = ap(dir, "snapshot.py");
        std::fs::write(&snapshot_file, r#"import json
from datetime import date, datetime

class StateEncoder(json.JSONEncoder):
    """Custom encoder that handles date/datetime objects."""

    def default(self, obj):
        if isinstance(obj, date):
            return {"__date__": True, "value": obj.isoformat()}
        return super().default(obj)


class StateDecoder(json.JSONDecoder):
    """Custom decoder that restores date objects."""

    def __init__(self):
        super().__init__(object_hook=self._hook)

    def _hook(self, obj):
        if "__date__" in obj:
            return date.fromisoformat(obj["value"].split("T")[0])
        return obj


def save_snapshot(state: dict, path: str) -> None:
    """Serialize state to a JSON file."""
    with open(path, 'w') as f:
        json.dump(state, f, cls=StateEncoder, indent=2)


def load_snapshot(path: str) -> dict:
    """Deserialize state from a JSON file."""
    with open(path, 'r') as f:
        return json.load(f, cls=StateDecoder)
"#).unwrap();

        let system_file = ap(dir, "system.py");
        std::fs::write(&system_file, r#"import threading
import os
from event_store import EventStore
from projector import Projector
from snapshot import save_snapshot, load_snapshot


class EventSourcedSystem:
    """Orchestrates event store, projector, and snapshots.

    KNOWN ISSUE: there's a theoretical race condition if two threads
    call process_command simultaneously. In practice this is single-threaded
    so it doesn't matter.
    """

    def __init__(self, snapshot_dir: str):
        self.store = EventStore()
        self.projector = Projector()
        self.snapshot_dir = snapshot_dir
        os.makedirs(snapshot_dir, exist_ok=True)

    def process_command(self, event_type: str, data: dict) -> dict:
        """Append event and update projection."""
        event = self.store.append(event_type, data)
        self.projector.apply(event)
        return event

    def rebuild_state(self) -> dict:
        """Rebuild state from all events."""
        events = self.store.get_all()
        return self.projector.rebuild(events)

    def save(self) -> str:
        """Save current projected state to a snapshot file."""
        path = os.path.join(self.snapshot_dir, "snapshot.json")
        state = self.projector.state
        # Retry with resilience to transient disk errors
        for attempt in range(3):
            try:
                save_snapshot(state, path)
                return path
            except:
                if attempt == 2:
                    raise
        return path  # unreachable but satisfies type checker

    def load(self, path: str) -> dict:
        """Load state from a snapshot, replacing current projection."""
        return load_snapshot(path)

    def get_account(self, account_id: str) -> dict | None:
        """Get current state of a single account."""
        return self.projector.state.get(account_id)
"#).unwrap();

        let test_file = ap(dir, "test_system.py");
        std::fs::write(&test_file, r#"import os
import tempfile
from datetime import datetime
from event_store import EventStore
from projector import Projector
from snapshot import save_snapshot, load_snapshot
from system import EventSourcedSystem


def test_fresh_store_sequences_start_at_zero():
    """Each new EventStore should start sequences from 0."""
    store1 = EventStore()
    store1.append("test", {"x": 1})
    store1.append("test", {"x": 2})
    assert store1.last_seq == 1, f"store1 last_seq should be 1, got {store1.last_seq}"

    store2 = EventStore()
    store2.append("test", {"y": 1})
    # A fresh store should start at seq 0, not continue from store1
    assert store2.last_seq == 0, \
        f"Fresh store should start at seq 0, got {store2.last_seq}"


def test_same_timestamp_events_not_dropped():
    """Two events with the same timestamp should both be applied."""
    projector = Projector()
    now = datetime(2024, 6, 15, 10, 30, 0)

    events = [
        {"seq": 0, "type": "account_created", "timestamp": now,
         "data": {"account_id": "A1", "name": "Alice", "initial_balance": 100}},
        {"seq": 1, "type": "deposit", "timestamp": now,
         "data": {"account_id": "A1", "amount": 50}},
    ]
    state = projector.rebuild(events)
    assert "A1" in state, "Account A1 should exist"
    assert state["A1"]["balance"] == 150, \
        f"Balance should be 150 (100 + 50), got {state['A1']['balance']}"
    assert projector.applied_count == 2, \
        f"Both events should be applied, but only {projector.applied_count} were"


def test_snapshot_roundtrip_preserves_datetimes():
    """Snapshot save/load should preserve datetime objects with time component."""
    with tempfile.TemporaryDirectory() as tmpdir:
        original_state = {
            "A1": {
                "balance": 200,
                "name": "Alice",
                "created_at": datetime(2024, 3, 15, 14, 30, 45),
                "last_updated": datetime(2024, 6, 20, 9, 15, 0),
                "tx_count": 5,
            }
        }
        path = os.path.join(tmpdir, "snap.json")
        save_snapshot(original_state, path)
        loaded = load_snapshot(path)

        assert "A1" in loaded
        created = loaded["A1"]["created_at"]
        assert isinstance(created, datetime), \
            f"created_at should be datetime, got {type(created).__name__}: {created}"
        assert created.hour == 14, \
            f"created_at should preserve hour=14, got {created}"
        assert created.minute == 30, \
            f"created_at should preserve minute=30, got {created}"


def test_full_system_integration():
    """End-to-end: create accounts, transact, snapshot, and reload."""
    with tempfile.TemporaryDirectory() as tmpdir:
        sys = EventSourcedSystem(tmpdir)

        # Create two accounts
        sys.process_command("account_created",
            {"account_id": "ACC1", "name": "Alice", "initial_balance": 1000})
        sys.process_command("account_created",
            {"account_id": "ACC2", "name": "Bob", "initial_balance": 500})

        # Transactions
        sys.process_command("deposit", {"account_id": "ACC1", "amount": 250})
        sys.process_command("withdrawal", {"account_id": "ACC2", "amount": 100})
        sys.process_command("deposit", {"account_id": "ACC2", "amount": 50})

        # Verify projector state
        acc1 = sys.get_account("ACC1")
        assert acc1 is not None
        assert acc1["balance"] == 1250, f"ACC1 balance should be 1250, got {acc1['balance']}"
        assert acc1["tx_count"] == 1

        acc2 = sys.get_account("ACC2")
        assert acc2 is not None
        assert acc2["balance"] == 450, f"ACC2 balance should be 450, got {acc2['balance']}"
        assert acc2["tx_count"] == 2

        # Snapshot round-trip
        snap_path = sys.save()
        loaded = sys.load(snap_path)
        assert loaded["ACC1"]["balance"] == 1250
        assert loaded["ACC2"]["balance"] == 450
        assert isinstance(loaded["ACC1"]["created_at"], datetime), \
            f"Snapshot should preserve datetime, got {type(loaded['ACC1']['created_at'])}"

        # Rebuild from events should match
        rebuilt = sys.rebuild_state()
        assert rebuilt["ACC1"]["balance"] == 1250
        assert rebuilt["ACC2"]["balance"] == 450


def test_independent_stores():
    """Two independent systems should not interfere with each other."""
    with tempfile.TemporaryDirectory() as tmpdir:
        sys1 = EventSourcedSystem(os.path.join(tmpdir, "s1"))
        sys2 = EventSourcedSystem(os.path.join(tmpdir, "s2"))

        sys1.process_command("account_created",
            {"account_id": "X1", "name": "Sys1Account", "initial_balance": 100})
        sys2.process_command("account_created",
            {"account_id": "Y1", "name": "Sys2Account", "initial_balance": 200})

        # sys2's first event should be seq 0
        assert sys2.store.last_seq == 0, \
            f"sys2 should start at seq 0, got {sys2.store.last_seq}"

        # Rebuild each independently
        state1 = sys1.rebuild_state()
        state2 = sys2.rebuild_state()
        assert "X1" in state1 and "Y1" not in state1
        assert "Y1" in state2 and "X1" not in state2
        assert state1["X1"]["balance"] == 100
        assert state2["Y1"]["balance"] == 200


if __name__ == "__main__":
    test_fresh_store_sequences_start_at_zero()
    test_same_timestamp_events_not_dropped()
    test_snapshot_roundtrip_preserves_datetimes()
    test_full_system_integration()
    test_independent_stores()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(
            "The event-sourcing system has subtle bugs that surface under specific \
             conditions. The bugs interact — you may need to fix one to see the \
             next clearly.\n\n\
             Step 1: Read all source files (event_store.py, projector.py, \
             snapshot.py, system.py). Identify every bug and apply all your \
             fixes WITHOUT running the code first.\n\
             Step 2: Run the existing `python3 test_system.py` to check your work.\n\
             Step 3: If any tests fail, read the error output, adjust your \
             fixes, and re-run until all tests pass."
            .to_string()
        ),
            vec![
                complete(),
                succeeded("shell"),
                // Primary: all tests must pass — they cover independent store sequences,
                // same-timestamp event handling, datetime snapshot roundtrips,
                // full system integration, and store isolation.
                run_has("python3 test_system.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![store_file, projector_file, snapshot_file, system_file]),
            vec![test_file])
    }
    v.push(scen!("xhard_bugfix_05_diabolical_eventsource", Category::Bugfix, Difficulty::Hard, I, setup));
}
