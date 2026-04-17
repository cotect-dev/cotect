//! Cross-file workflow scenarios — multi-file reads, edits, and coordination.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {

    fn s_update_interface(dir: &Path) -> SetupResult {
        let types = ap(dir, "types.ts");
        let service = ap(dir, "service.ts");
        let handler = ap(dir, "handler.ts");
        std::fs::write(&types, "export interface Config {\n  host: string;\n  port: number;\n}\n").unwrap();
        std::fs::write(&service, "import { Config } from './types';\n\nexport function connect(cfg: Config) {\n  console.log(`Connecting to ${cfg.host}:${cfg.port}`);\n}\n").unwrap();
        std::fs::write(&handler, "import { Config } from './types';\n\nconst defaultConfig: Config = { host: 'localhost', port: 8080 };\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "The Config type in {d} needs a new optional connection timeout setting (in seconds). \
             Wire it through so existing callers keep working and a sensible default is used when callers omit it.")),
            vec![complete(),
                 // types.ts declares an optional timeout-ish field (case-insensitive, accepts camelCase/snake_case).
                 Check::RunOutputContains(
                     "grep -qi 'timeout' types.ts && grep -q '?' types.ts && echo TYPES_OK".into(),
                     10,
                     vec!["TYPES_OK".into()],
                 ),
                 // service.ts references the new field (default may live here via `??` or in handler.ts — either is valid).
                 Check::RunOutputContains(
                     "grep -qi 'timeout' service.ts && echo SERVICE_OK".into(),
                     10,
                     vec!["SERVICE_OK".into()],
                 )])
    }
    v.push(scen!("cross_update_interface", Category::CrossFile, Difficulty::Medium, I, s_update_interface));

    fn s_version_bump(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("package.json"), r#"{"name": "myapp", "version": "1.2.3"}"#).unwrap();
        std::fs::write(dir.join("version.py"), "VERSION = '1.2.3'\n").unwrap();
        std::fs::write(dir.join("README.md"), "# MyApp v1.2.3\nSome docs.\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Cut a major release in {d}: bump the project's current version to 2.0.0 everywhere it's declared.")),
            vec![complete(),
                 file_has("package.json", &["2.0.0"]), file_lacks("package.json", &["1.2.3"]),
                 file_has("version.py", &["2.0.0"]), file_lacks("version.py", &["1.2.3"]),
                 file_has("README.md", &["2.0.0"]), file_lacks("README.md", &["1.2.3"])])
    }
    v.push(scen!("cross_version_bump", Category::CrossFile, Difficulty::Medium, I, s_version_bump));


    fn s_split_module(dir: &Path) -> SetupResult {
        let mono = ap(dir, "utils.py");
        std::fs::write(&mono, r#"# String utilities
def capitalize(s: str) -> str:
    return s[0].upper() + s[1:] if s else s

def snake_to_camel(s: str) -> str:
    parts = s.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])

# Math utilities
def clamp(val: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, val))

def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t

# List utilities
def flatten(nested: list) -> list:
    result = []
    for item in nested:
        if isinstance(item, list):
            result.extend(flatten(item))
        else:
            result.append(item)
    return result

def chunk(lst: list, size: int) -> list:
    return [lst[i:i+size] for i in range(0, len(lst), size)]
"#).unwrap();
        let caller = ap(dir, "main.py");
        std::fs::write(&caller, "from utils import capitalize, clamp, flatten\n\nprint(capitalize('hello'))\nprint(clamp(15, 0, 10))\nprint(flatten([[1,2],[3]]))\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "{d}/utils.py has grown into a grab-bag of unrelated helpers (strings, math, lists). \
             Break it up into focused modules grouped by concern, and make sure main.py keeps working. \
             The old dumping ground should no longer contain these helpers.")),
            vec![complete(),
                 file_has("string_utils.py", &["def capitalize", "def snake_to_camel"]),
                 file_has("math_utils.py", &["def clamp", "def lerp"]),
                 file_has("list_utils.py", &["def flatten", "def chunk"]),
                 file_has("main.py", &["from string_utils import capitalize", "from math_utils import clamp", "from list_utils import flatten"]),
                 file_lacks("utils.py", &["def capitalize", "def clamp", "def flatten"])])
    }
    v.push(scen!("cross_split_module", Category::CrossFile, Difficulty::Hard, I, s_split_module));

    fn s_add_middleware_to_stack(dir: &Path) -> SetupResult {
        let middleware = ap(dir, "middleware.py");
        let app = ap(dir, "app.py");
        let new_mw = ap(dir, "rate_limiter.py");
        std::fs::write(&middleware, r#"class LoggingMiddleware:
    def process(self, request):
        print(f"Request: {request['method']} {request['path']}")
        return None

class AuthMiddleware:
    def process(self, request):
        if 'token' not in request.get('headers', {}):
            return {'status': 401, 'body': 'Unauthorized'}
        return None
"#).unwrap();
        std::fs::write(&app, r#"from middleware import LoggingMiddleware, AuthMiddleware

middlewares = [LoggingMiddleware(), AuthMiddleware()]

def handle_request(request):
    for mw in middlewares:
        response = mw.process(request)
        if response:
            return response
    return {'status': 200, 'body': 'OK'}
"#).unwrap();
        let _ = new_mw;
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "The middleware stack in {d} currently handles logging and auth. \
             Add rate limiting as a new middleware living in its own module, following the same shape as the existing ones, \
             and wire it into the app so incoming requests flow through it. \
             Over 100 requests from the same IP should be rejected with the appropriate HTTP status.")),
            vec![complete(),
                 file_has("rate_limiter.py", &["class RateLimiter", "def process", "429"]),
                 file_has("app.py", &["RateLimiter", "rate_limiter", "middlewares"])])
    }
    v.push(scen!("cross_add_middleware", Category::CrossFile, Difficulty::Hard, I, s_add_middleware_to_stack));

    fn s_fix_circular_import(dir: &Path) -> SetupResult {
        let user = ap(dir, "user.py");
        let order = ap(dir, "order.py");
        std::fs::write(&user, r#"from order import Order

class User:
    def __init__(self, name: str):
        self.name = name
        self.orders: list[Order] = []

    def add_order(self, order: Order):
        self.orders.append(order)
"#).unwrap();
        std::fs::write(&order, r#"from user import User

class Order:
    def __init__(self, user: User, total: float):
        self.user = user
        self.total = total

    def get_user_name(self) -> str:
        return self.user.name
"#).unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Running `python -c 'import user'` in {d} blows up because user.py and order.py import each other at module load. \
             Make both modules importable from a cold start while keeping the User and Order classes and their existing APIs intact.")),
            vec![complete(),
                 file_has("user.py", &["class User"]),
                 file_has("order.py", &["class Order"]),
                 run_ok("python -c 'import user; import order; u=user.User(\"a\"); o=order.Order(u, 1.0); u.add_order(o); assert o.get_user_name()==\"a\"'")])
    }
    v.push(scen!("cross_fix_circular_import", Category::CrossFile, Difficulty::Hard, I, s_fix_circular_import));

    fn s_consistent_error_format(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("api")).ok();
        std::fs::write(dir.join("api/users.py"), r#"def get_user(uid):
    if not uid:
        return {"error": "Missing ID"}, 400
    return {"data": {"id": uid, "name": "Alice"}}, 200
"#).unwrap();
        std::fs::write(dir.join("api/orders.py"), r#"def get_order(oid):
    if not oid:
        raise ValueError("Order ID required")
    return {"order_id": oid, "total": 42.0}
"#).unwrap();
        std::fs::write(dir.join("api/products.py"), r#"def get_product(pid):
    if not pid:
        return None
    return {"id": pid, "name": "Widget", "price": 9.99}
"#).unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "The handlers under {d}/api/ each invented their own way to signal success and failure \
             (one returns tuples, one raises, one returns None). Pick a single consistent contract \
             and apply it uniformly across all three so callers can handle every endpoint the same way. \
             Successful responses should carry their payload under a data key; failures should carry an error key and an appropriate HTTP status.")),
            vec![complete(),
                 file_has("api/users.py", &["\"error\"", "\"data\"", "200"]),
                 file_has("api/orders.py", &["\"error\"", "\"data\"", "200"]),
                 file_has("api/products.py", &["\"error\"", "\"data\"", "200"]),
                 file_lacks("api/orders.py", &["raise ValueError"]),
                 file_lacks("api/products.py", &["return None"])])
    }
    v.push(scen!("cross_standardize_responses", Category::CrossFile, Difficulty::Hard, I, s_consistent_error_format));
}
