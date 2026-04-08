//! Bugfix scenarios — the agent must identify and fix real bugs in code.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    // ── Medium ──────────────────────────────────────────────────────────

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
