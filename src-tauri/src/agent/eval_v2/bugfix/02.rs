//! Bugfix v2 — Test 02: Cross-file (bug NOT in the file the prompt points to)
//!
//! A task scheduling system across 3 files. The prompt says "the scheduler
//! in scheduler.py produces wrong task ordering." The scheduler itself is
//! correct. The real bug is in task.py where `__lt__` compares priorities
//! in the wrong direction, causing the heap to surface low-priority tasks
//! before high-priority ones.
//!
//! Red herrings:
//! - scheduler.py has a commented-out sort that looks suspicious but is just
//!   dead code from a previous implementation (correctly replaced by heapq)
//! - runner.py catches Exception broadly — looks bad but doesn't affect ordering
//! - task.py has a `validate()` method that seems to have an edge case but
//!   is actually correct
//!
//! The model must trace from scheduler.py into task.py to find the real bug.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let task_file = ap(dir, "task.py");
        std::fs::write(&task_file, r#"class Priority:
    """Priority levels — higher number = more urgent."""
    LOW = 1
    MEDIUM = 5
    HIGH = 10
    CRITICAL = 20


class Task:
    """A schedulable task with a priority and name."""

    def __init__(self, name: str, priority: int, payload: dict | None = None):
        self.name = name
        self.priority = priority
        self.payload = payload or {}
        self._completed = False

    def validate(self) -> bool:
        """Check that this task is well-formed."""
        if self.priority < 1:
            return False
        if not self.name or not self.name.strip():
            return False
        return True

    def __lt__(self, other):
        """Comparison for heapq ordering."""
        return self.priority < other.priority

    def __eq__(self, other):
        return isinstance(other, Task) and self.name == other.name

    def __repr__(self):
        return f"Task({self.name!r}, pri={self.priority})"

    def complete(self):
        self._completed = True

    @property
    def is_completed(self):
        return self._completed
"#).unwrap();

        let scheduler_file = ap(dir, "scheduler.py");
        std::fs::write(&scheduler_file, r#"import heapq
from task import Task

class Scheduler:
    """Priority-based task scheduler.

    Uses a heap to efficiently schedule the most urgent task next.
    """

    def __init__(self):
        self._queue = []
        self._counter = 0  # tie-breaker for equal priorities

    def add_task(self, task: Task) -> bool:
        """Add a task to the schedule. Returns False if invalid."""
        if not task.validate():
            return False
        # The counter ensures FIFO ordering among equal-priority tasks
        heapq.heappush(self._queue, (task, self._counter))
        self._counter += 1
        return True

    def next_task(self) -> Task | None:
        """Pop and return the highest-priority task, or None if empty."""
        if not self._queue:
            return None
        task, _ = heapq.heappop(self._queue)
        return task

    def peek(self) -> Task | None:
        """Return the highest-priority task without removing it."""
        if not self._queue:
            return None
        return self._queue[0][0]

    def pending_count(self) -> int:
        return len(self._queue)

    # --- OLD IMPLEMENTATION (replaced by heap) ---
    # def _sort_tasks(self):
    #     """Sort tasks by priority descending. No longer used."""
    #     self._tasks.sort(key=lambda t: t.priority, reverse=True)
"#).unwrap();

        let runner_file = ap(dir, "runner.py");
        std::fs::write(&runner_file, r#"from scheduler import Scheduler
from task import Task, Priority

class TaskRunner:
    """Executes tasks from a scheduler in priority order."""

    def __init__(self, scheduler: Scheduler):
        self.scheduler = scheduler
        self.results = []

    def run_all(self) -> list[str]:
        """Run all tasks and return their names in execution order."""
        while True:
            task = self.scheduler.next_task()
            if task is None:
                break
            try:
                # Record all tasks regardless of payload processing errors
                self._execute(task)
                self.results.append(task.name)
            except Exception:
                self.results.append(f"FAILED:{task.name}")
        return self.results

    def _execute(self, task: Task):
        """Simulate task execution."""
        task.complete()


def main():
    s = Scheduler()
    s.add_task(Task("send-email", Priority.LOW))
    s.add_task(Task("process-payment", Priority.CRITICAL))
    s.add_task(Task("update-cache", Priority.MEDIUM))
    s.add_task(Task("security-scan", Priority.HIGH))
    s.add_task(Task("log-cleanup", Priority.LOW))

    runner = TaskRunner(s)
    order = runner.run_all()
    # Expected: CRITICAL first, then HIGH, MEDIUM, LOWs last
    print(",".join(order))
"#).unwrap();

        let test_file = ap(dir, "verify_scheduling.py");
        std::fs::write(&test_file, r#"from scheduler import Scheduler
from task import Task, Priority
from runner import TaskRunner

def test_priority_ordering():
    """Tasks must be executed in priority order: CRITICAL > HIGH > MEDIUM > LOW."""
    s = Scheduler()
    s.add_task(Task("low-task", Priority.LOW))
    s.add_task(Task("critical-task", Priority.CRITICAL))
    s.add_task(Task("medium-task", Priority.MEDIUM))
    s.add_task(Task("high-task", Priority.HIGH))

    runner = TaskRunner(s)
    order = runner.run_all()
    assert order == ["critical-task", "high-task", "medium-task", "low-task"], \
        f"Wrong order: {order}"

def test_fifo_within_same_priority():
    """Tasks with equal priority should be executed in FIFO order."""
    s = Scheduler()
    s.add_task(Task("first", Priority.HIGH))
    s.add_task(Task("second", Priority.HIGH))
    s.add_task(Task("third", Priority.HIGH))

    runner = TaskRunner(s)
    order = runner.run_all()
    assert order == ["first", "second", "third"], \
        f"Expected FIFO within same priority, got: {order}"

def test_mixed_scenario():
    """Complex scenario with mixed priorities."""
    s = Scheduler()
    s.add_task(Task("email", Priority.LOW))
    s.add_task(Task("payment", Priority.CRITICAL))
    s.add_task(Task("cache", Priority.MEDIUM))
    s.add_task(Task("alert", Priority.CRITICAL))
    s.add_task(Task("backup", Priority.HIGH))

    runner = TaskRunner(s)
    order = runner.run_all()
    # Two CRITICAL tasks first (FIFO among them), then HIGH, MEDIUM, LOW
    assert order[0] == "payment", f"First should be payment, got {order[0]}"
    assert order[1] == "alert", f"Second should be alert, got {order[1]}"
    assert order[2] == "backup", f"Third should be backup, got {order[2]}"
    assert order[3] == "cache", f"Fourth should be cache, got {order[3]}"
    assert order[4] == "email", f"Fifth should be email, got {order[4]}"

if __name__ == "__main__":
    test_priority_ordering()
    test_fifo_within_same_priority()
    test_mixed_scenario()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        // Prompt points to scheduler.py — but the root cause is in task.py.
        // The model may fix either file: flipping __lt__ in task.py
        // or negating priority in scheduler.py's heappush. Both are valid.
        with_scope(with_checks(pf(format!(
            "The task scheduler in {} isn't ordering tasks correctly — \
             low-priority tasks like email sending are executed before \
             critical tasks like payment processing.\n\n\
             Step 1: Read the code and any related files to find the root cause.\n\
             Step 2: Apply your fix.\n\
             Step 3: Run `python3 verify_scheduling.py` to verify. If tests \
             fail, read the errors and iterate until they pass.",
            scheduler_file)),
            vec![
                complete(),
                succeeded("shell"),
                // Primary: the test suite must pass end-to-end
                run_has("python3 verify_scheduling.py", &["ALL_TESTS_PASSED"]),
            ]),
            // All three source files in scope. The prompt still points at
            // scheduler.py as the culprit — the model must trace into task.py
            // to find the real bug.
            vec![scheduler_file, runner_file, task_file])
    }
    v.push(scen!("v2_bugfix_02_cross_file_scheduler", Category::Bugfix, Difficulty::Hard, I, setup));
}
