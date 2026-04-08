//! Hard scenarios — 25 devious challenges designed to trip up even
//! frontier models. Every scenario contains a "gotcha": a red herring,
//! an unintuitive answer, a multi-file dependency chain, or a subtle
//! semantic trap that requires genuine reasoning rather than pattern-matching.

use std::path::Path;

use crate::agent::types::AgentRole::{Implement as I, Research as R, Plan as P};
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {

    // ────────────────────────────────────────────────────────────────────
    // 1. BUGFIX — Shadow variable trap
    //    The obvious "bug" (an unused import) is a decoy. The real bug is
    //    a variable shadowing issue in a helper function that silently
    //    returns the wrong value.
    // ────────────────────────────────────────────────────────────────────

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
        with_scope(with_checks(pf(format!(
            "The function `calculate_total` in {p} is supposed to apply an 8% tax and \
             a $5 discount for orders over $100, but the discount is never actually applied. \
             Find and fix the bug. The discount must be subtracted from the subtotal before adding tax.")),
            vec![complete(),
                 file_has("billing.py", &["discount"]),
                 file_has("billing.py", &["subtotal - discount"]),
                 file_lacks("billing.py", &["total = subtotal + tax"])]),
            vec![p])
    }
    v.push(scen!("hard_shadow_variable_trap", Category::Bugfix, Difficulty::Hard, I, s_shadow_variable_trap));

    // ────────────────────────────────────────────────────────────────────
    // 2. BUGFIX — Red herring across files
    //    The prompt says "there's a bug in api.py". The obvious issue in
    //    api.py is actually correct. The real bug is in validator.py
    //    where a regex is wrong. The model must read BOTH files.
    // ────────────────────────────────────────────────────────────────────

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
        with_scope(with_checks(pf(format!(
            "Users report that `register_user` in {api} rejects valid emails like 'user@example.com'. \
             Find the bug and fix it. Read all relevant files.")),
            vec![complete(),
                 // The fix must be in validator.py — the regex TLD length
                 file_has("validator.py", &["{2,"]),
                 file_lacks("validator.py", &[r#"[a-zA-Z]{2}$"#])]),
            vec![api, validator])
    }
    v.push(scen!("hard_red_herring_cross_file", Category::Bugfix, Difficulty::Hard, I, s_red_herring_cross_file));

    // ────────────────────────────────────────────────────────────────────
    // 3. BUGFIX — Unicode string slicing
    //    Looks like simple string processing but breaks on emoji/multi-byte.
    //    The model must realize Python str indexing is by code point, not
    //    byte, and that the REAL bug is using len() check before a
    //    different encoding operation.
    // ────────────────────────────────────────────────────────────────────

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
        with_scope(with_checks(pf(format!(
            "The function in {p} is supposed to truncate a string so its UTF-8 encoding \
             fits within a byte limit, but it compares code points to bytes and slices incorrectly. \
             Fix it to properly count UTF-8 bytes and truncate without splitting multi-byte characters.")),
            vec![complete(),
                 file_has("truncate.py", &["encode"]),
                 file_lacks("truncate.py", &["if len(text) <= max_bytes:", "return text[:max_bytes]"])]),
            vec![p])
    }
    v.push(scen!("hard_unicode_truncation", Category::Bugfix, Difficulty::Hard, I, s_unicode_truncation));

    // ────────────────────────────────────────────────────────────────────
    // 4. UNDERSTANDING — JavaScript closure-in-loop trap
    //    Classic gotcha: var in a for loop shares the closure variable.
    //    The model must report the exact (counterintuitive) output.
    // ────────────────────────────────────────────────────────────────────

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
             Trace the execution carefully — pay attention to `var` scoping in the loop. \
             State your final answer as the last number in your reply.")),
            // All closures capture the final value of i (which is 4 after the loop).
            // Each returns 4*4 = 16. Sum = 64.
            vec![complete(), succeeded("read"), num(64)]),
            vec![p])
    }
    v.push(scen!("hard_closure_in_loop", Category::Understanding, Difficulty::Hard, R, s_closure_in_loop));

    // ────────────────────────────────────────────────────────────────────
    // 5. UNDERSTANDING — Python operator precedence trap
    //    `not`, `and`, `or`, `in`, comparison chaining. The answer is
    //    counterintuitive.
    // ────────────────────────────────────────────────────────────────────

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
             Trace each computation carefully, paying attention to operator precedence \
             and Python's treatment of booleans as integers. \
             State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("read"), num(43)]),
            vec![p])
    }
    v.push(scen!("hard_precedence_trap", Category::Understanding, Difficulty::Hard, R, s_precedence_trap));

    // ────────────────────────────────────────────────────────────────────
    // 6. UNDERSTANDING — Mutable default argument + aliasing
    //    The function mutates a default list, causing state leak between
    //    calls. The model must correctly trace three separate calls.
    // ────────────────────────────────────────────────────────────────────

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
             Be careful about Python's mutable default argument behavior. \
             Remember that `a` and `b` may refer to the same list object. \
             State your final answer as the last number in your reply.")),
            // a and b share the same default list. After append_to(1), default=[1].
            // After append_to(2), default=[1,2]. a and b both point to [1,2], so len=2 each.
            // c gets a fresh list [3], len=1.
            // Total: 2 + 2 + 1 = 5
            vec![complete(), succeeded("read"), num(5)]),
            vec![p])
    }
    v.push(scen!("hard_mutable_default_arg", Category::Understanding, Difficulty::Hard, R, s_mutable_default));

    // ────────────────────────────────────────────────────────────────────
    // 7. SEARCH — Needle in haystack with decoys
    //    20 files, some contain "TODO" inside strings or variable names
    //    (decoys), only specific ones are actual TODO comments. Must
    //    count precisely.
    // ────────────────────────────────────────────────────────────────────

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

    // ────────────────────────────────────────────────────────────────────
    // 8. SEARCH — Cross-file data flow tracing
    //    A value passes through 5 files via imports. One file silently
    //    transforms it. The model must trace the full chain.
    // ────────────────────────────────────────────────────────────────────

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
            "The report generated by {d}/pipeline/report.py shows 'Current tax rate: 20.0%' \
             but it should show '20%' as a properly formatted percentage. However, there's a deeper \
             issue: trace the value from source.py through to report.py. The raw rate is 0.15 (15%), \
             adjusted to 0.20 (20%). In which file is the rate incorrectly multiplied by 100, \
             and what is the actual displayed percentage? Trace all intermediate values. \
             State the actual incorrect display percentage as the last number in your reply.")),
            vec![complete(), used_any(&["fs_search", "read"]),
                 oc_all(&["convert.py", "100"]),
                 // After multiply by 100, DISPLAY_RATE = 20.0, so format_rate returns "20.0%"
                 // but this is actually 2000% of the original, which is wrong.
                 // The raw display is 20.0 but it represents 0.20 * 100 = 20.0
                 num(20)])
    }
    v.push(scen!("hard_data_flow_trace", Category::Search, Difficulty::Hard, R, s_data_flow_trace));

    // ────────────────────────────────────────────────────────────────────
    // 9. CROSS-FILE — Config contradicts implementation
    //    config.json says max 5 retries, but the code hard-codes 3.
    //    The model must update BOTH to be consistent (use config value).
    // ────────────────────────────────────────────────────────────────────

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
            "The client in {client} is supposed to use the retry count from {cfg}, \
             but it hard-codes the value. Find all places where the hard-coded retry count \
             is used and replace them with the config value. The config says max_retries=5.")),
            vec![complete(),
                 file_has("client.py", &["config[\"max_retries\"]"]),
                 file_lacks("client.py", &["range(3)", "attempt < 2"])]),
            vec![client, cfg])
    }
    v.push(scen!("hard_config_code_mismatch", Category::CrossFile, Difficulty::Hard, I, s_config_code_mismatch));

    // ────────────────────────────────────────────────────────────────────
    // 10. CROSS-FILE — Diamond dependency update
    //     Four files form a diamond: base -> (left, right) -> consumer.
    //     Adding a required field to base means all four must be updated
    //     consistently.
    // ────────────────────────────────────────────────────────────────────

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
            "Add a required `ipAddress: string` field to the `RequestContext` interface in {d}/base.ts. \
             Then update ALL files that create or use RequestContext consistently:\n\
             - `createContext` must accept and include ipAddress\n\
             - `logRequest` should log the IP address\n\
             - `handleRequest` must pass an IP address (use '127.0.0.1' as default)\n\
             Every file must compile. Update all four files.")),
            vec![complete(),
                 file_has("base.ts", &["ipAddress: string"]),
                 file_has("base.ts", &["ipAddress"]),
                 file_has("logging.ts", &["ipAddress"]),
                 file_has("app.ts", &["127.0.0.1"])])
    }
    v.push(scen!("hard_diamond_dependency", Category::CrossFile, Difficulty::Hard, I, s_diamond_dependency));

    // ────────────────────────────────────────────────────────────────────
    // 11. CROSS-FILE — Hidden re-export chain
    //     Must follow re-exports through 4 files to find where a function
    //     is actually defined, then fix the bug at the source.
    // ────────────────────────────────────────────────────────────────────

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
        with_scope(with_checks(pf(format!(
            "The function `normalize_name` imported in {d}/main.py strips hyphens and apostrophes \
             from names like \"Mary-Jane O'Brien\", turning it into \"Maryjane Obrien\". \
             Trace the import chain to find the actual implementation and fix it to preserve \
             hyphens and apostrophes in names.")),
            vec![complete(),
                 // Must find and fix in lib/core.py
                 file_has("lib/core.py", &["-"]),
                 file_has("lib/core.py", &["'"]),
                 // The regex should allow hyphens and apostrophes
                 file_lacks("lib/core.py", &["[^a-zA-Z\\s]"])]),
            vec![ap(dir, "main.py")])
    }
    v.push(scen!("hard_reexport_chain_trace", Category::CrossFile, Difficulty::Hard, I, s_reexport_chain));

    // ────────────────────────────────────────────────────────────────────
    // 12. IMPLEMENT — Modular exponentiation (gotcha: naive approach overflows)
    //     Must implement binary exponentiation with modulo, not just
    //     pow(base, exp) % mod which works in Python but shows understanding.
    // ────────────────────────────────────────────────────────────────────

    fn s_modular_exponentiation(dir: &Path) -> SetupResult {
        let p = ap(dir, "modpow.py");
        with_checks(pf(format!(
            "Create a Python file at {p} implementing `modpow(base: int, exp: int, mod: int) -> int` \
             that computes (base^exp) % mod efficiently using binary exponentiation (repeated squaring). \
             Do NOT simply use Python's built-in pow(base, exp, mod) — implement the algorithm yourself. \
             Handle edge cases: exp=0 should return 1 (if mod>1, else 0), mod=1 should always return 0. \
             Include a `if __name__ == '__main__'` block that prints modpow(2, 100, 1000000007).")),
            vec![complete(),
                 file_has("modpow.py", &["def modpow"]),
                 file_has("modpow.py", &["__name__"]),
                 // Must implement the squaring loop, not delegate to built-in pow
                 file_lacks("modpow.py", &["pow(base, exp, mod)", "pow(b, e, m)"]),
                 // Must have the core loop mechanism
                 file_has("modpow.py", &["while", "%"])])
    }
    v.push(scen!("hard_impl_modpow", Category::Implement, Difficulty::Hard, I, s_modular_exponentiation));

    // ────────────────────────────────────────────────────────────────────
    // 13. IMPLEMENT — Topological sort with cycle detection
    //     Must handle disconnected graphs AND detect cycles properly.
    // ────────────────────────────────────────────────────────────────────

    fn s_topo_sort_with_cycles(dir: &Path) -> SetupResult {
        let p = ap(dir, "topo.py");
        with_checks(pf(format!(
            "Create a Python file at {p} implementing:\n\
             1. `topo_sort(graph: dict[str, list[str]]) -> list[str]` — Kahn's algorithm or DFS-based \
                topological sort. The graph is an adjacency list where keys are nodes and values are \
                lists of nodes they depend on (edges point FROM dependency TO dependent).\n\
             2. It must raise `CycleError` (custom exception) if the graph contains a cycle.\n\
             3. It must handle disconnected components.\n\
             4. Include an `if __name__ == '__main__'` block demonstrating both a valid DAG and a cycle.\n\
             Example: `{{'a': [], 'b': ['a'], 'c': ['a', 'b']}}` means b depends on a, c depends on a and b. \
             Valid order: ['a', 'b', 'c'].")),
            vec![complete(),
                 file_has("topo.py", &["def topo_sort", "class CycleError", "raise CycleError", "__name__"])])
    }
    v.push(scen!("hard_impl_topo_sort", Category::Implement, Difficulty::Hard, I, s_topo_sort_with_cycles));

    // ────────────────────────────────────────────────────────────────────
    // 14. REFACTOR — Behavior-preserving with hidden side effects
    //     The function looks like it just computes a value, but it also
    //     writes to a log file as a side effect. Naive refactoring breaks
    //     the logging.
    // ────────────────────────────────────────────────────────────────────

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
        with_scope(with_checks(pf(format!(
            "Refactor {p}: split `process_transaction` into three functions:\n\
             - `validate_transaction(user_id, amount, tx_type)` — returns None if valid, error dict otherwise\n\
             - `calculate_fee(amount, tx_type)` — returns the fee amount\n\
             - `process_transaction(user_id, amount, tx_type)` — orchestrator that calls the above\n\
             CRITICAL: All audit logging to `_audit_log` must be preserved exactly as before, including \
             the rejection logs in validation failures. Do not lose any logging.")),
            vec![complete(),
                 file_has("processor.py", &["def validate_transaction", "def calculate_fee", "def process_transaction"]),
                 // Audit logging must still exist
                 file_has("processor.py", &["_audit_log.append", "REJECTED", "OK"]),
                 // get_audit_log must still exist
                 file_has("processor.py", &["def get_audit_log"])]),
            vec![p])
    }
    v.push(scen!("hard_refactor_preserve_side_effects", Category::Refactor, Difficulty::Hard, I, s_refactor_with_side_effects));

    // ────────────────────────────────────────────────────────────────────
    // 15. REFACTOR — Extract with entangled mutable state
    //     Two functions both read and write a shared dict. Must refactor
    //     into a class without breaking the shared-state semantics.
    // ────────────────────────────────────────────────────────────────────

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

    // ────────────────────────────────────────────────────────────────────
    // 16. PATCH — Surgical edit in repetitive generated code
    //     300 lines of near-identical handlers. Must change exactly ONE
    //     without using replace_all and without breaking neighbors.
    // ────────────────────────────────────────────────────────────────────

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

    // ────────────────────────────────────────────────────────────────────
    // 17. PATCH — TypeScript edit where the obvious fix breaks types
    //     Adding a method is straightforward, but the generic constraint
    //     makes the naive approach fail. Must add a type guard.
    // ────────────────────────────────────────────────────────────────────

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
            "Add the following methods to the Store class in {p}:\n\
             1. `findBy<K extends keyof T>(key: K, value: T[K]): T[]` — find items where item[key] === value\n\
             2. `update(id: string, partial: Partial<Omit<T, 'id'>>): boolean` — update fields of an item (but never change its id)\n\
             3. `count(): number` — return the number of items\n\
             The methods must be type-safe: `update` must not allow changing the `id` field, \
             and `findBy` must enforce that the value type matches the key's type.")),
            vec![complete(),
                 file_has("store.ts", &["findBy", "keyof", "update", "Partial", "Omit", "count()"]),
                 file_has("store.ts", &["'id'"]),
                 // Must keep existing methods
                 file_has("store.ts", &["add(item", "get(id", "remove(id", "getAll()"])]),
            vec![p])
    }
    v.push(scen!("hard_type_constraint_edit", Category::Patch, Difficulty::Hard, I, s_type_constraint_edit));

    // ────────────────────────────────────────────────────────────────────
    // 18. ERROR HANDLING — Exception hierarchy ordering trap
    //     Python except clauses are checked top-to-bottom. If a parent
    //     class comes first, children never match. Model must reorder.
    // ────────────────────────────────────────────────────────────────────

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
            "The exception handling in {p} has a critical ordering bug. The `except AppError` clause \
             catches all custom exceptions (NotFoundError, PermissionError, ValidationError) before \
             their specific handlers can run. Also, Python's built-in PermissionError shadows our custom one. \
             Fix the except clause ordering so specific exceptions are caught before general ones, \
             and fix the naming conflict with the built-in PermissionError.")),
            vec![complete(),
                 // AppError must come AFTER its children, or be removed
                 file_lacks("handler.py", &["    except AppError:\n        return {\"error\": \"Application error"]),
                 // The specific handlers must exist
                 file_has("handler.py", &["except ValidationError", "except json.JSONDecodeError", "except FileNotFoundError"])]),
            vec![p])
    }
    v.push(scen!("hard_exception_ordering", Category::ErrorHandling, Difficulty::Hard, I, s_exception_ordering));

    // ────────────────────────────────────────────────────────────────────
    // 19. ERROR HANDLING — Async error swallowing
    //     A Promise chain silently drops errors because .then() doesn't
    //     re-throw and there's no .catch() on the inner promise.
    // ────────────────────────────────────────────────────────────────────

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
            "The async pipeline in {p} has error handling bugs: the `transform` function calls \
             `validate` without `await`, meaning validation errors are silently dropped and the \
             result contains an unresolved Promise instead of actual data. \
             Fix the entire pipeline so that:\n\
             1. All async calls are properly awaited\n\
             2. Errors from any stage propagate to the caller\n\
             3. The result contains actual data, not Promise objects")),
            vec![complete(),
                 file_has("pipeline.ts", &["await validate"]),
                 file_lacks("pipeline.ts", &["validate(data).then(d => d)"]),
                 file_lacks("pipeline.ts", &["{ transformed: validated }"])]),
            vec![p])
    }
    v.push(scen!("hard_async_error_swallowing", Category::ErrorHandling, Difficulty::Hard, I, s_async_error_swallowing));

    // ────────────────────────────────────────────────────────────────────
    // 20. RECOVERY — Must read a broken symlink, discover it's broken,
    //     find the real file, and patch it.
    // ────────────────────────────────────────────────────────────────────

    fn s_missing_real_file(dir: &Path) -> SetupResult {
        // Create the actual file at a non-obvious location
        std::fs::create_dir_all(dir.join("data/archive")).ok();
        std::fs::write(dir.join("data/archive/settings.json"), r#"{"theme": "dark", "language": "en", "notifications": true}"#).unwrap();
        // Create a MISLEADING file at the expected location
        std::fs::write(dir.join("config.json"), r#"{"_comment": "This is a placeholder. Real config is in data/archive/settings.json"}"#).unwrap();

        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Read the config file at {d}/config.json and change the `theme` to `\"light\"`. \
             The config may not be where you first expect — follow any redirections.")),
            vec![complete(),
                 // The real edit must happen in the archive file
                 file_has("data/archive/settings.json", &["\"theme\": \"light\""]),
                 file_lacks("data/archive/settings.json", &["\"theme\": \"dark\""])])
    }
    v.push(scen!("hard_recovery_redirect_file", Category::Recovery, Difficulty::Hard, I, s_missing_real_file));

    // ────────────────────────────────────────────────────────────────────
    // 21. RECOVERY — Partially corrupted file requires careful extraction
    //     A valid Python file has a corrupted section. The model must
    //     preserve the good parts and fix only the broken part.
    // ────────────────────────────────────────────────────────────────────

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

    // ────────────────────────────────────────────────────────────────────
    // 22. PLANNING — Architecture with hidden constraints
    //     Must read multiple files to discover that the DB is SQLite
    //     (no concurrent writes), the API is synchronous (Flask), and
    //     there's a file lock mechanism. Plan must account for these.
    // ────────────────────────────────────────────────────────────────────

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
            "Read ALL files under {d}/app/ to understand the architecture, then create a numbered plan \
             for adding real-time WebSocket notifications (e.g., when an item is created or processed). \
             Your plan MUST account for the actual constraints you find in the code: the database type, \
             the concurrency model, the web framework, and the batch worker. At least 6 steps.")),
            vec![complete(), used_any(&["fs_search", "read"]),
                 oc_all(&["1.", "2.", "3.", "4.", "5.", "6."]),
                 // Must mention SQLite limitations
                 oc_any(&["sqlite", "SQLite"]),
                 // Must address the concurrency/WebSocket challenge with Flask
                 oc_any(&["websocket", "WebSocket", "socket", "Socket"]),
                 // Must mention the worker/background process
                 oc_any(&["worker", "batch", "cron", "background"])])
    }
    v.push(scen!("hard_plan_hidden_constraints", Category::Planning, Difficulty::Hard, P, s_plan_with_hidden_constraints));

    // ────────────────────────────────────────────────────────────────────
    // 23. PLANNING — Contradictory requirements in spec
    //     Requirements say "no external dependencies" but also require
    //     JWT authentication and bcrypt password hashing. Model must
    //     identify the contradiction and propose a resolution.
    // ────────────────────────────────────────────────────────────────────

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

    // ────────────────────────────────────────────────────────────────────
    // 24. UNDERSTANDING — Rust borrow checker puzzle
    //     Code that LOOKS like it should compile but doesn't due to
    //     lifetime issues. Model must explain WHY.
    // ────────────────────────────────────────────────────────────────────

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
            "Read {p}. This Rust code will NOT compile. Explain exactly why the borrow checker \
             rejects it, which lifetime constraint is violated, and describe at least two different \
             ways to fix it (e.g., returning an owned String, or extending the scope of `words`).")),
            vec![complete(), succeeded("read"),
                 // Must identify the dangling reference / lifetime issue
                 oc_any(&["borrow", "lifetime", "dangling", "dropped", "scope", "outlive", "borrowed"]),
                 // Must mention that words is dropped while result still references it
                 oc_any(&["words", "drop", "freed", "moved", "destroyed", "scope"]),
                 // Must suggest fixes
                 oc_any(&["String", "owned", "clone", "to_string", "to_owned", "extend", "move"])]),
            vec![p])
    }
    v.push(scen!("hard_rust_borrow_puzzle", Category::Understanding, Difficulty::Hard, R, s_rust_borrow_puzzle));

    // ────────────────────────────────────────────────────────────────────
    // 25. CROSS-FILE — Database schema migration with cascading updates
    //     Must update schema, migration SQL, model code, seed data, AND
    //     test fixtures consistently across 5 files.
    // ────────────────────────────────────────────────────────────────────

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
