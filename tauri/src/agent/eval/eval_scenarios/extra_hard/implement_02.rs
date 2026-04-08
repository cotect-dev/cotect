//! Implement v2 — Test 02: Add serialization to existing task manager
//!
//! A multi-file task manager with `Task` and `TaskBoard` classes. The
//! existing code handles creating, updating, and completing tasks. The
//! model must implement `save()` and `load()` methods that serialize
//! the board to JSON and restore it, preserving all state including
//! task history and timestamps.
//!
//! The model must:
//! 1. Implement `TaskBoard.save(path)` that writes board state to JSON
//! 2. Implement `TaskBoard.load(path)` classmethod that restores a board
//! 3. Handle datetime serialization (existing code uses datetime objects)
//! 4. Preserve the `_history` log entries during round-trip
//! 5. Match existing patterns (Task from_dict/to_dict, board structure)
//!
//! Existing patterns to follow:
//! - Task already has `to_dict()` — model must use it (not reinvent)
//! - Task has a `from_dict()` classmethod stub — model must implement it
//! - The board stores metadata (title, created_at) that must be preserved
//!
//! Hidden test coverage:
//! - Round-trip fidelity (save then load, all data matches)
//! - Multiple save/load cycles don't corrupt data
//! - Loading from a non-existent path raises FileNotFoundError
//! - Task status transitions preserved through serialization

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let task_file = ap(dir, "task.py");
        std::fs::write(&task_file, r#"from datetime import datetime


class Task:
    """A single task with status tracking and history."""

    STATUSES = ("todo", "in_progress", "done", "archived")

    def __init__(self, title: str, description: str = "",
                 priority: int = 0, tags: list[str] | None = None):
        self.id: int = 0
        self.title = title
        self.description = description
        self.priority = priority
        self.tags = tags or []
        self.status = "todo"
        self.created_at = datetime.now()
        self.updated_at = self.created_at

    def set_status(self, new_status: str) -> None:
        """Transition to a new status."""
        if new_status not in self.STATUSES:
            raise ValueError(f"Invalid status: {new_status}")
        self.status = new_status
        self.updated_at = datetime.now()

    def to_dict(self) -> dict:
        """Serialize task to a dictionary."""
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "priority": self.priority,
            "tags": list(self.tags),
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Task":
        """Deserialize a task from a dictionary.

        Must restore all fields including id, status, and timestamps.
        """
        # TODO: implement this method
        raise NotImplementedError("from_dict not yet implemented")

    def __repr__(self):
        return f"Task({self.id}: {self.title!r} [{self.status}])"
"#).unwrap();

        let board_file = ap(dir, "board.py");
        std::fs::write(&board_file, r#"from datetime import datetime
from task import Task


class TaskBoard:
    """A board that organizes tasks with history tracking."""

    def __init__(self, title: str):
        self.title = title
        self.created_at = datetime.now()
        self._tasks: dict[int, Task] = {}
        self._next_id = 1
        self._history: list[dict] = []

    def add_task(self, task: Task) -> int:
        """Add a task to the board, assign it an ID, and return the ID."""
        task.id = self._next_id
        self._next_id += 1
        self._tasks[task.id] = task
        self._record("added", task.id, task.title)
        return task.id

    def get_task(self, task_id: int) -> Task | None:
        """Get a task by ID."""
        return self._tasks.get(task_id)

    def update_status(self, task_id: int, new_status: str) -> None:
        """Update a task's status."""
        task = self._tasks.get(task_id)
        if task is None:
            raise KeyError(f"No task with id {task_id}")
        old_status = task.status
        task.set_status(new_status)
        self._record("status_changed", task_id,
                      f"{old_status} -> {new_status}")

    def list_tasks(self, status: str | None = None) -> list[Task]:
        """List tasks, optionally filtered by status."""
        tasks = sorted(self._tasks.values(), key=lambda t: t.id)
        if status is not None:
            tasks = [t for t in tasks if t.status == status]
        return tasks

    def history(self) -> list[dict]:
        """Return a copy of the history log."""
        return list(self._history)

    def stats(self) -> dict:
        """Return task count by status."""
        counts = {}
        for task in self._tasks.values():
            counts[task.status] = counts.get(task.status, 0) + 1
        return counts

    def _record(self, action: str, task_id: int, detail: str) -> None:
        """Record an action in the history log."""
        self._history.append({
            "action": action,
            "task_id": task_id,
            "detail": detail,
            "timestamp": datetime.now().isoformat(),
        })

    # TODO: implement save(self, path: str) -> None
    # Serialize the entire board to a JSON file at the given path.
    # Must include: title, created_at, all tasks, history, and _next_id.
    # Use Task.to_dict() for task serialization.

    # TODO: implement load(cls, path: str) -> "TaskBoard" as a @classmethod
    # Deserialize a board from a JSON file.
    # Must restore all state so the board is fully functional
    # (adding new tasks should continue from the correct ID, etc.)
    # Use Task.from_dict() to restore tasks.
    # Should raise FileNotFoundError if path doesn't exist.
"#).unwrap();

        let test_file = ap(dir, "test_board.py");
        std::fs::write(&test_file, r#"import os
import json
import tempfile
from datetime import datetime
from task import Task
from board import TaskBoard


def _make_board():
    board = TaskBoard("Sprint 1")
    t1 = Task("Design API", "Create REST API design", priority=3, tags=["backend"])
    t2 = Task("Write tests", "Unit tests for auth module", priority=2, tags=["testing"])
    t3 = Task("Fix login bug", priority=5, tags=["bug", "urgent"])
    board.add_task(t1)
    board.add_task(t2)
    board.add_task(t3)
    board.update_status(1, "in_progress")
    board.update_status(1, "done")
    board.update_status(2, "in_progress")
    return board


def test_save_creates_file():
    board = _make_board()
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "board.json")
        board.save(path)
        assert os.path.exists(path), "save() should create the file"


def test_save_produces_valid_json():
    board = _make_board()
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "board.json")
        board.save(path)
        with open(path) as f:
            data = json.load(f)
        assert "title" in data, f"JSON should have 'title', got keys: {list(data.keys())}"
        assert data["title"] == "Sprint 1"


def test_roundtrip_preserves_tasks():
    board = _make_board()
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "board.json")
        board.save(path)
        loaded = TaskBoard.load(path)

        assert len(loaded.list_tasks()) == 3, \
            f"should have 3 tasks, got {len(loaded.list_tasks())}"

        t1 = loaded.get_task(1)
        assert t1 is not None
        assert t1.title == "Design API"
        assert t1.status == "done"
        assert t1.priority == 3
        assert t1.tags == ["backend"]

        t2 = loaded.get_task(2)
        assert t2 is not None
        assert t2.status == "in_progress"

        t3 = loaded.get_task(3)
        assert t3 is not None
        assert t3.title == "Fix login bug"
        assert t3.tags == ["bug", "urgent"]


def test_roundtrip_preserves_timestamps():
    board = _make_board()
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "board.json")
        board.save(path)
        loaded = TaskBoard.load(path)

        t1_orig = board.get_task(1)
        t1_loaded = loaded.get_task(1)
        assert isinstance(t1_loaded.created_at, datetime), \
            f"created_at should be datetime, got {type(t1_loaded.created_at)}"
        assert t1_loaded.created_at.year == t1_orig.created_at.year
        assert t1_loaded.created_at.month == t1_orig.created_at.month


def test_roundtrip_preserves_board_metadata():
    board = _make_board()
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "board.json")
        board.save(path)
        loaded = TaskBoard.load(path)

        assert loaded.title == "Sprint 1"
        assert isinstance(loaded.created_at, datetime), \
            f"board created_at should be datetime, got {type(loaded.created_at)}"


def test_roundtrip_preserves_history():
    board = _make_board()
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "board.json")
        board.save(path)
        loaded = TaskBoard.load(path)

        orig_hist = board.history()
        loaded_hist = loaded.history()
        assert len(loaded_hist) == len(orig_hist), \
            f"history length mismatch: {len(loaded_hist)} vs {len(orig_hist)}"
        assert loaded_hist[0]["action"] == "added"


def test_loaded_board_can_add_tasks():
    board = _make_board()
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "board.json")
        board.save(path)
        loaded = TaskBoard.load(path)

        new_task = Task("New feature", priority=1)
        new_id = loaded.add_task(new_task)
        assert new_id == 4, \
            f"next task ID should be 4 (continuing from 3), got {new_id}"


def test_loaded_board_can_update_status():
    board = _make_board()
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "board.json")
        board.save(path)
        loaded = TaskBoard.load(path)

        loaded.update_status(3, "done")
        t3 = loaded.get_task(3)
        assert t3.status == "done"


def test_double_roundtrip():
    board = _make_board()
    with tempfile.TemporaryDirectory() as tmpdir:
        p1 = os.path.join(tmpdir, "b1.json")
        board.save(p1)
        loaded1 = TaskBoard.load(p1)

        loaded1.add_task(Task("Extra task"))
        p2 = os.path.join(tmpdir, "b2.json")
        loaded1.save(p2)
        loaded2 = TaskBoard.load(p2)

        assert len(loaded2.list_tasks()) == 4
        assert loaded2.get_task(4).title == "Extra task"


def test_load_nonexistent_raises():
    try:
        TaskBoard.load("/tmp/nonexistent_board_file_12345.json")
        assert False, "should raise FileNotFoundError"
    except FileNotFoundError:
        pass


def test_stats_after_load():
    board = _make_board()
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "board.json")
        board.save(path)
        loaded = TaskBoard.load(path)

        stats = loaded.stats()
        assert stats.get("done") == 1, f"expected 1 done, got {stats}"
        assert stats.get("in_progress") == 1, f"expected 1 in_progress, got {stats}"
        assert stats.get("todo") == 1, f"expected 1 todo, got {stats}"


def test_task_from_dict_standalone():
    t = Task("Test task", "desc", priority=7, tags=["a", "b"])
    t.id = 42
    t.set_status("in_progress")
    d = t.to_dict()
    restored = Task.from_dict(d)
    assert restored.id == 42
    assert restored.title == "Test task"
    assert restored.description == "desc"
    assert restored.priority == 7
    assert restored.tags == ["a", "b"]
    assert restored.status == "in_progress"


if __name__ == "__main__":
    test_save_creates_file()
    test_save_produces_valid_json()
    test_roundtrip_preserves_tasks()
    test_roundtrip_preserves_timestamps()
    test_roundtrip_preserves_board_metadata()
    test_roundtrip_preserves_history()
    test_loaded_board_can_add_tasks()
    test_loaded_board_can_update_status()
    test_double_roundtrip()
    test_load_nonexistent_raises()
    test_stats_after_load()
    test_task_from_dict_standalone()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(format!(
            "The task manager in {} and {} needs persistence. Implement the \
             `Task.from_dict()` classmethod and the `TaskBoard.save()` and \
             `TaskBoard.load()` methods so that boards can be saved to JSON \
             files and fully restored.\n\n\
             Step 1: Read both files and understand the existing patterns, \
             then implement the methods WITHOUT running the code first.\n\
             Step 2: Run the existing `python3 test_board.py` to check your work.\n\
             Step 3: If any tests fail, read the error output, adjust your \
             implementation, and re-run until all tests pass.",
            task_file, board_file)),
            vec![
                complete(),
                succeeded("shell"),
                run_has("python3 test_board.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![task_file, board_file]),
            vec![test_file])
    }
    v.push(scen!("xhard_implement_02_task_serialization", Category::Implement, Difficulty::Hard, I, setup));
}
