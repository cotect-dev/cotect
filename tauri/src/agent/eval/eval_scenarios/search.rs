//! Search scenarios — find patterns, symbols, and issues across files.

use std::path::Path;

use crate::agent::types::AgentRole::Research as R;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {

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
            "Review the exception handling across Python files under {d}. \
             Which files have problematic error handling that hides failures, \
             and which files handle errors properly?")),
            vec![complete(), succeeded("fs_search"),
                 oc_all(&["a.py", "c.py"]),
                 oc_any(&["swallow", "silent", "bare", "hide", "ignore", "suppress",
                          "discard", "empty", "catch-all", "broad", "eats", "nothing",
                          "except:", "except Exception"])])
    }
    v.push(scen!("search_error_patterns", Category::Search, Difficulty::Medium, R, s_find_error_handling));


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
            "Audit the TypeScript files under {d} for type-safety weaknesses. \
             List each problem you find with its file and a short description.")),
            vec![complete(), succeeded("fs_search"),
                 oc_any(&["api.ts"]),
                 oc_any(&["any", "cast", "unsafe", "type safety", "type-safe"])])
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
