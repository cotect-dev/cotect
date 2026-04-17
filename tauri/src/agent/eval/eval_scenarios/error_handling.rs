//! Error-handling scenarios — add, improve, or fix error handling in code.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {

    fn s_typed_errors_ts(dir: &Path) -> SetupResult {
        let p = ap(dir, "api.ts");
        std::fs::write(&p, r#"export async function fetchData(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Request failed");
  }
  return response.json();
}

export async function postData(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error("Request failed");
  }
  return response.json();
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
             "Error handling in {p} is weak: failures throw a generic Error with no status code or\n\
              response body, so callers cannot distinguish a 404 from a 500 or show useful messages,\n\
              and the throw-based control flow is easy for callers to forget. Rework the module so\n\
              failures carry structured information (status and body) and so that callers must\n\
              explicitly handle the failure case instead of relying on try/catch.")),
            vec![complete(),
                 file_has("api.ts", &["status"]),
                 oc_any(&["ApiError", "HttpError", "RequestError", "FetchError"]),
                 file_lacks("api.ts", &["throw new Error(\"Request failed\")"])]),
            vec![p])
    }
    v.push(scen!("errh_typed_errors_ts", Category::ErrorHandling, Difficulty::Medium, I, s_typed_errors_ts));


    fn s_retry_with_backoff(dir: &Path) -> SetupResult {
        let p = ap(dir, "client.py");
        std::fs::write(&p, r#"import requests

def send_event(url: str, payload: dict) -> bool:
    """Send an event to the analytics endpoint. Returns True on success."""
    response = requests.post(url, json=payload, timeout=10)
    response.raise_for_status()
    return True
"#).unwrap();
        with_scope(with_checks(pf(format!(
             "{p} sends analytics events but a single transient failure (5xx, connection drop) kills\n\
              the call — `raise_for_status` propagates and the caller just gets an exception. Make\n\
              `send_event` resilient to transient failures and make it return False on persistent\n\
              failure instead of raising, so callers can treat analytics as best-effort. Give up\n\
              after a small, bounded number of attempts with increasing delay between them.")),
            vec![complete(),
                 file_has("client.py", &["return False", "return True"]),
                 file_lacks("client.py", &["response.raise_for_status()\n    return True"]),
                 oc_any(&["backoff", "retry", "attempt", "sleep"]),
                 file_has("client.py", &["except"])]),
            vec![p])
    }
    v.push(scen!("errh_retry_backoff", Category::ErrorHandling, Difficulty::Hard, I, s_retry_with_backoff));

    fn s_context_manager(dir: &Path) -> SetupResult {
        let p = ap(dir, "transaction.py");
        std::fs::write(&p, r#"class Database:
    def __init__(self):
        self.committed = False
        self.rolled_back = False
        self.operations = []

    def execute(self, sql: str):
        self.operations.append(sql)

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True
"#).unwrap();
        let dir_str = dir.to_string_lossy().into_owned();
        let probe = format!(
            "cd {dir_str} && python3 -c 'from transaction import Database, Transaction\n\
             db = Database()\n\
             with Transaction(db) as t:\n\
             \u{20}\u{20}\u{20}\u{20}t.execute(\"INSERT 1\")\n\
             assert db.committed and not db.rolled_back, \"ok path failed\"\n\
             db2 = Database()\n\
             try:\n\
             \u{20}\u{20}\u{20}\u{20}with Transaction(db2) as t:\n\
             \u{20}\u{20}\u{20}\u{20}\u{20}\u{20}\u{20}\u{20}t.execute(\"INSERT 2\")\n\
             \u{20}\u{20}\u{20}\u{20}\u{20}\u{20}\u{20}\u{20}raise RuntimeError(\"boom\")\n\
             except RuntimeError:\n\
             \u{20}\u{20}\u{20}\u{20}pass\n\
             assert db2.rolled_back and not db2.committed, \"error path failed\"\n\
             print(\"TRANSACTION_OK\")\n\
             '"
        );
        with_scope(with_checks(pf(format!(
             "Callers of the `Database` class in {p} keep forgetting to call commit() on success or\n\
              rollback() on failure, leaving transactions in an inconsistent state. Add a helper in\n\
              the same file that lets a block of database operations be wrapped so that the correct\n\
              finalization happens automatically depending on whether the block completed normally\n\
              or raised. The existing Database class must keep working unchanged.")),
            vec![complete(),
                 file_has("transaction.py", &["class Database"]),
                 run_has(&probe, &["TRANSACTION_OK"])]),
            vec![p])
    }
    v.push(scen!("errh_context_manager", Category::ErrorHandling, Difficulty::Hard, I, s_context_manager));

    fn s_error_boundary_react(dir: &Path) -> SetupResult {
        let p = ap(dir, "ErrorBoundary.tsx");
        with_checks(pf(format!(
             "Right now when any component in our React tree throws during render the whole app\n\
              unmounts and the user is left with a blank screen. Build a reusable TypeScript\n\
              component at {p} that wraps arbitrary children, keeps the rest of the app alive when\n\
              one of them crashes, shows something useful to the user in place of the broken\n\
              subtree, and offers a way to retry without a full page reload. Callers should also be\n\
              able to substitute their own replacement UI when they want.")),
            vec![complete(),
                 file_has("ErrorBoundary.tsx", &["class", "render", "export default"]),
                 oc_any(&["componentDidCatch", "getDerivedStateFromError"]),
                 file_has("ErrorBoundary.tsx", &["setState"]),
                 file_has("ErrorBoundary.tsx", &["children"])])
    }
    v.push(scen!("errh_react_error_boundary", Category::ErrorHandling, Difficulty::Hard, I, s_error_boundary_react));
}
