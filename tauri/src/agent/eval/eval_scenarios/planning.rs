//! Planning scenarios — create implementation plans from requirements or code.

use std::path::Path;

use crate::agent::types::AgentRole::Plan as P;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {

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
             "Read {p} and produce a security audit plan that identifies every \
              vulnerability in the file and describes how to remediate each one.")),
            vec![complete(), succeeded("read"),
                 oc_any(&["/search", "subprocess", "shell=true", "grep -r"]),
                 oc_any(&["/user", "sql", "select *", "sqlite", "parameteriz", "prepared"]),
                 oc_any(&["/upload", "filename", "path traversal", "secure_filename", "werkzeug"]),
                 oc_any(&["command injection", "shell injection", "sanitiz", "escape", "validate"])]),
            vec![p])
    }
    v.push(scen!("plan_security_audit", Category::Planning, Difficulty::Medium, P, s_plan_security_audit));


    fn s_plan_microservice_split(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("app")).ok();
        std::fs::write(dir.join("app/auth.py"), "class AuthService:\n    def login(self, u, p): pass\n    def register(self, u, e, p): pass\n    def verify_token(self, t): pass\n").unwrap();
        std::fs::write(dir.join("app/orders.py"), "class OrderService:\n    def create(self, user_id, items): pass\n    def get(self, order_id): pass\n    def list_by_user(self, user_id): pass\n").unwrap();
        std::fs::write(dir.join("app/notifications.py"), "class NotificationService:\n    def send_email(self, to, subject, body): pass\n    def send_sms(self, phone, message): pass\n").unwrap();
        std::fs::write(dir.join("app/main.py"), "from auth import AuthService\nfrom orders import OrderService\nfrom notifications import NotificationService\n\ndef create_order(user_token, items):\n    auth = AuthService()\n    user = auth.verify_token(user_token)\n    order = OrderService().create(user['id'], items)\n    NotificationService().send_email(user['email'], 'Order', str(order))\n    return order\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Analyse the code under {d}/app/ and produce a plan for splitting this monolith \
             into microservices. The plan must be grounded in the actual modules you find.")),
            vec![complete(), used_any(&["fs_search", "read"]),
                 oc_all(&["auth", "order", "notif"]),
                 oc_any(&["main.py", "create_order", "orchestrat", "cross-service", "cross service", "coupling"]),
                 oc_any(&["API", "REST", "gRPC", "queue", "event", "message", "HTTP", "RPC"]),
                 oc_any(&["data", "database", "ownership", "schema", "migration"])])
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
            "Read {p} and produce a plan for making this function handle 100GB+ log files \
             without running out of memory. Identify the specific problems in the current \
             implementation and propose concrete changes.")),
            vec![complete(), succeeded("read"),
                 oc_any(&["readlines", "loads the whole", "loads entire", "into memory", "in-memory", "list"]),
                 oc_any(&["multiple passes", "three passes", "four passes", "several passes", "iterate", "loop"]),
                 oc_any(&["stream", "iterator", "generator", "yield", "chunk", "line by line", "line-by-line"]),
                 oc_any(&["single pass", "one pass", "single-pass", "one-pass", "aggregat", "running", "accumulat"]),
                 oc_any(&["process_log_file", "json.loads", "type_counts", "response_time"])]),
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
            "Read the payment code in {d}/src/ and produce a testing plan for it. The plan \
             must be specific to this class and the external dependency it uses.")),
            vec![complete(), succeeded("read"),
                 oc_all(&["charge", "refund"]),
                 oc_any(&["get_balance", "balance"]),
                 oc_any(&["stripe", "Stripe"]),
                 oc_any(&["mock", "stub", "fake", "patch", "monkeypatch", "fixture"]),
                 oc_any(&["error", "failure", "exception", "decline", "edge case", "invalid"])]),
            vec![p])
    }
    v.push(scen!("plan_testing_strategy", Category::Planning, Difficulty::Hard, P, s_plan_testing_strategy));
}
