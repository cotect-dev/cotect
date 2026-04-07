//! Targeted code-edit scenarios — precise patches in existing source files.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    // ── Easy ────────────────────────────────────────────────────────────

    fn s_add_type_annotation(dir: &Path) -> SetupResult {
        let p = ap(dir, "greet.py");
        std::fs::write(&p, "\
def greet(name):
    return f'Hello, {name}!'
").unwrap();
        with_scope(with_checks(pf(format!(
            "Add type annotations to the function in {p}: `name` should be `str` and the return type should be `str`.")),
            vec![complete(), file_has("greet.py", &["name: str", "-> str"])]),
            vec![p])
    }
    v.push(scen!("patch_add_type_hints", Category::Patch, Difficulty::Easy, I, s_add_type_annotation));

    fn s_add_default_param(dir: &Path) -> SetupResult {
        let p = ap(dir, "config.py");
        std::fs::write(&p, "\
def connect(host, port, timeout):
    \"\"\"Connect to a server.\"\"\"\n    print(f'Connecting to {host}:{port} (timeout={timeout}s)')
").unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, add default values: `host` should default to 'localhost', `port` to 8080, and `timeout` to 30.")),
            vec![complete(),
                 file_has("config.py", &["host='localhost'", "port=8080", "timeout=30"]),
                 file_lacks("config.py", &["def connect(host, port, timeout):"])]),
            vec![p])
    }
    v.push(scen!("patch_add_defaults", Category::Patch, Difficulty::Easy, I, s_add_default_param));

    fn s_add_docstring(dir: &Path) -> SetupResult {
        let p = ap(dir, "math_utils.py");
        std::fs::write(&p, "\
def clamp(value, lo, hi):
    if value < lo:
        return lo
    if value > hi:
        return hi
    return value
").unwrap();
        with_scope(with_checks(pf(format!(
            "Add a docstring to the `clamp` function in {p} explaining what it does, its parameters, and return value.")),
            vec![complete(), file_has("math_utils.py", &["\"\"\"", "value", "lo", "hi", "def clamp"])]),
            vec![p])
    }
    v.push(scen!("patch_add_docstring", Category::Patch, Difficulty::Easy, I, s_add_docstring));

    // ── Medium ──────────────────────────────────────────────────────────

    fn s_add_method_to_class(dir: &Path) -> SetupResult {
        let p = ap(dir, "user.ts");
        std::fs::write(&p, r#"export class User {
  constructor(
    public firstName: string,
    public lastName: string,
    public email: string
  ) {}

  getFullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Add a method `getInitials(): string` to the User class in {p} that returns the first letter \
             of firstName and lastName concatenated (e.g. 'JD' for John Doe). Also add a method \
             `getDomain(): string` that returns the part of the email after '@'.")),
            vec![complete(),
                 file_has("user.ts", &["getInitials()", "getDomain()", "firstName", "lastName", "@", "getFullName"]),
                 ]),
            vec![p])
    }
    v.push(scen!("patch_add_methods", Category::Patch, Difficulty::Medium, I, s_add_method_to_class));

    fn s_replace_deprecated(dir: &Path) -> SetupResult {
        let p = ap(dir, "dates.py");
        std::fs::write(&p, r#"from datetime import datetime

def parse_date(text: str) -> datetime:
    return datetime.utcnow()

def format_date(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d")

def days_until_newyear() -> int:
    now = datetime.utcnow()
    ny = datetime(now.year + 1, 1, 1)
    return (ny - now).days
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, `datetime.utcnow()` is deprecated since Python 3.12. Replace all occurrences \
             with `datetime.now(timezone.utc)`. You'll need to also import `timezone` from `datetime`.")),
            vec![complete(),
                 file_has("dates.py", &["timezone", "datetime.now(timezone.utc)"]),
                 file_lacks("dates.py", &["utcnow()"])]),
            vec![p])
    }
    v.push(scen!("patch_replace_deprecated", Category::Patch, Difficulty::Medium, I, s_replace_deprecated));

    fn s_add_guard_clauses(dir: &Path) -> SetupResult {
        let p = ap(dir, "process.ts");
        std::fs::write(&p, r#"export function processPayment(amount: number, currency: string, cardNumber: string): string {
  const total = amount * getRate(currency);
  const masked = cardNumber.slice(-4);
  return `Charged ${total.toFixed(2)} ${currency} to card ending ${masked}`;
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Add input validation guard clauses to the function in {p}:\n\
             - Throw if `amount` is <= 0\n\
             - Throw if `currency` is empty\n\
             - Throw if `cardNumber` length is less than 13\n\
             Add these at the top of the function before any logic.")),
            vec![complete(),
                 file_has("process.ts", &["throw", "amount", "currency", "cardNumber", "13"]),
                 file_has("process.ts", &["getRate"])]),
            vec![p])
    }
    v.push(scen!("patch_add_guards", Category::Patch, Difficulty::Medium, I, s_add_guard_clauses));

    fn s_add_logging(dir: &Path) -> SetupResult {
        let p = ap(dir, "service.py");
        std::fs::write(&p, r#"import requests

def fetch_data(url: str) -> dict:
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    return response.json()

def post_data(url: str, payload: dict) -> dict:
    response = requests.post(url, json=payload, timeout=10)
    response.raise_for_status()
    return response.json()
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Add Python `logging` to {p}: \
             1) Import logging and create a module-level logger: `logger = logging.getLogger(__name__)`\n\
             2) Log the URL at INFO level before each request\n\
             3) Log errors at ERROR level if an exception is raised (use try/except, re-raise after logging)")),
            vec![complete(),
                 file_has("service.py", &["import logging", "getLogger", "logger.info", "except"]),
                 file_has("service.py", &["raise"])]),
            vec![p])
    }
    v.push(scen!("patch_add_logging", Category::Patch, Difficulty::Medium, I, s_add_logging));

    // ── Hard ────────────────────────────────────────────────────────────

    fn s_add_generics(dir: &Path) -> SetupResult {
        let p = ap(dir, "repo.ts");
        std::fs::write(&p, r#"export class Repository {
  private items: any[] = [];

  add(item: any): void {
    this.items.push(item);
  }

  getById(id: string): any {
    return this.items.find((item: any) => item.id === id);
  }

  getAll(): any[] {
    return [...this.items];
  }

  remove(id: string): boolean {
    const idx = this.items.findIndex((item: any) => item.id === id);
    if (idx === -1) return false;
    this.items.splice(idx, 1);
    return true;
  }
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Refactor the Repository class in {p} to be generic: `Repository<T extends {{ id: string }}>`. \
             Replace all `any` types with the generic parameter `T`. Keep the logic identical.")),
            vec![complete(),
                 file_has("repo.ts", &["Repository<T", "extends", "id: string", "items: T[]", "getAll(): T[]"]),
                 file_lacks("repo.ts", &[": any", "any[]"])]),
            vec![p])
    }
    v.push(scen!("patch_add_generics", Category::Patch, Difficulty::Hard, I, s_add_generics));

    fn s_convert_to_typescript(dir: &Path) -> SetupResult {
        let p = ap(dir, "helpers.js");
        std::fs::write(&p, r#"export function flatten(arr) {
  return arr.reduce((acc, val) =>
    Array.isArray(val) ? acc.concat(flatten(val)) : acc.concat(val), []);
}

export function groupBy(arr, key) {
  return arr.reduce((groups, item) => {
    const val = item[key];
    groups[val] = groups[val] || [];
    groups[val].push(item);
    return groups;
  }, {});
}

export function debounce(fn, ms) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}
"#).unwrap();
        let tp = ap(dir, "helpers.ts");
        with_scope(with_checks(pf(format!(
            "Convert the JavaScript file at {p} to TypeScript at {tp}. \
             Add proper type annotations to all function parameters and return types. \
             Use generics where appropriate (e.g. flatten should work on nested arrays of any type, \
             groupBy should be generic over the item type).")),
            vec![complete(),
                 file_has("helpers.ts", &["function flatten", "function groupBy", "function debounce"]),
                 file_has("helpers.ts", &["<T>", ": number", "Record<"])]),
            vec![p])
    }
    v.push(scen!("patch_js_to_typescript", Category::Patch, Difficulty::Hard, I, s_convert_to_typescript));

    fn s_add_tests(dir: &Path) -> SetupResult {
        let p = ap(dir, "math_utils.py");
        let tp = ap(dir, "test_math_utils.py");
        std::fs::write(&p, r#"def gcd(a: int, b: int) -> int:
    """Return the greatest common divisor of a and b."""
    while b:
        a, b = b, a % b
    return a

def lcm(a: int, b: int) -> int:
    """Return the least common multiple of a and b."""
    return abs(a * b) // gcd(a, b)

def is_prime(n: int) -> bool:
    """Return True if n is a prime number."""
    if n < 2:
        return False
    for i in range(2, int(n**0.5) + 1):
        if n % i == 0:
            return False
    return True
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}, then create a test file at {tp} using pytest. Write at least 3 tests for each \
             function (gcd, lcm, is_prime) — including edge cases like 0, 1, negative numbers, and primes.")),
            vec![complete(),
                 file_has("test_math_utils.py", &["def test_", "gcd", "lcm", "is_prime", "assert"]),
                 file_has("test_math_utils.py", &["import"])]),
            vec![p])
    }
    v.push(scen!("patch_write_tests", Category::Patch, Difficulty::Hard, I, s_add_tests));
}
