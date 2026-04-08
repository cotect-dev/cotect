//! Planning scenarios — create implementation plans from requirements or code.

use std::path::Path;

use crate::agent::types::AgentRole::Plan as P;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    // ── Easy ────────────────────────────────────────────────────────────

    fn s_plan_feature(dir: &Path) -> SetupResult {
        let p = ap(dir, "app.py");
        std::fs::write(&p, r#"class TodoApp:
    def __init__(self):
        self.todos = []

    def add(self, text: str):
        self.todos.append({"text": text, "done": False})

    def complete(self, index: int):
        self.todos[index]["done"] = True

    def list(self):
        return self.todos
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} and create a numbered plan for adding a 'due date' feature to the TodoApp. \
             Each todo should have an optional due date, and there should be a method to list overdue items. \
             Include at least 3 concrete steps.")),
            vec![complete(), succeeded("read"),
                 oc_all(&["1.", "2.", "3."]),
                 oc_any(&["due", "date", "overdue"])]),
            vec![p])
    }
    v.push(scen!("plan_add_due_dates", Category::Planning, Difficulty::Easy, P, s_plan_feature));

    fn s_plan_tests(dir: &Path) -> SetupResult {
        let p = ap(dir, "calculator.py");
        std::fs::write(&p, r#"class Calculator:
    def __init__(self):
        self.history = []

    def add(self, a, b):
        result = a + b
        self.history.append(("add", a, b, result))
        return result

    def divide(self, a, b):
        result = a / b
        self.history.append(("divide", a, b, result))
        return result

    def last(self):
        return self.history[-1] if self.history else None
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} and create a numbered plan for writing a comprehensive test suite. \
             List specific test cases, including edge cases and error conditions. At least 4 steps.")),
            vec![complete(), succeeded("read"),
                 oc_all(&["1.", "2.", "3.", "4."]),
                 oc_any(&["zero", "division", "edge", "error", "history", "empty"])]),
            vec![p])
    }
    v.push(scen!("plan_test_suite", Category::Planning, Difficulty::Easy, P, s_plan_tests));

    fn s_plan_refactor(dir: &Path) -> SetupResult {
        let p = ap(dir, "handler.py");
        std::fs::write(&p, r#"def handle_request(request):
    if request["type"] == "login":
        if not request.get("username"):
            return {"error": "Missing username"}
        if not request.get("password"):
            return {"error": "Missing password"}
        if request["username"] == "admin" and request["password"] == "secret":
            return {"token": "abc123"}
        return {"error": "Invalid credentials"}
    elif request["type"] == "register":
        if not request.get("username"):
            return {"error": "Missing username"}
        if not request.get("email"):
            return {"error": "Missing email"}
        return {"user_id": 1, "username": request["username"]}
    elif request["type"] == "reset_password":
        if not request.get("email"):
            return {"error": "Missing email"}
        return {"message": "Reset email sent"}
    else:
        return {"error": "Unknown request type"}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} and create a numbered plan for refactoring this handler. \
             The function is too long and uses nested if-else chains. \
             Plan how to decompose it. At least 4 steps.")),
            vec![complete(), succeeded("read"),
                 oc_all(&["1.", "2.", "3.", "4."]),
                 oc_any(&["extract", "separate", "split", "handler", "dispatch", "function"])]),
            vec![p])
    }
    v.push(scen!("plan_refactor_handler", Category::Planning, Difficulty::Easy, P, s_plan_refactor));

    // ── Medium ──────────────────────────────────────────────────────────

    fn s_plan_caching(dir: &Path) -> SetupResult {
        let p = ap(dir, "service.py");
        std::fs::write(&p, r#"import requests

class DataService:
    def __init__(self, base_url: str):
        self.base_url = base_url

    def get_user(self, user_id: int) -> dict:
        resp = requests.get(f"{self.base_url}/users/{user_id}")
        return resp.json()

    def get_posts(self, user_id: int) -> list:
        resp = requests.get(f"{self.base_url}/users/{user_id}/posts")
        return resp.json()

    def get_user_with_posts(self, user_id: int) -> dict:
        user = self.get_user(user_id)
        user["posts"] = self.get_posts(user_id)
        return user
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} and create a numbered plan for adding a caching layer. \
             Consider: cache invalidation strategy, TTL, what to cache, cache key design, \
             and how to make it configurable. At least 5 steps.")),
            vec![complete(), succeeded("read"),
                 oc_all(&["1.", "2.", "3.", "4.", "5."]),
                 oc_any(&["cache", "TTL", "invalidat", "expir"])]),
            vec![p])
    }
    v.push(scen!("plan_caching_layer", Category::Planning, Difficulty::Medium, P, s_plan_caching));

    fn s_plan_migrate_db(dir: &Path) -> SetupResult {
        let p = ap(dir, "models.py");
        std::fs::write(&p, r#"import sqlite3

def get_connection():
    return sqlite3.connect("app.db")

def create_tables():
    conn = get_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY,
            user_id INTEGER REFERENCES users(id),
            title TEXT NOT NULL,
            body TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()

def insert_user(name, email):
    conn = get_connection()
    conn.execute("INSERT INTO users (name, email) VALUES (?, ?)", (name, email))
    conn.commit()
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} and create a numbered plan for migrating from raw sqlite3 to SQLAlchemy ORM. \
             Cover: model definitions, session management, migration of existing queries, testing. \
             At least 5 steps.")),
            vec![complete(), succeeded("read"),
                 oc_all(&["1.", "2.", "3.", "4.", "5."]),
                 oc_any(&["SQLAlchemy", "model", "session", "ORM"])]),
            vec![p])
    }
    v.push(scen!("plan_migrate_to_orm", Category::Planning, Difficulty::Medium, P, s_plan_migrate_db));

    fn s_plan_api_versioning(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("api")).ok();
        std::fs::write(dir.join("api/users.py"), "def get_users(): return []\ndef create_user(data): return data\n").unwrap();
        std::fs::write(dir.join("api/products.py"), "def get_products(): return []\ndef create_product(data): return data\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d}/api/ to understand the current API structure, then create a numbered plan for \
             adding API versioning (v1, v2). Consider: URL structure, backward compatibility, \
             how to handle breaking changes, and shared logic. At least 5 steps.")),
            vec![complete(), used_any(&["fs_search", "read"]),
                 oc_all(&["1.", "2.", "3.", "4.", "5."]),
                 oc_any(&["v1", "v2", "version", "backward", "compat"])])
    }
    v.push(scen!("plan_api_versioning", Category::Planning, Difficulty::Medium, P, s_plan_api_versioning));

    fn s_plan_security_audit(dir: &Path) -> SetupResult {
        let p = ap(dir, "server.py");
        std::fs::write(&p, r#"from flask import Flask, request, jsonify
import subprocess

app = Flask(__name__)

@app.route("/search")
def search():
    query = request.args.get("q", "")
    results = subprocess.check_output(f"grep -r '{query}' /data", shell=True)
    return results.decode()

@app.route("/user/<user_id>")
def get_user(user_id):
    import sqlite3
    conn = sqlite3.connect("app.db")
    user = conn.execute(f"SELECT * FROM users WHERE id = {user_id}").fetchone()
    return jsonify(user)

@app.route("/upload", methods=["POST"])
def upload():
    f = request.files["file"]
    f.save(f"/uploads/{f.filename}")
    return "OK"
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} and create a security audit plan. Identify all vulnerabilities and create a \
             numbered plan to fix each one. Be specific about what's dangerous and how to fix it. \
             At least 4 steps.")),
            vec![complete(), succeeded("read"),
                 oc_all(&["1.", "2.", "3.", "4."]),
                 oc_any(&["injection", "command injection", "SQL injection", "path traversal", "sanitiz"])]),
            vec![p])
    }
    v.push(scen!("plan_security_audit", Category::Planning, Difficulty::Medium, P, s_plan_security_audit));

    // ── Hard ────────────────────────────────────────────────────────────

    fn s_plan_microservice_split(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("app")).ok();
        std::fs::write(dir.join("app/auth.py"), "class AuthService:\n    def login(self, u, p): pass\n    def register(self, u, e, p): pass\n    def verify_token(self, t): pass\n").unwrap();
        std::fs::write(dir.join("app/orders.py"), "class OrderService:\n    def create(self, user_id, items): pass\n    def get(self, order_id): pass\n    def list_by_user(self, user_id): pass\n").unwrap();
        std::fs::write(dir.join("app/notifications.py"), "class NotificationService:\n    def send_email(self, to, subject, body): pass\n    def send_sms(self, phone, message): pass\n").unwrap();
        std::fs::write(dir.join("app/main.py"), "from auth import AuthService\nfrom orders import OrderService\nfrom notifications import NotificationService\n\ndef create_order(user_token, items):\n    auth = AuthService()\n    user = auth.verify_token(user_token)\n    order = OrderService().create(user['id'], items)\n    NotificationService().send_email(user['email'], 'Order', str(order))\n    return order\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Analyse the code under {d}/app/ and create a numbered plan for splitting this monolith \
             into microservices. Consider: service boundaries, inter-service communication, \
             data ownership, shared libraries, deployment, and migration strategy. At least 6 steps.")),
            vec![complete(), used_any(&["fs_search", "read"]),
                 oc_all(&["1.", "2.", "3.", "4.", "5.", "6."]),
                 oc_any(&["auth", "order", "notification"]),
                 oc_any(&["API", "service", "microservice", "communicate"])])
    }
    v.push(scen!("plan_microservice_split", Category::Planning, Difficulty::Hard, P, s_plan_microservice_split));

    fn s_plan_performance(dir: &Path) -> SetupResult {
        let p = ap(dir, "analytics.py");
        std::fs::write(&p, r#"import json

def process_log_file(path: str) -> dict:
    """Process a large log file and return statistics."""
    with open(path) as f:
        lines = f.readlines()

    events = []
    for line in lines:
        event = json.loads(line)
        events.append(event)

    # Count by type
    type_counts = {}
    for event in events:
        t = event["type"]
        if t not in type_counts:
            type_counts[t] = 0
        type_counts[t] += 1

    # Find errors
    errors = []
    for event in events:
        if event.get("level") == "error":
            errors.append(event)

    # Calculate average response time
    times = []
    for event in events:
        if "response_time" in event:
            times.append(event["response_time"])
    avg_time = sum(times) / len(times) if times else 0

    return {
        "total": len(events),
        "by_type": type_counts,
        "errors": len(errors),
        "avg_response_time": avg_time,
    }
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. This function loads entire log files into memory and makes multiple passes. \
             Create a numbered plan for optimizing it for large files (100GB+). \
             Cover: streaming, single-pass processing, memory management, parallelization. \
             At least 5 steps.")),
            vec![complete(), succeeded("read"),
                 oc_all(&["1.", "2.", "3.", "4.", "5."]),
                 oc_any(&["stream", "memory", "single pass", "one pass", "generator", "chunk"])]),
            vec![p])
    }
    v.push(scen!("plan_optimize_performance", Category::Planning, Difficulty::Hard, P, s_plan_performance));

    fn s_plan_testing_strategy(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("src")).ok();
        std::fs::write(dir.join("src/payment.py"), r#"import stripe

class PaymentProcessor:
    def __init__(self, api_key: str):
        self.client = stripe.Client(api_key)

    def charge(self, customer_id: str, amount: int, currency: str = "usd") -> dict:
        intent = self.client.payment_intents.create(
            amount=amount, currency=currency, customer=customer_id
        )
        return {"id": intent.id, "status": intent.status}

    def refund(self, payment_id: str, amount: int = None) -> dict:
        refund = self.client.refunds.create(
            payment_intent=payment_id, amount=amount
        )
        return {"id": refund.id, "status": refund.status}

    def get_balance(self) -> dict:
        balance = self.client.balance.retrieve()
        return {"available": balance.available, "pending": balance.pending}
"#).unwrap();
        let p = ap(dir, "src/payment.py");
        let d = dir.to_string_lossy().into_owned();
        with_scope(with_checks(pf(format!(
            "Read the payment code in {d}/src/ and create a comprehensive testing plan. \
             Cover: unit tests with mocks, integration tests, edge cases, error scenarios, \
             and how to test without hitting the real Stripe API. At least 5 detailed steps.")),
            vec![complete(), succeeded("read"),
                 oc_all(&["1.", "2.", "3.", "4.", "5."]),
                 oc_any(&["mock", "stub", "fake"]),
                 oc_any(&["unit", "integration", "test"])]),
            vec![p])
    }
    v.push(scen!("plan_testing_strategy", Category::Planning, Difficulty::Hard, P, s_plan_testing_strategy));
}
