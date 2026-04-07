//! Implementation scenarios — write new code from a specification.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    // ── Easy ────────────────────────────────────────────────────────────

    fn s_fibonacci(dir: &Path) -> SetupResult {
        let p = ap(dir, "fib.py");
        with_checks(pf(format!(
            "Create a Python file at {p} that implements a function `fibonacci(n: int) -> int` returning \
             the n-th Fibonacci number (0-indexed: fib(0)=0, fib(1)=1, fib(2)=1, ...). \
             Also include a `if __name__ == '__main__':` block that prints fibonacci(10).")),
            vec![complete(), file_has("fib.py", &["def fibonacci", "__name__", "fibonacci(10)"])])
    }
    v.push(scen!("impl_fibonacci", Category::Implement, Difficulty::Easy, I, s_fibonacci));

    fn s_linked_list_node(dir: &Path) -> SetupResult {
        let p = ap(dir, "node.ts");
        with_checks(pf(format!(
            "Create a TypeScript file at {p} with a generic class `ListNode<T>` that has:\n\
             - a `value: T` property\n\
             - a `next: ListNode<T> | null` property (default null)\n\
             - a constructor taking `value: T`\n\
             Export the class.")),
            vec![complete(),
                 file_has("node.ts", &["class ListNode", "value:", "next:", "constructor", "export"])])
    }
    v.push(scen!("impl_linked_list_node", Category::Implement, Difficulty::Easy, I, s_linked_list_node));

    fn s_cli_parser(dir: &Path) -> SetupResult {
        let p = ap(dir, "args.py");
        with_checks(pf(format!(
            "Create a Python file at {p} that uses `argparse` to define a CLI with:\n\
             - a required positional argument `input_file`\n\
             - an optional `--output` / `-o` flag defaulting to 'output.txt'\n\
             - an optional `--verbose` / `-v` boolean flag\n\
             Parse and print the args in a `main()` function.")),
            vec![complete(),
                 file_has("args.py", &["argparse", "input_file", "--output", "--verbose", "def main"])])
    }
    v.push(scen!("impl_argparse_cli", Category::Implement, Difficulty::Easy, I, s_cli_parser));

    // ── Medium ──────────────────────────────────────────────────────────

    fn s_lru_cache(dir: &Path) -> SetupResult {
        let p = ap(dir, "lru.py");
        with_checks(pf(format!(
            "Create a Python file at {p} implementing a class `LRUCache` with:\n\
             - `__init__(self, capacity: int)`\n\
             - `get(self, key) -> value or -1` (moves key to most recently used)\n\
             - `put(self, key, value)` (evicts least recently used when full)\n\
             Use an OrderedDict or a dict + doubly-linked list. Include docstrings.")),
            vec![complete(),
                 file_has("lru.py", &["class LRUCache", "def __init__", "capacity", "def get", "def put"])])
    }
    v.push(scen!("impl_lru_cache", Category::Implement, Difficulty::Medium, I, s_lru_cache));

    fn s_middleware(dir: &Path) -> SetupResult {
        let p = ap(dir, "middleware.ts");
        with_checks(pf(format!(
            "Create a TypeScript file at {p} that exports:\n\
             1. A type `Middleware` defined as `(req: Request, next: () => Promise<Response>) => Promise<Response>`\n\
             2. A `logging` middleware that logs the method and URL before calling next()\n\
             3. A `timing` middleware that measures and logs how long next() takes\n\
             4. A `compose(...middlewares: Middleware[])` function that chains them")),
            vec![complete(),
                 file_has("middleware.ts", &["Middleware", "logging", "timing", "compose", "async", "next()"])])
    }
    v.push(scen!("impl_middleware_chain", Category::Implement, Difficulty::Medium, I, s_middleware));

    fn s_event_emitter(dir: &Path) -> SetupResult {
        let p = ap(dir, "events.ts");
        with_checks(pf(format!(
            "Create a TypeScript file at {p} with a generic class `EventEmitter<Events>` supporting:\n\
             - `on(event, listener)` — register a listener\n\
             - `off(event, listener)` — remove a listener\n\
             - `emit(event, ...args)` — invoke all listeners for an event\n\
             - `once(event, listener)` — listener that auto-removes after first call\n\
             Export the class.")),
            vec![complete(),
                 // Methods may have generic params: emit<K>(...) instead of emit(...)
                 file_has("events.ts", &["class EventEmitter", "on(", "off(", "export"]),
                 file_has("events.ts", &["emit"]),
                 file_has("events.ts", &["once"])])
    }
    v.push(scen!("impl_event_emitter", Category::Implement, Difficulty::Medium, I, s_event_emitter));

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
