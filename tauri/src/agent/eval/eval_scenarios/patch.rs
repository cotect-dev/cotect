//! Targeted code-edit scenarios — precise patches in existing source files.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {

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
            "Instrument the HTTP helpers in {p} with Python `logging`. \
             Each request (both GET and POST) should produce a log record at INFO level that \
             references the target URL before the network call is made. \
             If a request raises, the error must be recorded (ERROR level or equivalent) and the \
             exception must still propagate to the caller (do not silently swallow it).")),
            vec![complete(),
                 file_has("service.py", &["import logging", "getLogger", ".info("]),
                 file_has("service.py", &["try:", "except"])]),
            vec![p])
    }
    v.push(scen!("patch_add_logging", Category::Patch, Difficulty::Medium, I, s_add_logging));


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
            "Make the Repository class in {p} generic so callers can store any item type that \
             carries a string `id` field, while keeping the existing behaviour of every method \
             untouched. The class should no longer rely on `any` for the stored item type.")),
            vec![complete(),
                 file_has("repo.ts", &["Repository<", "extends", "id"]),
                 file_lacks("repo.ts", &[": any", "any[]", "Array<any>"])]),
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
            "Port the helpers in {p} over to TypeScript at {tp}, preserving behaviour. \
             Every exported helper must have typed parameters and a typed return value, and \
             the API should stay usable for callers working with arbitrary element types \
             (i.e. not erased to `any`).")),
            vec![complete(),
                 file_has("helpers.ts", &["flatten", "groupBy", "debounce", "export"]),
                 file_has("helpers.ts", &["<", ": "]),
                 file_lacks("helpers.ts", &[": any", "<any>", "any[]", "as any"])]),
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
            "Read {p} and add a companion test file at {tp} that covers all three functions it \
             exports. The suite should exercise each function with several inputs, including \
             the tricky corners of their domains, so that a regression in any branch would fail \
             at least one test. The file must be runnable under pytest as-is.")),
            vec![complete(),
                 file_has("test_math_utils.py", &["def test_", "gcd", "lcm", "is_prime", "assert"]),
                 file_has("test_math_utils.py", &["math_utils"])]),
            vec![p])
    }
    v.push(scen!("patch_write_tests", Category::Patch, Difficulty::Hard, I, s_add_tests));
}
