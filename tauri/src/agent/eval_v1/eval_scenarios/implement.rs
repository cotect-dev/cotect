//! Implementation scenarios — write new code from a specification.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    // ── Medium ──────────────────────────────────────────────────────────

    fn s_iterator(dir: &Path) -> SetupResult {
        let p = ap(dir, "chunked.py");
        with_checks(pf(format!(
            "Create a Python file at {p} that implements:\n\
             1. A generator function `chunked(iterable, size)` that yields lists of `size` elements at a time\n\
             2. A generator function `sliding_window(iterable, size)` that yields overlapping windows\n\
             Include type hints and docstrings.")),
            vec![complete(),
                 file_has("chunked.py", &["def chunked", "def sliding_window", "yield"])])
    }
    v.push(scen!("impl_iterators", Category::Implement, Difficulty::Medium, I, s_iterator));

    // ── Hard ────────────────────────────────────────────────────────────

    fn s_state_machine(dir: &Path) -> SetupResult {
        let p = ap(dir, "fsm.py");
        with_checks(pf(format!(
            "Create a Python file at {p} implementing a generic finite state machine class `StateMachine`:\n\
             - `__init__(self, initial_state)` — set starting state\n\
             - `add_transition(self, from_state, event, to_state, action=None)` — register a transition\n\
             - `handle(self, event)` — process an event: transition state and call action if defined\n\
             - `state` property returning current state\n\
             Raise `InvalidTransition` (custom exception) if no matching transition exists. \
             Include a small usage example in `if __name__ == '__main__'` demonstrating a turnstile (locked/unlocked).")),
            vec![complete(),
                 file_has("fsm.py", &["class StateMachine", "class InvalidTransition", "add_transition", "handle", "__name__"])])
    }
    v.push(scen!("impl_state_machine", Category::Implement, Difficulty::Hard, I, s_state_machine));

    fn s_rest_router(dir: &Path) -> SetupResult {
        let p = ap(dir, "router.ts");
        with_checks(pf(format!(
            "Create a TypeScript file at {p} implementing a simple HTTP router class `Router`:\n\
             - `get(path, handler)`, `post(path, handler)`, `put(path, handler)`, `delete(path, handler)` \
               to register route handlers\n\
             - `resolve(method, path)` — returns the matching handler or null\n\
             - Support path parameters like `/users/:id` that extract into a params object\n\
             Export the Router class.")),
            vec![complete(),
                 file_has("router.ts", &["class Router", "get(", "post(", "resolve(", "export"]),
                 // Path params can use :param syntax or other extraction patterns
                 file_has("router.ts", &[":"])])
    }
    v.push(scen!("impl_rest_router", Category::Implement, Difficulty::Hard, I, s_rest_router));

    fn s_retry_decorator(dir: &Path) -> SetupResult {
        let p = ap(dir, "retry.py");
        with_checks(pf(format!(
            "Create a Python file at {p} that implements a `@retry` decorator:\n\
             - `retry(max_attempts=3, delay=1.0, backoff=2.0, exceptions=(Exception,))`\n\
             - Retries the decorated function up to `max_attempts` times on failure\n\
             - Uses exponential backoff: waits `delay * backoff^attempt` seconds between retries\n\
             - Only catches the specified `exceptions` tuple\n\
             - Re-raises the last exception if all attempts fail\n\
             Use `time.sleep` for delays. Include type hints and a docstring.")),
            vec![complete(),
                 file_has("retry.py", &["def retry", "max_attempts", "backoff", "time.sleep", "def wrapper"])])
    }
    v.push(scen!("impl_retry_decorator", Category::Implement, Difficulty::Hard, I, s_retry_decorator));
}
