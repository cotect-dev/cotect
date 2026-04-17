//! Bugfix scenarios — the agent must identify and fix real bugs in code.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {

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
            "The async function in {p} returns the wrong value — callers get a Promise-related object \
             back instead of the user's name. Make it return the resolved user name as declared by \
             the function signature.")),
            vec![complete(),
                 file_has("fetcher.ts", &["await "]),
                 file_lacks("fetcher.ts", &["\n  const response = fetch(`", "\n  const data = response.json()"])]),
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
        let d = dir.to_string_lossy().into_owned();
        with_scope(with_checks(pf(format!(
            "In {p}, calling add_to_total(5) followed by get_total() does not return 5 as you would \
             expect — the module-level state never actually changes and the function is broken. \
             Fix the bug so that add_to_total correctly updates the running total shared with get_total.")),
            vec![complete(),
                 file_has("counter.py", &["total"]),
                 Check::RunOutputContains(
                     format!("python3 -c \"import sys; sys.path.insert(0, '{d}'); \
from counter import add_to_total, get_total; \
add_to_total(5); assert get_total() == 5, f'after 5: {{get_total()}}'; \
add_to_total(3); assert get_total() == 8, f'after 3: {{get_total()}}'; \
print('COUNTER_OK')\""),
                     10,
                     vec!["COUNTER_OK".into()],
                 )]),
            vec![p])
    }
    v.push(scen!("bugfix_python_scope", Category::Bugfix, Difficulty::Medium, I, s_wrong_scope));


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
            "Both functions in {p} build SQL by interpolating user-controlled values straight into \
             the query string, which is unsafe and will break on quotes or malicious input. \
             Fix both functions so untrusted values can no longer alter the query structure.")),
            vec![complete(),
                 file_lacks("db.py", &["f\"SELECT", "f\"DELETE", "f'SELECT", "f'DELETE",
                                       "{username}", "{user_id}"])]),
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
            "The cache in {p} exposes Get/Set/Delete over a shared map, but if two goroutines call \
             these concurrently the Go runtime will panic with a concurrent map access error. \
             Make the cache safe to call from multiple goroutines at the same time.")),
            vec![complete(),
                 file_has("cache.go", &["sync."]),
                 file_lacks("cache.go", &["func Set(key, value string) {\n\tstore[key] = value\n}"])]),
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
            "Both functions in {p} open files but leave the file handles dangling after they return, \
             relying on the garbage collector to eventually release them. Fix both functions so \
             every file they open is reliably closed before the function returns, including when \
             an exception is raised partway through.")),
            vec![complete(),
                 file_lacks("reader.py", &["\n    f = open(path, \"r\")\n    count = 0",
                                           "\n    f = open(path, \"r\")\n    data = json.load(f)"])]),
            vec![p])
    }
    v.push(scen!("bugfix_resource_leak", Category::Bugfix, Difficulty::Hard, I, s_resource_leak));
}
