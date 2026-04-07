//! Bugfix scenarios — the agent must identify and fix real bugs in code.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    // ── Easy ────────────────────────────────────────────────────────────

    fn s_off_by_one(dir: &Path) -> SetupResult {
        let p = ap(dir, "range.py");
        std::fs::write(&p, "\
def print_items(items):
    \"\"\"Print every item in the list.\"\"\"
    for i in range(1, len(items)):
        print(items[i])
").unwrap();
        with_scope(with_checks(pf(format!(
            "The function in {p} is supposed to print every item in the list, but it skips the first one. Fix the off-by-one error.")),
            vec![complete(),
                 file_lacks("range.py", &["range(1,"])]),
            vec![p])
    }
    v.push(scen!("bugfix_off_by_one", Category::Bugfix, Difficulty::Easy, I, s_off_by_one));

    fn s_wrong_operator(dir: &Path) -> SetupResult {
        let p = ap(dir, "discount.ts");
        std::fs::write(&p, "\
export function applyDiscount(price: number, percent: number): number {
  // Should reduce price by the given percentage
  return price + price * (percent / 100);
}
").unwrap();
        with_scope(with_checks(pf(format!(
            "The function in {p} should reduce the price by a percentage, but it increases it instead. Fix the bug.")),
            vec![complete(), file_has("discount.ts", &["price -", "price * (percent / 100)"]),
                 file_lacks("discount.ts", &["price + price *"])]),
            vec![p])
    }
    v.push(scen!("bugfix_wrong_operator", Category::Bugfix, Difficulty::Easy, I, s_wrong_operator));

    fn s_missing_return(dir: &Path) -> SetupResult {
        let p = ap(dir, "validate.py");
        std::fs::write(&p, "\
def is_valid_email(email: str) -> bool:
    \"\"\"Return True if the email contains exactly one '@' and at least one '.' after it.\"\"\"
    if '@' not in email:
        return False
    local, domain = email.split('@', 1)
    if '.' not in domain:
        return False
    if len(local) == 0 or len(domain) < 3:
        return False
    # All checks passed — but forgot to return True
").unwrap();
        with_scope(with_checks(pf(format!(
            "The function in {p} validates emails but never returns True when validation passes. Fix it.")),
            vec![complete(), file_has("validate.py", &["return True"])]),
            vec![p])
    }
    v.push(scen!("bugfix_missing_return", Category::Bugfix, Difficulty::Easy, I, s_missing_return));

    // ── Medium ──────────────────────────────────────────────────────────

    fn s_mutation_in_loop(dir: &Path) -> SetupResult {
        let p = ap(dir, "filter.rs");
        std::fs::write(&p, r#"pub fn remove_negatives(numbers: &mut Vec<i32>) {
    for i in 0..numbers.len() {
        if numbers[i] < 0 {
            numbers.remove(i);
        }
    }
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "The function in {p} tries to remove negative numbers from a Vec, but it will panic or skip \
             elements because it mutates the Vec while iterating by index. Fix it so it correctly removes \
             all negative numbers. A common approach is to use `retain`.")),
            vec![complete(), file_has("filter.rs", &["retain"]),
                 file_lacks("filter.rs", &["numbers.remove(i)"])]),
            vec![p])
    }
    v.push(scen!("bugfix_mutation_in_loop", Category::Bugfix, Difficulty::Medium, I, s_mutation_in_loop));

    fn s_equality_vs_assignment(dir: &Path) -> SetupResult {
        let p = ap(dir, "auth.js");
        std::fs::write(&p, "\
function checkAccess(user) {
  if (user.role = 'admin') {
    return true;
  }
  if (user.role = 'editor' && user.verified) {
    return true;
  }
  return false;
}
").unwrap();
        with_scope(with_checks(pf(format!(
            "The function in {p} has a critical bug: it uses assignment (=) instead of comparison (=== or ==) \
             in the if-conditions. Fix all occurrences.")),
            vec![complete(), file_has("auth.js", &["==="]),
                 file_lacks("auth.js", &["user.role = 'admin'", "user.role = 'editor'"])]),
            vec![p])
    }
    v.push(scen!("bugfix_assign_vs_compare", Category::Bugfix, Difficulty::Medium, I, s_equality_vs_assignment));

    fn s_async_missing_await(dir: &Path) -> SetupResult {
        let p = ap(dir, "fetcher.ts");
        std::fs::write(&p, "\
export async function fetchUserName(id: string): Promise<string> {
  const response = fetch(`/api/users/${id}`);
  const data = response.json();
  return data.name;
}
").unwrap();
        with_scope(with_checks(pf(format!(
            "The async function in {p} calls fetch() and .json() without await, so it operates on \
             Promise objects instead of resolved values. Add the missing await keywords.")),
            vec![complete(), file_has("fetcher.ts", &["await fetch", "await response.json()"]),
                 file_lacks("fetcher.ts", &["\n  const response = fetch(", "\n  const data = response.json()"])]),
            vec![p])
    }
    v.push(scen!("bugfix_missing_await", Category::Bugfix, Difficulty::Medium, I, s_async_missing_await));

    fn s_wrong_scope(dir: &Path) -> SetupResult {
        let p = ap(dir, "counter.py");
        std::fs::write(&p, "\
total = 0

def add_to_total(value):
    total = total + value

def get_total():
    return total
").unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, the add_to_total function tries to modify the module-level `total` variable but \
             creates a local variable instead (UnboundLocalError). Fix it by adding the `global` \
             declaration or by restructuring the code.")),
            vec![complete(), file_has("counter.py", &["global total"])]),
            vec![p])
    }
    v.push(scen!("bugfix_python_scope", Category::Bugfix, Difficulty::Medium, I, s_wrong_scope));

    // ── Hard ────────────────────────────────────────────────────────────

    fn s_sql_injection(dir: &Path) -> SetupResult {
        let p = ap(dir, "db.py");
        std::fs::write(&p, r#"import sqlite3

def find_user(conn: sqlite3.Connection, username: str):
    """Find a user by username."""
    query = f"SELECT * FROM users WHERE username = '{username}'"
    cursor = conn.execute(query)
    return cursor.fetchone()

def delete_user(conn: sqlite3.Connection, user_id: int):
    """Delete a user by ID."""
    query = f"DELETE FROM users WHERE id = {user_id}"
    conn.execute(query)
    conn.commit()
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Both functions in {p} are vulnerable to SQL injection because they use f-string interpolation. \
             Refactor them to use parameterized queries (placeholders like '?') instead.")),
            vec![complete(),
                 file_has("db.py", &["?"]),
                 file_lacks("db.py", &["f\"SELECT", "f\"DELETE"])]),
            vec![p])
    }
    v.push(scen!("bugfix_sql_injection", Category::Bugfix, Difficulty::Hard, I, s_sql_injection));

    fn s_race_condition(dir: &Path) -> SetupResult {
        let p = ap(dir, "cache.go");
        std::fs::write(&p, r#"package cache

var store = make(map[string]string)

func Get(key string) (string, bool) {
	val, ok := store[key]
	return val, ok
}

func Set(key, value string) {
	store[key] = value
}

func Delete(key string) {
	delete(store, key)
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "The cache in {p} uses a plain map accessed by Get/Set/Delete without any synchronisation. \
             In Go, concurrent map access causes a fatal runtime panic. Fix it by protecting the map \
             with a sync.Mutex or sync.RWMutex.")),
            vec![complete(),
                 file_has("cache.go", &["sync."]),
                 file_has("cache.go", &["Lock()", "Unlock()"]),
                 file_lacks("cache.go", &["\nvar store = make(map[string]string)\n"])]),
            vec![p])
    }
    v.push(scen!("bugfix_race_condition_go", Category::Bugfix, Difficulty::Hard, I, s_race_condition));

    fn s_resource_leak(dir: &Path) -> SetupResult {
        let p = ap(dir, "reader.py");
        std::fs::write(&p, r#"def count_lines(path: str) -> int:
    """Count non-empty lines in a file."""
    f = open(path, "r")
    count = 0
    for line in f:
        if line.strip():
            count += 1
    return count

def read_json(path: str):
    """Read and parse a JSON file."""
    import json
    f = open(path, "r")
    data = json.load(f)
    return data
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Both functions in {p} open files but never close them, causing resource leaks. \
             Refactor both to use `with` statements (context managers) so the files are always closed.")),
            vec![complete(),
                 file_has("reader.py", &["with open"]),
                 file_lacks("reader.py", &["\n    f = open("])]),
            vec![p])
    }
    v.push(scen!("bugfix_resource_leak", Category::Bugfix, Difficulty::Hard, I, s_resource_leak));
}
