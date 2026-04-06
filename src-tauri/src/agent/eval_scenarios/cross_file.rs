//! Cross-file workflow scenarios — multi-file reads, edits, and coordination.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    // ── Easy ────────────────────────────────────────────────────────────

    fn s_import_and_use(dir: &Path) -> SetupResult {
        let utils = ap(dir, "utils.py");
        let main = ap(dir, "main.py");
        std::fs::write(&utils, "def greet(name: str) -> str:\n    return f'Hello, {name}!'\n").unwrap();
        std::fs::write(&main, "def run():\n    print('nothing yet')\n").unwrap();
        with_checks(pf(format!(
            "Read {utils}, then modify {main} to import `greet` from utils and call it with 'World' inside run().")),
            vec![complete(),
                 file_has("main.py", &["from utils import greet", "greet('World')", "def run"]),
                 file_lacks("main.py", &["nothing yet"])])
    }
    v.push(scen!("cross_import_and_use", Category::CrossFile, Difficulty::Easy, I, s_import_and_use));

    fn s_move_constant(dir: &Path) -> SetupResult {
        let config = ap(dir, "config.py");
        let app = ap(dir, "app.py");
        std::fs::write(&app, "MAX_RETRIES = 5\n\ndef fetch():\n    for i in range(MAX_RETRIES):\n        pass\n").unwrap();
        std::fs::write(&config, "# Configuration constants\nTIMEOUT = 30\n").unwrap();
        with_checks(pf(format!(
            "Move the `MAX_RETRIES` constant from {app} to {config}. \
             Then update {app} to import it from config.")),
            vec![complete(),
                 file_has("config.py", &["MAX_RETRIES = 5"]),
                 file_has("app.py", &["from config import MAX_RETRIES", "range(MAX_RETRIES)"]),
                 file_lacks("app.py", &["MAX_RETRIES = 5"])])
    }
    v.push(scen!("cross_move_constant", Category::CrossFile, Difficulty::Easy, I, s_move_constant));

    // ── Medium ──────────────────────────────────────────────────────────

    fn s_rename_across_files(dir: &Path) -> SetupResult {
        let models = ap(dir, "models.py");
        let views = ap(dir, "views.py");
        let tests = ap(dir, "test_views.py");
        std::fs::write(&models, "class UserAccount:\n    def __init__(self, name):\n        self.name = name\n").unwrap();
        std::fs::write(&views, "from models import UserAccount\n\ndef get_user() -> UserAccount:\n    return UserAccount('alice')\n").unwrap();
        std::fs::write(&tests, "from views import get_user\nfrom models import UserAccount\n\ndef test_get():\n    u = get_user()\n    assert isinstance(u, UserAccount)\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Rename the class `UserAccount` to `User` across all files in {d}. \
             Update the class definition, all imports, and all usages.")),
            vec![complete(),
                 file_has("models.py", &["class User:"]),
                 file_has("views.py", &["import User", "-> User", "User("]),
                 file_has("test_views.py", &["import User", "isinstance(u, User)"]),
                 file_lacks("models.py", &["UserAccount"]),
                 file_lacks("views.py", &["UserAccount"]),
                 file_lacks("test_views.py", &["UserAccount"])])
    }
    v.push(scen!("cross_rename_class", Category::CrossFile, Difficulty::Medium, I, s_rename_across_files));

    fn s_extract_to_module(dir: &Path) -> SetupResult {
        let main = ap(dir, "main.py");
        let helpers = ap(dir, "helpers.py");
        std::fs::write(&main, r#"def validate_email(email: str) -> bool:
    return "@" in email and "." in email.split("@")[1]

def validate_phone(phone: str) -> bool:
    return phone.isdigit() and len(phone) >= 10

def run():
    print(validate_email("a@b.com"))
    print(validate_phone("1234567890"))
"#).unwrap();
        with_checks(pf(format!(
            "Extract `validate_email` and `validate_phone` from {main} into a new file {helpers}. \
             Update {main} to import them from helpers. Keep the `run` function in main.")),
            vec![complete(),
                 file_has("helpers.py", &["def validate_email", "def validate_phone"]),
                 file_has("main.py", &["from helpers import", "validate_email", "validate_phone", "def run"]),
                 file_lacks("main.py", &["def validate_email", "def validate_phone"])])
    }
    v.push(scen!("cross_extract_module", Category::CrossFile, Difficulty::Medium, I, s_extract_to_module));

    fn s_update_interface(dir: &Path) -> SetupResult {
        let types = ap(dir, "types.ts");
        let service = ap(dir, "service.ts");
        let handler = ap(dir, "handler.ts");
        std::fs::write(&types, "export interface Config {\n  host: string;\n  port: number;\n}\n").unwrap();
        std::fs::write(&service, "import { Config } from './types';\n\nexport function connect(cfg: Config) {\n  console.log(`Connecting to ${cfg.host}:${cfg.port}`);\n}\n").unwrap();
        std::fs::write(&handler, "import { Config } from './types';\n\nconst defaultConfig: Config = { host: 'localhost', port: 8080 };\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Add an optional `timeout: number` field to the Config interface in {d}/types.ts. \
             Then update the service.ts connect function to use it (defaulting to 30 if undefined). \
             Also add timeout to the default config in handler.ts.")),
            vec![complete(),
                 file_has("types.ts", &["timeout"]),
                 file_has("service.ts", &["timeout"]),
                 file_has("handler.ts", &["timeout"])])
    }
    v.push(scen!("cross_update_interface", Category::CrossFile, Difficulty::Medium, I, s_update_interface));

    fn s_version_bump(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("package.json"), r#"{"name": "myapp", "version": "1.2.3"}"#).unwrap();
        std::fs::write(dir.join("version.py"), "VERSION = '1.2.3'\n").unwrap();
        std::fs::write(dir.join("README.md"), "# MyApp v1.2.3\nSome docs.\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Find all files in {d} containing the version string '1.2.3' and update them to '2.0.0'.")),
            vec![complete(),
                 file_has("package.json", &["2.0.0"]), file_lacks("package.json", &["1.2.3"]),
                 file_has("version.py", &["2.0.0"]), file_lacks("version.py", &["1.2.3"]),
                 file_has("README.md", &["2.0.0"]), file_lacks("README.md", &["1.2.3"])])
    }
    v.push(scen!("cross_version_bump", Category::CrossFile, Difficulty::Medium, I, s_version_bump));

    // ── Hard ────────────────────────────────────────────────────────────

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
            "Split {d}/utils.py into three files: string_utils.py (capitalize, snake_to_camel), \
             math_utils.py (clamp, lerp), and list_utils.py (flatten, chunk). \
             Update main.py to import from the new modules. Delete or empty utils.py.")),
            vec![complete(),
                 file_has("string_utils.py", &["def capitalize", "def snake_to_camel"]),
                 file_has("math_utils.py", &["def clamp", "def lerp"]),
                 file_has("list_utils.py", &["def flatten", "def chunk"]),
                 file_has("main.py", &["from string_utils import capitalize", "from math_utils import clamp", "from list_utils import flatten"])])
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
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Create a new file {new_mw} with a `RateLimiter` class that has the same `process(self, request)` \
             interface. It should track request counts per IP and return 429 if more than 100 requests. \
             Then register it in {d}/app.py by importing and adding it to the middlewares list.")),
            vec![complete(),
                 file_has("rate_limiter.py", &["class RateLimiter", "def process", "429"]),
                 file_has("app.py", &["RateLimiter", "rate_limiter"])])
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
            "The files {d}/user.py and {d}/order.py have a circular import. Fix this by using \
             one of: TYPE_CHECKING guard, string annotations, or restructuring. \
             Both classes must remain functional.")),
            vec![complete(),
                 file_has("user.py", &["class User"]),
                 file_has("order.py", &["class Order"]),
                 oc_any(&["TYPE_CHECKING", "string annotation", "forward reference", "restructur", "lazy", "__future__", "annotations", "import later", "deferred", "protocol"])])
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
            "The three API handlers under {d}/api/ all use different error and response patterns. \
             Standardize them: each function should return a tuple `(response_dict, status_code)`. \
             On error, return `({{'error': '...'}}, 4xx)`. On success, return `({{'data': ...}}, 200)`.")),
            vec![complete(),
                 file_has("api/users.py", &["\"data\"", "200"]),
                 file_has("api/orders.py", &["\"error\"", "\"data\"", "200"]),
                 file_has("api/products.py", &["\"error\"", "\"data\"", "200"]),
                 file_lacks("api/orders.py", &["raise ValueError"]),
                 file_lacks("api/products.py", &["return None"])])
    }
    v.push(scen!("cross_standardize_responses", Category::CrossFile, Difficulty::Hard, I, s_consistent_error_format));
}
