//! Implementation scenarios — write new code from a specification.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {

    fn s_iterator(dir: &Path) -> SetupResult {
        let p = ap(dir, "chunked.py");
        with_checks(pf(format!(
            "Create a Python file at {p} that implements two generator functions:\n\
             1. `chunked(iterable, size)` — yields non-overlapping chunks (each a list) of up to `size` items; \
                the last chunk may be shorter if the iterable length is not a multiple of `size`.\n\
             2. `sliding_window(iterable, size)` — yields overlapping windows of exactly `size` items each \
                (as tuples or lists); if the iterable has fewer than `size` items, yield nothing.\n\
             Both functions must accept any iterable (not only sequences) and must not materialize \
             the whole input up-front. Include type hints and docstrings.")),
            vec![complete(),
                 file_has("chunked.py", &["def chunked", "def sliding_window"]),
                 run_has(
                     &format!("python3 -c \"import sys; sys.path.insert(0, '{}'); \
                         from chunked import chunked, sliding_window; \
                         c = list(chunked(iter(range(7)), 3)); \
                         assert c == [[0,1,2],[3,4,5],[6]], c; \
                         w = list(sliding_window(iter(range(5)), 3)); \
                         assert [list(x) for x in w] == [[0,1,2],[1,2,3],[2,3,4]], w; \
                         assert list(sliding_window(iter([1,2]), 3)) == []; \
                         print('OK')\"", dir.to_string_lossy()),
                     &["OK"])])
    }
    v.push(scen!("impl_iterators", Category::Implement, Difficulty::Medium, I, s_iterator));


    fn s_state_machine(dir: &Path) -> SetupResult {
        let p = ap(dir, "fsm.py");
        with_checks(pf(format!(
            "Create a Python file at {p} implementing a generic finite state machine class `StateMachine` with:\n\
             - a constructor taking an initial state\n\
             - a method `add_transition(from_state, event, to_state, action=None)` that registers \
               a transition; `action` (when given) is a callable invoked on transition\n\
             - a method `handle(event)` that transitions from the current state using the registered \
               rule, invokes the action if any, and returns the new state\n\
             - read access to the current state via an attribute or property named `state`\n\
             - a custom exception class `InvalidTransition` raised by `handle` when no matching \
               (current_state, event) transition is registered\n\
             Also include a runnable example under `if __name__ == '__main__':` that builds a turnstile \
             FSM with states `locked` and `unlocked` reacting to `coin` and `push` events, and prints \
             the sequence of states. Running the file must succeed with exit code 0.")),
            vec![complete(),
                 file_has("fsm.py", &["class StateMachine", "class InvalidTransition", "add_transition", "handle"]),
                 run_ok(&format!("python3 {p}")),
                 run_has(
                     &format!("python3 -c \"\
import sys; sys.path.insert(0, '{d}')\n\
from fsm import StateMachine, InvalidTransition\n\
m = StateMachine('locked')\n\
m.add_transition('locked', 'coin', 'unlocked')\n\
m.add_transition('unlocked', 'push', 'locked')\n\
assert m.state == 'locked'\n\
m.handle('coin'); assert m.state == 'unlocked'\n\
m.handle('push'); assert m.state == 'locked'\n\
ok = False\n\
try: m.handle('push')\n\
except InvalidTransition: ok = True\n\
assert ok\n\
print('OK')\n\
\"", d = dir.to_string_lossy()),
                     &["OK"])])
    }
    v.push(scen!("impl_state_machine", Category::Implement, Difficulty::Hard, I, s_state_machine));

    fn s_rest_router(dir: &Path) -> SetupResult {
        let p = ap(dir, "router.ts");
        with_checks(pf(format!(
            "Create a TypeScript file at {p} that exports a class `Router` implementing a tiny HTTP \
             router. It must support registering handlers per method (at minimum GET, POST, PUT, DELETE) \
             and resolving a request to a registered handler.\n\n\
             Requirements:\n\
             - Given a method and a concrete path, the router returns both the matching handler and \
               any extracted path-parameter values. When no route matches, it returns a falsy result \
               (null/undefined) rather than throwing.\n\
             - Registered routes can contain named path parameters; resolving a concrete path must \
               bind each segment to the corresponding parameter name. Example: a route registered as \
               `/users/<id>/posts/<postId>` resolved against `/users/42/posts/7` yields params mapping \
               `id -> '42'` and `postId -> '7'`. You may use any parameter syntax (e.g. `:name`, \
               `{{name}}`, `<name>`) so long as the behavior holds.\n\
             - Methods are matched case-insensitively; literal segments are matched case-sensitively.\n\n\
             Export the `Router` class as a named export.")),
            vec![complete(),
                 file_has("router.ts", &["class Router", "export"]),
                 // Param-binding mechanism must be present in some form.
                 file_has("router.ts", &["param"]),
                 // Some registration surface — either per-verb methods, a generic add/on/register,
                 // or a map keyed by HTTP method. Accept any of these valid designs.
                 Check::RunOutputContains(
                     "grep -qEi '(\\.(get|post|put|delete)[[:space:]]*\\()|(register|add|on|route|handle|method)[[:space:]]*[=:(]' router.ts && echo ROUTER_API_OK".into(),
                     10,
                     vec!["ROUTER_API_OK".into()],
                 )])
    }
    v.push(scen!("impl_rest_router", Category::Implement, Difficulty::Hard, I, s_rest_router));

    fn s_retry_decorator(dir: &Path) -> SetupResult {
        let p = ap(dir, "retry.py");
        with_checks(pf(format!(
            "Create a Python file at {p} that implements a decorator factory named `retry` usable as \
             `@retry(...)` with these keyword parameters and defaults:\n\
             - `max_attempts` (int, default 3) — total number of attempts including the first call\n\
             - `delay` (float, default 1.0) — initial wait between attempts, in seconds\n\
             - `backoff` (float, default 2.0) — multiplier applied to the wait after each failure, \
               producing an exponentially growing wait\n\
             - `exceptions` (tuple of exception types, default `(Exception,)`) — only exceptions that \
               are instances of these types are caught and retried; any other exception propagates \
               immediately\n\n\
             Behavior:\n\
             - Call the wrapped function. If it raises an exception of a caught type and attempts \
               remain, wait and retry; otherwise re-raise.\n\
             - After exhausting `max_attempts`, re-raise the most recent exception.\n\
             - On success, return the function's result.\n\n\
             Include a docstring. Do not print or log from the decorator itself.")),
            vec![complete(),
                 file_has("retry.py", &["def retry", "max_attempts", "backoff", "exceptions"]),
                 // Behavioral verification: succeed-on-3rd-try, respect max_attempts, skip uncaught exception types.
                 run_has(
                     &format!("python3 -c \"\
import sys; sys.path.insert(0, '{d}')\n\
from retry import retry\n\
calls = {{'n': 0}}\n\
@retry(max_attempts=3, delay=0, backoff=1, exceptions=(ValueError,))\n\
def flaky():\n    calls['n'] += 1\n    if calls['n'] < 3: raise ValueError('x')\n    return 'ok'\n\
assert flaky() == 'ok' and calls['n'] == 3\n\
calls2 = {{'n': 0}}\n\
@retry(max_attempts=2, delay=0, backoff=1, exceptions=(ValueError,))\n\
def always_bad():\n    calls2['n'] += 1\n    raise ValueError('x')\n\
try: always_bad()\n\
except ValueError: pass\n\
else: raise SystemExit('expected ValueError')\n\
assert calls2['n'] == 2, calls2\n\
calls3 = {{'n': 0}}\n\
@retry(max_attempts=5, delay=0, backoff=1, exceptions=(ValueError,))\n\
def wrong_exc():\n    calls3['n'] += 1\n    raise TypeError('t')\n\
try: wrong_exc()\n\
except TypeError: pass\n\
else: raise SystemExit('expected TypeError')\n\
assert calls3['n'] == 1, calls3\n\
print('OK')\n\
\"", d = dir.to_string_lossy()),
                     &["OK"])])
    }
    v.push(scen!("impl_retry_decorator", Category::Implement, Difficulty::Hard, I, s_retry_decorator));
}
