//! Search scenarios — find patterns, symbols, and issues across files.

use std::path::Path;

use crate::agent::types::AgentRole::Research as R;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    // ── Easy ────────────────────────────────────────────────────────────

    fn s_find_todos(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("src")).ok();
        std::fs::write(dir.join("src/auth.py"), "# TODO: add password hashing\ndef login(user, pw): pass\n").unwrap();
        std::fs::write(dir.join("src/api.py"), "def get_data(): return []\n# TODO: implement pagination\n# TODO: add caching\n").unwrap();
        std::fs::write(dir.join("src/models.py"), "class User: pass\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search all files under {d} for TODO comments. List each TODO with its file. \
             How many TODOs are there total? State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("fs_search"), num(3),
                 oc_all(&["password", "pagination", "caching"])])
    }
    v.push(scen!("search_find_todos", Category::Search, Difficulty::Easy, R, s_find_todos));

    fn s_find_function_def(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("lib")).ok();
        std::fs::write(dir.join("lib/math.ts"), "export function add(a: number, b: number) { return a + b; }\nexport function multiply(a: number, b: number) { return a * b; }\n").unwrap();
        std::fs::write(dir.join("lib/string.ts"), "export function capitalize(s: string) { return s[0].toUpperCase() + s.slice(1); }\n").unwrap();
        std::fs::write(dir.join("lib/array.ts"), "export function flatten<T>(arr: T[][]): T[] { return arr.flat(); }\nexport function unique<T>(arr: T[]): T[] { return [...new Set(arr)]; }\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} for all exported functions. List every function name you find.")),
            vec![complete(), succeeded("fs_search"),
                 oc_all(&["add", "multiply", "capitalize", "flatten", "unique"])])
    }
    v.push(scen!("search_exported_functions", Category::Search, Difficulty::Easy, R, s_find_function_def));

    fn s_find_hardcoded_secrets(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("config")).ok();
        std::fs::write(dir.join("config/db.py"), "DB_URL = 'postgres://user:password123@prod-db:5432/myapp'\n").unwrap();
        std::fs::write(dir.join("config/api.py"), "API_KEY = 'sk-live-abc123def456'\nBASE_URL = 'https://api.example.com'\n").unwrap();
        std::fs::write(dir.join("config/settings.py"), "DEBUG = False\nLOG_LEVEL = 'INFO'\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} for hardcoded secrets (API keys, passwords, credentials). \
             Report which files contain secrets and what kind of secret each is.")),
            vec![complete(), succeeded("fs_search"),
                 oc_all(&["db.py", "api.py"]),
                 oc_any(&["password", "credential", "secret", "API_KEY", "DB_URL"])])
    }
    v.push(scen!("search_hardcoded_secrets", Category::Search, Difficulty::Easy, R, s_find_hardcoded_secrets));

    // ── Medium ──────────────────────────────────────────────────────────

    fn s_unused_imports(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("src")).ok();
        std::fs::write(dir.join("src/main.py"), "\
import os\nimport sys\nimport json\nimport re\n\ndef run():\n    data = json.loads('{}')\n    print(os.getcwd())\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search the Python files under {d} and identify which imports are unused. \
             `run()` uses `json` and `os` but not the others. List the unused imports.")),
            vec![complete(), succeeded("fs_search"),
                 oc_all(&["sys", "re"]),
                 oc_any(&["unused", "not used"])])
    }
    v.push(scen!("search_unused_imports", Category::Search, Difficulty::Medium, R, s_unused_imports));

    fn s_find_console_logs(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("src")).ok();
        std::fs::write(dir.join("src/app.ts"), "export function init() {\n  console.log('app started');\n  setup();\n}\n").unwrap();
        std::fs::write(dir.join("src/api.ts"), "export async function fetch() {\n  console.log('fetching...');\n  console.warn('deprecated');\n  return [];\n}\n").unwrap();
        std::fs::write(dir.join("src/utils.ts"), "export function format(s: string) {\n  return s.trim();\n}\n").unwrap();
        std::fs::write(dir.join("src/debug.ts"), "console.log('debug1');\nconsole.log('debug2');\nconsole.error('test error');\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} for all `console.log` calls (not console.warn or console.error). \
             How many `console.log` calls are there total? State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("fs_search"), num(4)])
    }
    v.push(scen!("search_console_logs", Category::Search, Difficulty::Medium, R, s_find_console_logs));

    fn s_find_callers(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("src")).ok();
        std::fs::write(dir.join("src/db.py"), "def get_connection():\n    return connect('localhost', 5432)\n").unwrap();
        std::fs::write(dir.join("src/users.py"), "from db import get_connection\ndef list_users():\n    conn = get_connection()\n    return conn.query('SELECT * FROM users')\n").unwrap();
        std::fs::write(dir.join("src/orders.py"), "from db import get_connection\ndef list_orders():\n    conn = get_connection()\n    return conn.query('SELECT * FROM orders')\n").unwrap();
        std::fs::write(dir.join("src/health.py"), "def check():\n    return 'ok'\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} for all files that call `get_connection()`. \
             List which files call it and which functions use it.")),
            vec![complete(), succeeded("fs_search"),
                 oc_all(&["users.py", "orders.py", "list_users", "list_orders"])])
    }
    v.push(scen!("search_find_callers", Category::Search, Difficulty::Medium, R, s_find_callers));

    fn s_find_error_handling(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("src")).ok();
        std::fs::write(dir.join("src/a.py"), "def a():\n    try:\n        risky()\n    except Exception:\n        pass\n").unwrap();
        std::fs::write(dir.join("src/b.py"), "def b():\n    try:\n        other()\n    except ValueError as e:\n        log(e)\n        raise\n").unwrap();
        std::fs::write(dir.join("src/c.py"), "def c():\n    try:\n        stuff()\n    except:\n        pass\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} for exception handling patterns. Identify which files have bare `except` or \
             `except Exception: pass` (swallowed exceptions). Which files have problematic error handling?")),
            vec![complete(), succeeded("fs_search"),
                 oc_all(&["a.py", "c.py"]),
                 oc_any(&["swallow", "silent", "bare except", "pass", "ignore"])])
    }
    v.push(scen!("search_error_patterns", Category::Search, Difficulty::Medium, R, s_find_error_handling));

    // ── Hard ────────────────────────────────────────────────────────────

    fn s_find_type_issues(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("src")).ok();
        std::fs::write(dir.join("src/user.ts"), r#"export interface User {
  id: string;
  name: string;
  age: number;
}
"#).unwrap();
        std::fs::write(dir.join("src/api.ts"), r#"import { User } from './user';

export function createUser(data: any): User {
  return data as User;
}

export function updateAge(user: User, age: any) {
  user.age = age;
}

export function getUsers(): any[] {
  return fetch('/api/users').then((r: any) => r.json());
}
"#).unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} TypeScript files for type safety issues: unsafe `any` usage, unsafe casts (`as`), \
             and missing return types. List each issue with its file and line.")),
            vec![complete(), succeeded("fs_search"),
                 oc_all(&["any", "api.ts"]),
                 oc_any(&["cast", "unsafe", "type safety", "type-safe", "any[]", "data: any"])])
    }
    v.push(scen!("search_type_safety_issues", Category::Search, Difficulty::Hard, R, s_find_type_issues));

    fn s_dependency_analysis(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("src")).ok();
        std::fs::write(dir.join("src/config.py"), "SETTINGS = {'debug': False}\n").unwrap();
        std::fs::write(dir.join("src/db.py"), "from config import SETTINGS\ndef init_db(): pass\n").unwrap();
        std::fs::write(dir.join("src/auth.py"), "from db import init_db\nfrom config import SETTINGS\ndef login(): pass\n").unwrap();
        std::fs::write(dir.join("src/api.py"), "from auth import login\nfrom db import init_db\ndef handle(): pass\n").unwrap();
        std::fs::write(dir.join("src/main.py"), "from api import handle\nfrom config import SETTINGS\ndef run(): handle()\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Analyse the imports in Python files under {d}/src/ and describe the dependency graph. \
             Which module is the most depended-upon (imported by the most other modules)? \
             Are there any circular dependencies?")),
            vec![complete(), succeeded("fs_search"),
                 oc_any(&["config", "SETTINGS"]),
                 oc_any(&["no circular", "not circular", "acyclic", "no cycle"])])
    }
    v.push(scen!("search_dependency_graph", Category::Search, Difficulty::Hard, R, s_dependency_analysis));

    fn s_api_consistency(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("handlers")).ok();
        std::fs::write(dir.join("handlers/users.py"), r#"def get_users():
    return {"data": [], "status": "ok"}

def create_user(data):
    return {"result": data, "error": None}
"#).unwrap();
        std::fs::write(dir.join("handlers/orders.py"), r#"def get_orders():
    return {"data": [], "status": "ok"}

def create_order(data):
    return {"data": data, "status": "ok"}
"#).unwrap();
        std::fs::write(dir.join("handlers/products.py"), r#"def get_products():
    return {"items": [], "code": 200}

def create_product(data):
    return data
"#).unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search the handler files under {d}/handlers/ and analyse the API response formats. \
             Are they consistent? Identify which handlers use different response shapes and describe \
             the inconsistencies.")),
            vec![complete(), succeeded("fs_search"),
                 oc_any(&["inconsisten", "different format", "different shape", "not consistent"]),
                 oc_all(&["products", "users"])])
    }
    v.push(scen!("search_api_consistency", Category::Search, Difficulty::Hard, R, s_api_consistency));
}
