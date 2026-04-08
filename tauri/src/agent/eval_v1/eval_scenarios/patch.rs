//! Targeted code-edit scenarios — precise patches in existing source files.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    // ── Medium ──────────────────────────────────────────────────────────

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
