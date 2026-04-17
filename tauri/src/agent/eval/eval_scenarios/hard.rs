//! Hard scenarios — 25 devious challenges designed to trip up even
//! frontier models. Every scenario contains a "gotcha": a red herring,
//! an unintuitive answer, a multi-file dependency chain, or a subtle
//! semantic trap that requires genuine reasoning rather than pattern-matching.
//! Pass criteria prefer behavior-level checks (`run_has`) over brittle string
//! matches so that any correct solution, not one specific fix, passes.

use std::path::Path;

use crate::agent::types::AgentRole::{Implement as I, Research as R, Plan as P};
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {

    // 1. BUGFIX — Shadow variable trap
    //    The obvious "bug" (an unused import) is a decoy. The real bug is
    //    a variable shadowing issue in a helper function that silently
    //    returns the wrong value.

    fn s_shadow_variable_trap(dir: &Path) -> SetupResult {
        let p = ap(dir, "billing.py");
        std::fs::write(&p, r#"import math  # noqa — used in future calculations

def calculate_tax(amount: float, rate: float) -> float:
    """Apply tax rate to amount."""
    return amount * rate

def calculate_total(items: list[dict]) -> float:
    """Calculate total cost of items with 8% tax."""
    subtotal = 0.0
    for item in items:
        subtotal += item["price"] * item["quantity"]
    tax = calculate_tax(subtotal, 0.08)
    total = apply_discount(subtotal, tax)
    return round(total, 2)

def apply_discount(subtotal: float, tax: float) -> float:
    """Apply a $5 discount if subtotal exceeds $100, then add tax."""
    discount = 5.0 if subtotal > 100 else 0.0
    # BUG: 'total' shadows nothing but uses subtotal instead of (subtotal - discount)
    total = subtotal + tax
    return total
"#).unwrap();
        let run_cmd = format!(
            "python3 -c 'import billing; print(billing.calculate_total([{{\"price\": 60, \"quantity\": 2}}]))'",
        );
        with_scope(with_checks(pf(format!(
            "The function `calculate_total` in {p} is supposed to apply an 8% tax and \
             a $5 discount for orders over $100. Customers report that the discount never \
             shows up on their totals. Investigate and fix the bug so both the tax and the \
             discount are correctly reflected in the returned total.")),
            vec![complete(),
                 file_has("billing.py", &["discount"]),
                 file_lacks("billing.py", &["total = subtotal + tax"]),
                 // For $120 subtotal with 8% tax and $5 discount:
                 // correct: (120 - 5) + 120*0.08 = 115 + 9.6 = 124.6
                 // buggy:   120 + 120*0.08 = 129.6
                 run_has(&run_cmd, &["124.6"])]),
            vec![p])
    }
    v.push(scen!("hard_shadow_variable_trap", Category::Bugfix, Difficulty::Hard, I, s_shadow_variable_trap));

    // 2. BUGFIX — Red herring across files
    //    The prompt says "there's a bug in api.py". The obvious issue in
    //    api.py is actually correct. The real bug is in validator.py
    //    where a regex is wrong. The model must read BOTH files.

    fn s_red_herring_cross_file(dir: &Path) -> SetupResult {
        let api = ap(dir, "api.py");
        let validator = ap(dir, "validator.py");
        std::fs::write(&validator, r#"import re

def validate_email(email: str) -> bool:
    """Validate email format. Must have local@domain.tld structure."""
    # BUG: This regex requires the TLD to be exactly 2 chars,
    # rejecting valid .com, .org, .info addresses
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2}$'
    return bool(re.match(pattern, email))
"#).unwrap();
        std::fs::write(&api, r#"from validator import validate_email

def register_user(data: dict) -> dict:
    """Register a new user. Returns error dict on failure."""
    email = data.get("email", "")

    # This looks suspicious but is actually correct —
    # we strip whitespace before validating
    email = email.strip().lower()

    if not validate_email(email):
        return {"error": "Invalid email format"}

    return {"user_id": 1, "email": email}
"#).unwrap();
        let run_cmd = "python3 -c 'import api; print(api.register_user({\"email\": \"user@example.com\"}))'";
        with_scope(with_checks(pf(format!(
            "Users report that `register_user` rejects valid emails like 'user@example.com', \
             'alice@foo.org' and 'bob@corp.info'. The entry point is in {api}. \
             Investigate the codebase and fix whatever is actually causing the rejection.")),
            vec![complete(),
                 // The buggy regex must be gone
                 file_lacks("validator.py", &[r#"[a-zA-Z]{2}$"#]),
                 // Behavior: a 3-letter TLD must now be accepted (no "error" key in the dict)
                 run_has(run_cmd, &["user_id"]),
                 run_lacks(run_cmd, &["error"])]),
            vec![api, validator])
    }
    v.push(scen!("hard_red_herring_cross_file", Category::Bugfix, Difficulty::Hard, I, s_red_herring_cross_file));

    // 3. BUGFIX — Unicode string slicing
    //    Looks like simple string processing but breaks on emoji/multi-byte.
    //    The model must realize Python str indexing is by code point, not
    //    byte, and that the REAL bug is using len() check before a
    //    different encoding operation.

    fn s_unicode_truncation(dir: &Path) -> SetupResult {
        let p = ap(dir, "truncate.py");
        std::fs::write(&p, r#"def truncate_to_bytes(text: str, max_bytes: int) -> str:
    """Truncate text so its UTF-8 encoding is at most max_bytes.

    Must not break in the middle of a multi-byte character.
    Returns the longest prefix of `text` whose UTF-8 encoding
    fits within max_bytes.
    """
    # BUG: len(text) counts code points, not bytes.
    # A string with emoji like "Hi 😊" is 4 code points but 7 bytes.
    if len(text) <= max_bytes:
        return text
    return text[:max_bytes]
"#).unwrap();
        // Behavior checks via helper script (avoids shell quoting around the emoji).
        // "Hi 😊" (7 bytes UTF-8) with max_bytes=6 must not split the emoji; must return "Hi ".
        // "Hello" with max_bytes=10 must return "Hello" unchanged.
        std::fs::write(dir.join("_check.py"), "import truncate\n\
r1 = truncate.truncate_to_bytes('Hi \\U0001F60A', 6)\n\
r2 = truncate.truncate_to_bytes('Hello', 10)\n\
print(repr(r1), len(r1.encode('utf-8')), repr(r2))\n").unwrap();
        let run_cmd = "python3 _check.py";
        with_scope(with_checks(pf(format!(
            "The function `truncate_to_bytes` in {p} is supposed to return the longest prefix \
             of the input whose UTF-8 encoding fits within `max_bytes`, without splitting a \
             multi-byte character. It misbehaves on inputs containing non-ASCII characters \
             (e.g. emoji). Find and fix the issue.")),
            vec![complete(),
                 file_lacks("truncate.py", &["if len(text) <= max_bytes:\n        return text\n    return text[:max_bytes]"]),
                 // Behavior: "Hi " (3 bytes) is the correct output for "Hi 😊" at max_bytes=6
                 run_has(run_cmd, &["'Hi '", "'Hello'"]),
                 // Must NOT return the undecodable partial bytes or the full emoji string
                 run_lacks(run_cmd, &["UnicodeDecodeError", "Traceback"])]),
            vec![p])
    }
    v.push(scen!("hard_unicode_truncation", Category::Bugfix, Difficulty::Hard, I, s_unicode_truncation));

    // 4. UNDERSTANDING — JavaScript closure-in-loop trap
    //    Classic gotcha: var in a for loop shares the closure variable.
    //    The model must report the exact (counterintuitive) output.

    fn s_closure_in_loop(dir: &Path) -> SetupResult {
        let p = ap(dir, "closures.js");
        std::fs::write(&p, r#"function createHandlers() {
  var handlers = [];
  for (var i = 0; i < 4; i++) {
    handlers.push(function() {
      return i * i;
    });
  }
  return handlers;
}

var h = createHandlers();
// What does h[0]() + h[1]() + h[2]() + h[3]() equal?
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. What does `h[0]() + h[1]() + h[2]() + h[3]()` evaluate to? \
             Trace the execution carefully. \
             State your final answer as the last number in your reply.")),
            // All closures capture the final value of i (which is 4 after the loop).
            // Each returns 4*4 = 16. Sum = 64.
            vec![complete(), succeeded("read"), num(64)]),
            vec![p])
    }
    v.push(scen!("hard_closure_in_loop", Category::Understanding, Difficulty::Hard, R, s_closure_in_loop));

    // 5. UNDERSTANDING — Python operator precedence trap
    //    `not`, `and`, `or`, `in`, comparison chaining. The answer is
    //    counterintuitive.

    fn s_precedence_trap(dir: &Path) -> SetupResult {
        let p = ap(dir, "precedence.py");
        std::fs::write(&p, r#"def evaluate():
    x = 5
    y = 10
    z = 15

    # Python comparison chaining and operator precedence
    a = x < y < z          # True (chained comparison)
    b = not x == y          # True (not (5 == 10) => not False => True)
    c = x + y * 2           # 25  (multiplication first)
    d = x | y               # 15  (bitwise OR: 0101 | 1010 = 1111)
    e = True + True + True  # 3   (bool is int subclass)

    result = c + d + e      # 25 + 15 + 3 = 43
    return result
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. What value does `evaluate()` return? \
             Trace each computation carefully. \
             State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("read"), num(43)]),
            vec![p])
    }
    v.push(scen!("hard_precedence_trap", Category::Understanding, Difficulty::Hard, R, s_precedence_trap));

    // 6. UNDERSTANDING — Mutable default argument + aliasing
    //    The function mutates a default list, causing state leak between
    //    calls. The model must correctly trace three separate calls.

    fn s_mutable_default(dir: &Path) -> SetupResult {
        let p = ap(dir, "defaults.py");
        std::fs::write(&p, r#"def append_to(element, target=[]):
    target.append(element)
    return target

# Three calls:
a = append_to(1)
b = append_to(2)
c = append_to(3, [])

# What is len(a) + len(b) + len(c)?
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. After the three calls, what is `len(a) + len(b) + len(c)`? \
             Trace each call carefully. \
             State your final answer as the last number in your reply.")),
            // a and b share the same default list. After append_to(1), default=[1].
            // After append_to(2), default=[1,2]. a and b both point to [1,2], so len=2 each.
            // c gets a fresh list [3], len=1.
            // Total: 2 + 2 + 1 = 5
            vec![complete(), succeeded("read"), num(5)]),
            vec![p])
    }
    v.push(scen!("hard_mutable_default_arg", Category::Understanding, Difficulty::Hard, R, s_mutable_default));

    // 7. SEARCH — Needle in haystack with decoys
    //    20 files, some contain "TODO" inside strings or variable names
    //    (decoys), only specific ones are actual TODO comments. Must
    //    count precisely.

    fn s_precise_search_with_decoys(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("src")).ok();
        // Real TODOs (actual comments):
        std::fs::write(dir.join("src/auth.py"),
            "def login():\n    # TODO: add rate limiting\n    pass\n").unwrap();
        std::fs::write(dir.join("src/db.py"),
            "def connect():\n    pass\n    # TODO: connection pooling\n").unwrap();
        std::fs::write(dir.join("src/api.py"),
            "# TODO: implement pagination\ndef get_items(): return []\n").unwrap();

        // Decoys — "TODO" appears but NOT as a comment:
        std::fs::write(dir.join("src/models.py"),
            "TODO_STATUS = 'pending'\nclass Todo:\n    def __init__(self):\n        self.status = TODO_STATUS\n").unwrap();
        std::fs::write(dir.join("src/config.py"),
            "FEATURES = {'enable_todo_list': True}\n").unwrap();
        std::fs::write(dir.join("src/strings.py"),
            "HELP_TEXT = \"Click TODO to add a new task\"\nERROR_MSG = \"Failed to update TODO item\"\n").unwrap();
        std::fs::write(dir.join("src/tests.py"),
            "def test_todo_creation():\n    assert create_todo('test') is not None\n").unwrap();
        std::fs::write(dir.join("src/views.py"),
            "def render():\n    return '<h1>TODO List</h1>'\n").unwrap();

        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search all Python files under {d}/src/ for actual TODO comments (lines where TODO appears \
             in a code comment, i.e. after a `#`). Do NOT count occurrences where 'TODO' appears \
             in string literals, variable names, class names, or function names. \
             How many actual TODO comments are there? State your final answer as the last number.")),
            vec![complete(), succeeded("fs_search"), num(3),
                 oc_all(&["rate limiting", "connection pooling", "pagination"])])
    }
    v.push(scen!("hard_search_decoy_todos", Category::Search, Difficulty::Hard, R, s_precise_search_with_decoys));

    // 8. SEARCH — Cross-file data flow tracing
    //    A value passes through 5 files via imports. One file silently
    //    transforms it. The model must trace the full chain.

    fn s_data_flow_trace(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("pipeline")).ok();
        std::fs::write(dir.join("pipeline/source.py"),
            "RAW_RATE = 0.15\n").unwrap();
        std::fs::write(dir.join("pipeline/adjust.py"),
            "from source import RAW_RATE\n# Regional adjustment\nADJUSTED_RATE = RAW_RATE + 0.05\n").unwrap();
        std::fs::write(dir.join("pipeline/convert.py"),
            "from adjust import ADJUSTED_RATE\n# BUG: accidentally multiplies by 100 instead of keeping as decimal\nDISPLAY_RATE = ADJUSTED_RATE * 100\n").unwrap();
        std::fs::write(dir.join("pipeline/format.py"),
            "from convert import DISPLAY_RATE\ndef format_rate() -> str:\n    return f'{DISPLAY_RATE:.1f}%'\n").unwrap();
        std::fs::write(dir.join("pipeline/report.py"),
            "from format import format_rate\ndef generate_report() -> str:\n    return f'Current tax rate: {format_rate()}'\n").unwrap();

        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Trace the value of the tax rate from {d}/pipeline/source.py all the way through to \
             the string returned by `generate_report()` in {d}/pipeline/report.py. Identify which \
             file (if any) introduces an incorrect scaling, and report what percentage string the \
             final report actually prints today. \
             State the numeric part of the final displayed percentage as the last number in your reply.")),
            vec![complete(), used_any(&["fs_search", "read"]),
                 // Must name the offending file
                 oc_any(&["convert.py", "convert"]),
                 // Must explain the scaling error
                 oc_any(&["multiplied by 100", "* 100", "times 100", "scaled by 100", "x 100"]),
                 // Actual displayed number after the buggy *100 is 20.0
                 num(20)])
    }
    v.push(scen!("hard_data_flow_trace", Category::Search, Difficulty::Hard, R, s_data_flow_trace));

    // 9. CROSS-FILE — Config contradicts implementation
    //    config.json says max 5 retries, but the code hard-codes 3.
    //    The model must update BOTH to be consistent (use config value).

    fn s_config_code_mismatch(dir: &Path) -> SetupResult {
        let cfg = ap(dir, "config.json");
        let client = ap(dir, "client.py");
        std::fs::write(&cfg, r#"{
    "max_retries": 5,
    "timeout_seconds": 30,
    "base_url": "https://api.example.com"
}"#).unwrap();
        std::fs::write(&client, r#"import json
import time

def load_config() -> dict:
    with open("config.json") as f:
        return json.load(f)

def send_request(url: str, payload: dict) -> dict:
    """Send request with retry logic. Should use config for max_retries."""
    config = load_config()
    timeout = config["timeout_seconds"]

    # BUG: hard-coded 3 instead of using config["max_retries"]
    for attempt in range(3):
        try:
            # Simulate request
            response = make_http_call(url, payload, timeout)
            return response
        except ConnectionError:
            if attempt < 2:  # BUG: should be config["max_retries"] - 1
                time.sleep(2 ** attempt)
            else:
                raise

    return {"error": "max retries exceeded"}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "The client in {client} should take its retry behavior from the configuration file \
             at {cfg}, but the runtime retry count does not match the configured value. \
             Find every place where the retry count has drifted from the config and make them \
             all read from the config consistently.")),
            vec![complete(),
                 // Must reference max_retries from config (any access style)
                 file_has("client.py", &["max_retries"]),
                 // Both hard-coded sites must be gone
                 file_lacks("client.py", &["range(3)"]),
                 file_lacks("client.py", &["attempt < 2"])]),
            vec![client, cfg])
    }
    v.push(scen!("hard_config_code_mismatch", Category::CrossFile, Difficulty::Hard, I, s_config_code_mismatch));

    // 10. CROSS-FILE — Diamond dependency update
    //     Four files form a diamond: base -> (left, right) -> consumer.
    //     Adding a required field to base means all four must be updated
    //     consistently.

    fn s_diamond_dependency(dir: &Path) -> SetupResult {
        let base = ap(dir, "base.ts");
        let auth = ap(dir, "auth.ts");
        let logging = ap(dir, "logging.ts");
        let app = ap(dir, "app.ts");
        std::fs::write(&base, r#"export interface RequestContext {
  requestId: string;
  userId: string;
  timestamp: number;
}

export function createContext(userId: string): RequestContext {
  return {
    requestId: crypto.randomUUID(),
    userId,
    timestamp: Date.now(),
  };
}
"#).unwrap();
        std::fs::write(&auth, r#"import { RequestContext } from './base';

export function checkAuth(ctx: RequestContext): boolean {
  console.log(`Auth check for user ${ctx.userId} at ${ctx.timestamp}`);
  return ctx.userId !== 'anonymous';
}
"#).unwrap();
        std::fs::write(&logging, r#"import { RequestContext } from './base';

export function logRequest(ctx: RequestContext): void {
  console.log(`[${ctx.requestId}] User: ${ctx.userId}, Time: ${ctx.timestamp}`);
}
"#).unwrap();
        std::fs::write(&app, r#"import { createContext, RequestContext } from './base';
import { checkAuth } from './auth';
import { logRequest } from './logging';

export function handleRequest(userId: string): string {
  const ctx = createContext(userId);
  logRequest(ctx);
  if (!checkAuth(ctx)) {
    return 'Unauthorized';
  }
  return `OK: ${ctx.requestId}`;
}
"#).unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "A new requirement: every `RequestContext` in {d} must carry the originating \
             client IP address as a required string field named `ipAddress`. Update the \
             interface, the factory, every consumer that logs or uses a context, and the \
             top-level entry point so that the default IP '127.0.0.1' is threaded through. \
             All files in {d} that touch RequestContext must stay consistent and compilable.")),
            vec![complete(),
                 // Interface must declare the field (allow with or without space before `string`)
                 file_has("base.ts", &["ipAddress"]),
                 // Factory must accept it — createContext signature changed
                 file_has("base.ts", &["createContext"]),
                 // Logger should mention ipAddress
                 file_has("logging.ts", &["ipAddress"]),
                 // handleRequest must pass the default IP through
                 file_has("app.ts", &["127.0.0.1"])])
    }
    v.push(scen!("hard_diamond_dependency", Category::CrossFile, Difficulty::Hard, I, s_diamond_dependency));

    // 11. CROSS-FILE — Hidden re-export chain
    //     Must follow re-exports through 4 files to find where a function
    //     is actually defined, then fix the bug at the source.

    fn s_reexport_chain(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("lib")).ok();
        // The actual source — bug is here
        std::fs::write(dir.join("lib/core.py"), r#"def normalize_name(name: str) -> str:
    """Normalize a name: strip, title-case, collapse spaces."""
    # BUG: split() then join with single space is correct for collapsing,
    # but we title-case BEFORE splitting, so "  john   doe  " becomes
    # "  John   Doe  " then split+join gives "John Doe" — this is OK.
    # The REAL bug: we forgot to handle empty strings, causing IndexError
    # on title() for empty input. Also, we strip AFTER title, but title()
    # on "  john" gives "  John" which is fine. The actual bug is the
    # regex: we replace hyphens, breaking names like "Mary-Jane".
    import re
    cleaned = re.sub(r'[^a-zA-Z\s]', '', name)
    return ' '.join(cleaned.split()).title()
"#).unwrap();
        // Re-export chain
        std::fs::write(dir.join("lib/text.py"),
            "from lib.core import normalize_name\n").unwrap();
        std::fs::write(dir.join("lib/utils.py"),
            "from lib.text import normalize_name\n").unwrap();
        std::fs::write(dir.join("lib/__init__.py"),
            "from lib.utils import normalize_name\n").unwrap();
        // Consumer
        std::fs::write(dir.join("main.py"), r#"from lib import normalize_name

# normalize_name("Mary-Jane O'Brien") returns "Maryjane Obrien"
# but it should return "Mary-Jane O'Brien" (preserving hyphens and apostrophes)
print(normalize_name("Mary-Jane O'Brien"))
"#).unwrap();

        let d = dir.to_string_lossy().into_owned();
        // Helper script that exercises the function and prints the result. Avoids shell
        // quoting issues around the apostrophe in "O'Brien".
        std::fs::write(dir.join("_check.py"),
            "from lib import normalize_name\nprint(normalize_name(\"  Mary-Jane O'Brien  \"))\n").unwrap();
        let run_cmd = format!("cd {d} && python3 _check.py");
        with_scope(with_checks(pf(format!(
            "Running `normalize_name(\"Mary-Jane O'Brien\")` (imported in {d}/main.py) returns \
             \"Maryjane Obrien\" instead of preserving the punctuation in the name. \
             Find the implementation and fix it so legitimate name characters (at minimum \
             hyphens and apostrophes) are kept intact, while still collapsing whitespace and \
             title-casing the result.")),
            vec![complete(),
                 // The buggy over-aggressive regex character class must be gone
                 file_lacks("lib/core.py", &[r#"[^a-zA-Z\s]"#]),
                 // Behavior: both hyphen and apostrophe preserved, case title'd
                 run_has(&run_cmd, &["Mary-Jane", "O'Brien"])]),
            vec![ap(dir, "main.py")])
    }
    v.push(scen!("hard_reexport_chain_trace", Category::CrossFile, Difficulty::Hard, I, s_reexport_chain));

    // 12. IMPLEMENT — Modular exponentiation (gotcha: naive approach overflows)
    //     Must implement binary exponentiation with modulo, not just
    //     pow(base, exp) % mod which works in Python but shows understanding.

    fn s_modular_exponentiation(dir: &Path) -> SetupResult {
        let p = ap(dir, "modpow.py");
        let run_cmd = format!("python3 {p}");
        with_checks(pf(format!(
            "Create a Python file at {p} implementing `modpow(base: int, exp: int, mod: int) -> int` \
             that computes (base^exp) % mod efficiently using binary exponentiation (repeated squaring). \
             Do NOT delegate to Python's built-in three-argument `pow()` — implement the algorithm yourself. \
             Handle edge cases: exp=0 returns 1 (or 0 if mod=1), mod=1 always returns 0. \
             Include a `if __name__ == '__main__'` block that prints `modpow(2, 100, 1000000007)`.")),
            vec![complete(),
                 file_has("modpow.py", &["def modpow"]),
                 file_has("modpow.py", &["__name__"]),
                 // Any three-arg pow() inside the file defeats the exercise.
                 file_lacks("modpow.py", &[
                     "pow(base, exp, mod)", "pow(base,exp,mod)",
                     "pow(base, exp,mod)", "pow(base,exp, mod)",
                 ]),
                 // Behavior: 2**100 % 1000000007 == 976371285
                 run_has(&run_cmd, &["976371285"])])
    }
    v.push(scen!("hard_impl_modpow", Category::Implement, Difficulty::Hard, I, s_modular_exponentiation));

    // 13. IMPLEMENT — Topological sort with cycle detection
    //     Must handle disconnected graphs AND detect cycles properly.

    fn s_topo_sort_with_cycles(dir: &Path) -> SetupResult {
        let p = ap(dir, "topo.py");
        // Behavior check script (written at setup time).
        std::fs::write(dir.join("_check.py"),
            "import topo\n\
print(topo.topo_sort({'a': [], 'b': ['a'], 'c': ['a', 'b']}))\n\
try:\n\
    topo.topo_sort({'a': ['b'], 'b': ['a']})\n\
except topo.CycleError:\n\
    print('CYCLE_DETECTED')\n").unwrap();
        let run_cmd = "python3 _check.py";
        with_checks(pf(format!(
            "Create a Python file at {p} implementing:\n\
             1. `topo_sort(graph: dict[str, list[str]]) -> list[str]` — topological sort. \
                The graph is an adjacency list where keys are nodes and values are lists of \
                their dependencies (edges point FROM dependency TO dependent).\n\
             2. It must raise `CycleError` (a custom exception defined in this module) when the \
                graph contains a cycle.\n\
             3. It must handle disconnected components.\n\
             4. Include an `if __name__ == '__main__'` block demonstrating both a valid DAG and a cycle.\n\
             Example: `{{'a': [], 'b': ['a'], 'c': ['a', 'b']}}` produces ['a', 'b', 'c'].")),
            vec![complete(),
                 file_has("topo.py", &["def topo_sort", "class CycleError", "__name__"]),
                 // Behavior: valid DAG produces a, b, c; cycle raises CycleError
                 run_has(&run_cmd, &["'a'", "'b'", "'c'", "CYCLE_DETECTED"])])
    }
    v.push(scen!("hard_impl_topo_sort", Category::Implement, Difficulty::Hard, I, s_topo_sort_with_cycles));

    // 14. REFACTOR — Behavior-preserving with hidden side effects
    //     The function looks like it just computes a value, but it also
    //     writes to a log file as a side effect. Naive refactoring breaks
    //     the logging.

    fn s_refactor_with_side_effects(dir: &Path) -> SetupResult {
        let p = ap(dir, "processor.py");
        std::fs::write(&p, r#"import datetime

_audit_log = []

def process_transaction(user_id: str, amount: float, tx_type: str) -> dict:
    """Process a financial transaction. DO NOT lose the audit logging."""
    timestamp = datetime.datetime.now().isoformat()

    # Validate
    if amount <= 0:
        _audit_log.append(f"{timestamp} REJECTED {user_id} {tx_type} {amount}: invalid amount")
        return {"error": "Amount must be positive"}
    if tx_type not in ("credit", "debit"):
        _audit_log.append(f"{timestamp} REJECTED {user_id} {tx_type} {amount}: invalid type")
        return {"error": "Invalid transaction type"}

    # Calculate fee
    fee = amount * 0.02 if tx_type == "debit" else 0.0
    net = amount - fee

    # Log success
    _audit_log.append(f"{timestamp} OK {user_id} {tx_type} gross={amount} fee={fee} net={net}")

    return {"user_id": user_id, "type": tx_type, "gross": amount, "fee": round(fee, 2), "net": round(net, 2)}

def get_audit_log() -> list[str]:
    return list(_audit_log)
"#).unwrap();
        // Behavior check: drive both a rejection and a success, then inspect the audit log.
        std::fs::write(dir.join("_check.py"),
            "import processor\n\
processor.process_transaction('u1', -5, 'debit')\n\
processor.process_transaction('u1', 100, 'debit')\n\
log = processor.get_audit_log()\n\
print('|'.join(log))\n").unwrap();
        let run_cmd = "python3 _check.py";
        with_scope(with_checks(pf(format!(
            "Refactor {p}: split `process_transaction` into three functions:\n\
             - `validate_transaction(user_id, amount, tx_type)` — returns None if valid, error dict otherwise\n\
             - `calculate_fee(amount, tx_type)` — returns the fee amount\n\
             - `process_transaction(user_id, amount, tx_type)` — orchestrator that calls the above\n\
             The externally observable behavior of `process_transaction` (return values AND \
             anything visible through `get_audit_log()`) must be preserved for all inputs, \
             including invalid ones.")),
            vec![complete(),
                 file_has("processor.py", &["def validate_transaction", "def calculate_fee", "def process_transaction"]),
                 file_has("processor.py", &["def get_audit_log"]),
                 // Behavior: both rejection and success entries must appear in the audit log
                 // after the two calls above. The originals tag them with "REJECTED" / "OK".
                 run_has(run_cmd, &["REJECTED", "OK"])]),
            vec![p])
    }
    v.push(scen!("hard_refactor_preserve_side_effects", Category::Refactor, Difficulty::Hard, I, s_refactor_with_side_effects));

    // 15. REFACTOR — Extract with entangled mutable state
    //     Two functions both read and write a shared dict. Must refactor
    //     into a class without breaking the shared-state semantics.

    fn s_entangled_state(dir: &Path) -> SetupResult {
        let p = ap(dir, "counters.py");
        std::fs::write(&p, r#"_state = {"requests": 0, "errors": 0, "last_error": None}

def handle_request(path: str) -> str:
    _state["requests"] += 1
    if path == "/error":
        _state["errors"] += 1
        _state["last_error"] = f"Error on request #{_state['requests']}"
        return "500"
    return "200"

def get_stats() -> dict:
    total = _state["requests"]
    errs = _state["errors"]
    rate = (errs / total * 100) if total > 0 else 0.0
    return {
        "total": total,
        "errors": errs,
        "error_rate": round(rate, 1),
        "last_error": _state["last_error"],
    }

def reset():
    _state["requests"] = 0
    _state["errors"] = 0
    _state["last_error"] = None
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Refactor {p}: convert the module-level `_state` dict and the three functions into a \
             `RequestTracker` class. The class should:\n\
             - Store state in `self` attributes (not a module-level dict)\n\
             - Have methods `handle_request(path)`, `get_stats()`, and `reset()`\n\
             - Preserve exactly the same behavior: error rate calculation, last_error tracking, etc.\n\
             Remove the module-level `_state` dict.")),
            vec![complete(),
                 file_has("counters.py", &["class RequestTracker", "def __init__", "self.", "def handle_request", "def get_stats", "def reset"]),
                 file_lacks("counters.py", &["_state = {"])]),
            vec![p])
    }
    v.push(scen!("hard_refactor_entangled_state", Category::Refactor, Difficulty::Hard, I, s_entangled_state));

    // 16. PATCH — Surgical edit in repetitive generated code
    //     300 lines of near-identical handlers. Must change exactly ONE
    //     without using replace_all and without breaking neighbors.

    fn s_surgical_repetitive_edit(dir: &Path) -> SetupResult {
        let p = ap(dir, "routes.py");
        let mut content = String::new();
        for i in 1..=50 {
            content.push_str(&format!(
                "def handle_route_{i}(request):\n    \"\"\"Handler for route {i}.\"\"\"\n    return {{\"route\": {i}, \"status\": \"ok\"}}\n\n"
            ));
        }
        std::fs::write(&p, &content).unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, change ONLY `handle_route_27` to return `{{\"route\": 27, \"status\": \"deprecated\"}}` \
             instead of `\"ok\"`. All other 49 handlers must remain unchanged.")),
            vec![complete(),
                 file_has("routes.py", &["def handle_route_27(request):\n    \"\"\"Handler for route 27.\"\"\"\n    return {\"route\": 27, \"status\": \"deprecated\"}"]),
                 file_has("routes.py", &["def handle_route_26(request):\n    \"\"\"Handler for route 26.\"\"\"\n    return {\"route\": 26, \"status\": \"ok\"}"]),
                 file_has("routes.py", &["def handle_route_28(request):\n    \"\"\"Handler for route 28.\"\"\"\n    return {\"route\": 28, \"status\": \"ok\"}"])]),
            vec![p])
    }
    v.push(scen!("hard_surgical_repetitive_edit", Category::Patch, Difficulty::Hard, I, s_surgical_repetitive_edit));

    // 17. PATCH — TypeScript edit where the obvious fix breaks types
    //     Adding a method is straightforward, but the generic constraint
    //     makes the naive approach fail. Must add a type guard.

    fn s_type_constraint_edit(dir: &Path) -> SetupResult {
        let p = ap(dir, "store.ts");
        std::fs::write(&p, r#"export interface Identifiable {
  id: string;
}

export class Store<T extends Identifiable> {
  private items: Map<string, T> = new Map();

  add(item: T): void {
    this.items.set(item.id, item);
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  getAll(): T[] {
    return Array.from(this.items.values());
  }
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Add three methods to the Store class in {p}:\n\
             1. `findBy` — given a field name and a value, returns all items whose field equals that value. \
                Calling `store.findBy(\"name\", 42)` when items have `name: string` must be a compile error.\n\
             2. `update` — given an id and a partial item, update the fields of the matching item \
                and return whether it existed. Callers must NOT be able to change the `id` through this method.\n\
             3. `count` — return the number of items currently stored.\n\
             Use TypeScript's generic/utility types to enforce these constraints statically; do not \
             rely on runtime checks alone.")),
            vec![complete(),
                 // Must use keyof-based indexing and Partial/Omit for type safety
                 file_has("store.ts", &["findBy"]),
                 file_has("store.ts", &["keyof"]),
                 file_has("store.ts", &["update"]),
                 file_has("store.ts", &["Partial"]),
                 file_has("store.ts", &["Omit"]),
                 file_has("store.ts", &["count"]),
                 // Explicitly excluding 'id' is the whole point
                 file_has("store.ts", &["'id'"]),
                 // Must keep existing methods
                 file_has("store.ts", &["add(item", "get(id", "remove(id", "getAll()"])]),
            vec![p])
    }
    v.push(scen!("hard_type_constraint_edit", Category::Patch, Difficulty::Hard, I, s_type_constraint_edit));

    // 18. ERROR HANDLING — Exception hierarchy ordering trap
    //     Python except clauses are checked top-to-bottom. If a parent
    //     class comes first, children never match. Model must reorder.

    fn s_exception_ordering(dir: &Path) -> SetupResult {
        let p = ap(dir, "handler.py");
        std::fs::write(&p, r#"import json
import os

class AppError(Exception):
    """Base application error."""
    pass

class NotFoundError(AppError):
    """Resource not found."""
    pass

class PermissionError(AppError):
    """Permission denied."""
    pass

class ValidationError(AppError):
    """Input validation failed."""
    pass

def load_user_config(user_id: str) -> dict:
    """Load and parse user config file, with specific error handling."""
    path = f"/configs/{user_id}.json"
    try:
        with open(path) as f:
            data = json.load(f)
        if "name" not in data:
            raise ValidationError("Config missing required 'name' field")
        if not os.access(path, os.W_OK):
            raise PermissionError("Config file is read-only")
        return data
    except AppError:
        return {"error": "Application error", "type": "app"}
    except NotFoundError:
        return {"error": f"No config for user {user_id}", "type": "not_found"}
    except ValidationError:
        return {"error": "Invalid config format", "type": "validation"}
    except PermissionError:
        return {"error": "Cannot access config", "type": "permission"}
    except json.JSONDecodeError:
        return {"error": "Malformed JSON", "type": "parse"}
    except FileNotFoundError:
        return {"error": f"Config file not found: {path}", "type": "missing"}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "The `load_user_config` function in {p} is supposed to return distinct error \
             `type` values ('not_found', 'validation', 'permission', 'parse', 'missing', 'app') \
             depending on which failure occurs. In practice, validation and permission failures \
             are mis-classified and the function even throws on some missing-file cases. \
             Investigate why the specific error `type`s aren't being produced and fix it.")),
            vec![complete(),
                 // The catch-all AppError handler before its children is the core bug — that exact
                 // ordering must not remain. Agent may delete or relocate the clause.
                 file_lacks("handler.py", &["    except AppError:\n        return {\"error\": \"Application error\", \"type\": \"app\"}\n    except NotFoundError:"]),
                 // The specific handlers must still exist somewhere
                 file_has("handler.py", &["except ValidationError"]),
                 file_has("handler.py", &["except json.JSONDecodeError"]),
                 file_has("handler.py", &["except FileNotFoundError"])]),
            vec![p])
    }
    v.push(scen!("hard_exception_ordering", Category::ErrorHandling, Difficulty::Hard, I, s_exception_ordering));

    // 19. ERROR HANDLING — Async error swallowing
    //     A Promise chain silently drops errors because .then() doesn't
    //     re-throw and there's no .catch() on the inner promise.

    fn s_async_error_swallowing(dir: &Path) -> SetupResult {
        let p = ap(dir, "pipeline.ts");
        std::fs::write(&p, r#"interface PipelineResult {
  data: unknown;
  steps: string[];
}

async function fetchData(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function validate(data: unknown): Promise<unknown> {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid data format');
  }
  return data;
}

async function transform(data: unknown): Promise<unknown> {
  // This silently swallows errors from validate
  const validated = validate(data).then(d => d);  // BUG: no await, no catch
  return { transformed: validated };  // BUG: returns Promise object, not resolved value
}

export async function runPipeline(url: string): Promise<PipelineResult> {
  const steps: string[] = [];

  const raw = await fetchData(url);
  steps.push('fetched');

  const result = await transform(raw);
  steps.push('transformed');

  // BUG: errors from validate are never caught here because transform
  // wraps validate's promise without awaiting or catching it

  return { data: result, steps };
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "The async pipeline in {p} misbehaves in two visible ways: (a) invalid input never \
             causes `runPipeline` to reject — the caller gets a result instead of the validation \
             error, and (b) the `data` field of the returned `PipelineResult` is a pending Promise \
             rather than the transformed value. Fix the pipeline so failures propagate and the \
             result carries the actual resolved data.")),
            vec![complete(),
                 // Must await validate
                 file_has("pipeline.ts", &["await validate"]),
                 // Must remove both buggy lines
                 file_lacks("pipeline.ts", &["validate(data).then(d => d)"]),
                 file_lacks("pipeline.ts", &["{ transformed: validated }"])]),
            vec![p])
    }
    v.push(scen!("hard_async_error_swallowing", Category::ErrorHandling, Difficulty::Hard, I, s_async_error_swallowing));

    // 20. RECOVERY — Must read a broken symlink, discover it's broken,
    //     find the real file, and patch it.

    fn s_missing_real_file(dir: &Path) -> SetupResult {
        // Create the actual file at a non-obvious location
        std::fs::create_dir_all(dir.join("data/archive")).ok();
        std::fs::write(dir.join("data/archive/settings.json"), r#"{"theme": "dark", "language": "en", "notifications": true}"#).unwrap();
        // Create a MISLEADING file at the expected location
        std::fs::write(dir.join("config.json"), r#"{"_comment": "This is a placeholder. Real config is in data/archive/settings.json"}"#).unwrap();

        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Change the application's configured `theme` from dark to `\"light\"`. The \
             obvious starting point is {d}/config.json.")),
            vec![complete(),
                 // The real edit must happen in the archive file
                 file_has("data/archive/settings.json", &["\"theme\": \"light\""]),
                 file_lacks("data/archive/settings.json", &["\"theme\": \"dark\""]),
                 // And the placeholder must not have been "fixed" in place (which would silently
                 // leave the real config wrong)
                 file_lacks("config.json", &["\"theme\": \"light\""])])
    }
    v.push(scen!("hard_recovery_redirect_file", Category::Recovery, Difficulty::Hard, I, s_missing_real_file));

    // 21. RECOVERY — Partially corrupted file requires careful extraction
    //     A valid Python file has a corrupted section. The model must
    //     preserve the good parts and fix only the broken part.

    fn s_corrupted_file_recovery(dir: &Path) -> SetupResult {
        let p = ap(dir, "service.py");
        std::fs::write(&p, "class UserService:\n    def __init__(self):\n        self.users = {}\n\n    def add_user(self, uid: str, name: str):\n        self.users[uid] = {\"name\": name, \"active\": True}\n\n    def get_user(self, uid: str):\n        return self.users.get(uid)\n\n    def deactivate_user(self, uid: str):\n        if uid in self.users\n            self.users[uid][\"active\"] = False\n\n    def list_active(self):\n        return [u for u in self.users.values() if u[\"active\"]]\n\n    def remove_user(self, uid: str):\n        if uid in self.users:\n            del self.users[uid]\n            return True\n        return False\n").unwrap();

        with_scope(with_checks(pf(format!(
            "The file {p} has a syntax error somewhere in the middle. Find it, fix it, \
             and also add type hints to ALL methods (return types and parameter types). \
             Don't change any logic — only fix the syntax and add type annotations.")),
            vec![complete(),
                 // Syntax fix: missing colon after "if uid in self.users"
                 file_has("service.py", &["if uid in self.users:"]),
                 file_lacks("service.py", &["if uid in self.users\n"]),
                 // Type hints must be present
                 file_has("service.py", &["-> None", "-> bool"]),
                 // All existing methods must survive
                 file_has("service.py", &["def add_user", "def get_user", "def deactivate_user", "def list_active", "def remove_user"])]),
            vec![p])
    }
    v.push(scen!("hard_recovery_corrupted_file", Category::Recovery, Difficulty::Hard, I, s_corrupted_file_recovery));

    // 22. PLANNING — Architecture with hidden constraints
    //     Must read multiple files to discover that the DB is SQLite
    //     (no concurrent writes), the API is synchronous (Flask), and
    //     there's a file lock mechanism. Plan must account for these.

    fn s_plan_with_hidden_constraints(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("app")).ok();
        std::fs::write(dir.join("app/db.py"), r#"import sqlite3
import threading

_lock = threading.Lock()

def get_conn():
    return sqlite3.connect("app.db", check_same_thread=False)

def execute_with_lock(sql, params=()):
    with _lock:
        conn = get_conn()
        result = conn.execute(sql, params)
        conn.commit()
        return result.fetchall()
"#).unwrap();
        std::fs::write(dir.join("app/api.py"), r#"from flask import Flask, request, jsonify
from db import execute_with_lock

app = Flask(__name__)

@app.route("/items", methods=["GET"])
def list_items():
    rows = execute_with_lock("SELECT * FROM items")
    return jsonify(rows)

@app.route("/items", methods=["POST"])
def create_item():
    data = request.json
    execute_with_lock("INSERT INTO items (name, price) VALUES (?, ?)",
                      (data["name"], data["price"]))
    return jsonify({"status": "created"}), 201
"#).unwrap();
        std::fs::write(dir.join("app/worker.py"), r#"import time
from db import execute_with_lock

def process_batch():
    """Runs every 5 minutes via cron to process pending items."""
    pending = execute_with_lock("SELECT * FROM items WHERE status = 'pending'")
    for item in pending:
        # Heavy computation
        time.sleep(0.5)
        execute_with_lock("UPDATE items SET status = 'processed' WHERE id = ?", (item[0],))
"#).unwrap();
        std::fs::write(dir.join("app/requirements.txt"), "flask==3.0.0\ngunicorn==21.2.0\n").unwrap();

        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Read the existing application under {d}/app/ and produce a numbered \
             implementation plan (at least 6 steps) for adding real-time push notifications \
             to clients whenever an item is created or its status changes. The plan must be \
             grounded in the specific technology and runtime choices already present in the \
             code — call out any that constrain or complicate the design.")),
            vec![complete(), used_any(&["fs_search", "read"]),
                 oc_all(&["1.", "2.", "3.", "4.", "5.", "6."]),
                 // Must mention SQLite limitations (discovered from db.py)
                 oc_any(&["sqlite", "SQLite"]),
                 // Must propose a push mechanism (discovered constraint: Flask is sync)
                 oc_any(&["websocket", "WebSocket", "SSE", "server-sent", "long-polling", "long polling"]),
                 // Must mention the worker/background process (discovered from worker.py)
                 oc_any(&["worker", "batch", "cron", "background"]),
                 // Must recognize the sync framework constraint
                 oc_any(&["Flask", "flask", "sync", "gunicorn", "WSGI"])])
    }
    v.push(scen!("hard_plan_hidden_constraints", Category::Planning, Difficulty::Hard, P, s_plan_with_hidden_constraints));

    // 23. PLANNING — Contradictory requirements in spec
    //     Requirements say "no external dependencies" but also require
    //     JWT authentication and bcrypt password hashing. Model must
    //     identify the contradiction and propose a resolution.

    fn s_plan_contradictory_requirements(dir: &Path) -> SetupResult {
        let p = ap(dir, "requirements.md");
        std::fs::write(&p, r#"# Feature: User Authentication System

## Requirements

1. MUST use bcrypt for password hashing with a work factor of 12
2. MUST issue JWT tokens with RS256 signing for session management
3. MUST have zero external dependencies — standard library only (Python 3.12)
4. MUST support token refresh with sliding expiration
5. MUST store user data in a JSON file (no database)
6. MUST rate-limit login attempts to 5 per minute per IP
7. MUST support password complexity validation (min 12 chars, upper, lower, digit, special)
8. MUST be a single Python file under 500 lines
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read the requirements in {p} and create a detailed implementation plan. \
             Identify any contradictions or impossible constraints in the requirements and \
             propose how to resolve them. Then plan the implementation with at least 6 steps.")),
            vec![complete(), succeeded("read"),
                 oc_all(&["1.", "2.", "3.", "4.", "5.", "6."]),
                 // Must identify the bcrypt/JWT vs no-dependencies contradiction
                 oc_any(&["contradict", "conflict", "impossible", "incompatible", "cannot", "standard library"]),
                 oc_any(&["bcrypt", "JWT"]),
                 // Must propose an alternative
                 oc_any(&["hmac", "hashlib", "PBKDF2", "alternative", "workaround", "instead", "scrypt"])]),
            vec![p])
    }
    v.push(scen!("hard_plan_contradictory_reqs", Category::Planning, Difficulty::Hard, P, s_plan_contradictory_requirements));

    // 24. UNDERSTANDING — Rust borrow checker puzzle
    //     Code that LOOKS like it should compile but doesn't due to
    //     lifetime issues. Model must explain WHY.

    fn s_rust_borrow_puzzle(dir: &Path) -> SetupResult {
        let p = ap(dir, "borrowck.rs");
        std::fs::write(&p, r#"fn longest_prefix<'a>(strings: &'a [String]) -> &'a str {
    if strings.is_empty() {
        return "";
    }
    let first = &strings[0];
    let mut prefix_len = first.len();

    for s in &strings[1..] {
        let common = first.chars()
            .zip(s.chars())
            .take_while(|(a, b)| a == b)
            .count();
        if common < prefix_len {
            prefix_len = common;
        }
    }

    &first[..prefix_len]
}

fn main() {
    let result;
    {
        let words = vec![
            String::from("flower"),
            String::from("flow"),
            String::from("flight"),
        ];
        result = longest_prefix(&words);
    }
    // words is dropped here, but result borrows from it
    println!("Longest prefix: {}", result);
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. This Rust program does not compile. Explain precisely what the compiler \
             objects to and why, and propose at least two distinct ways to make it compile \
             while keeping `main` functional.")),
            vec![complete(), succeeded("read"),
                 // Must identify the dangling reference / lifetime issue
                 oc_any(&["borrow", "lifetime", "dangling", "outlive", "does not live long enough"]),
                 // Must notice the dropped `words` vec
                 oc_any(&["words", "drop", "freed", "destroyed", "out of scope"]),
                 // Must propose at least two distinct remediations (owned return or scope fix)
                 oc_any(&["String", "owned", "clone", "to_string", "to_owned"]),
                 oc_any(&["scope", "outer", "move", "lift", "hoist", "declare"])]),
            vec![p])
    }
    v.push(scen!("hard_rust_borrow_puzzle", Category::Understanding, Difficulty::Hard, R, s_rust_borrow_puzzle));

    // 25. CROSS-FILE — Database schema migration with cascading updates
    //     Must update schema, migration SQL, model code, seed data, AND
    //     test fixtures consistently across 5 files.

    fn s_schema_migration_cascade(dir: &Path) -> SetupResult {
        let schema = ap(dir, "schema.sql");
        let migration = ap(dir, "migrate_001.sql");
        let model = ap(dir, "models.py");
        let seed = ap(dir, "seed_data.json");
        let tests = ap(dir, "test_models.py");

        std::fs::write(&schema, r#"CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    body TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"#).unwrap();
        std::fs::write(&migration, r#"-- Migration 001: Initial schema
-- This file should match schema.sql

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    body TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"#).unwrap();
        std::fs::write(&model, r#"from dataclasses import dataclass
from datetime import datetime

@dataclass
class User:
    id: int
    username: str
    email: str
    created_at: datetime

@dataclass
class Post:
    id: int
    user_id: int
    title: str
    body: str | None
    created_at: datetime

def user_to_dict(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "created_at": user.created_at.isoformat(),
    }

def post_to_dict(post: Post) -> dict:
    return {
        "id": post.id,
        "user_id": post.user_id,
        "title": post.title,
        "body": post.body,
        "created_at": post.created_at.isoformat(),
    }
"#).unwrap();
        std::fs::write(&seed, r#"[
  {"username": "alice", "email": "alice@example.com"},
  {"username": "bob", "email": "bob@example.com"},
  {"username": "carol", "email": "carol@example.com"}
]
"#).unwrap();
        std::fs::write(&tests, r#"from models import User, Post, user_to_dict, post_to_dict
from datetime import datetime

def test_user_to_dict():
    u = User(id=1, username="alice", email="alice@example.com",
             created_at=datetime(2024, 1, 1))
    d = user_to_dict(u)
    assert d["username"] == "alice"
    assert d["email"] == "alice@example.com"

def test_post_to_dict():
    p = Post(id=1, user_id=1, title="Hello", body="World",
             created_at=datetime(2024, 1, 1))
    d = post_to_dict(p)
    assert d["title"] == "Hello"
    assert d["user_id"] == 1
"#).unwrap();

        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Add a `role` field (TEXT, NOT NULL, default 'user') to the users table. \
             Update ALL files in {d} consistently:\n\
             1. schema.sql — add the column\n\
             2. migrate_001.sql — add the column\n\
             3. models.py — add the field to User dataclass and user_to_dict\n\
             4. seed_data.json — add role to each seed user (alice='admin', bob='user', carol='moderator')\n\
             5. test_models.py — update the test to include the role field\n\
             All five files must be updated.")),
            vec![complete(),
                 file_has("schema.sql", &["role"]),
                 file_has("migrate_001.sql", &["role"]),
                 file_has("models.py", &["role"]),
                 file_has("models.py", &["\"role\""]),
                 file_has("seed_data.json", &["admin", "moderator"]),
                 file_has("test_models.py", &["role"])])
    }
    v.push(scen!("hard_schema_migration_cascade", Category::CrossFile, Difficulty::Hard, I, s_schema_migration_cascade));
}
