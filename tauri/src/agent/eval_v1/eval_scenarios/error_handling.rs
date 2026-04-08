//! Error-handling scenarios — add, improve, or fix error handling in code.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    // ── Medium ──────────────────────────────────────────────────────────

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
            "Improve error handling in {p}:\n\
             1. Create a custom `ApiError` class that includes the status code and response body\n\
             2. Replace the generic Error throws with ApiError\n\
             3. Add a discriminated union return type `type ApiResult<T> = {{ ok: true; data: T }} | {{ ok: false; error: ApiError }}`\n\
             4. Make both functions return ApiResult instead of throwing")),
            vec![complete(),
                 file_has("api.ts", &["class ApiError", "ApiResult", "ok: true", "ok: false", "status"]),
                 file_lacks("api.ts", &["throw new Error"])]),
            vec![p])
    }
    v.push(scen!("errh_typed_errors_ts", Category::ErrorHandling, Difficulty::Medium, I, s_typed_errors_ts));

    // ── Hard ────────────────────────────────────────────────────────────

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
            "Add retry logic with exponential backoff to {p}:\n\
             - Retry up to 3 times on 5xx errors or connection errors\n\
             - Wait 1s, then 2s, then 4s between retries (exponential backoff)\n\
             - Return False if all retries fail instead of raising\n\
             - Log each retry attempt\n\
             Use `time.sleep` for delays and `logging` for log messages.")),
            vec![complete(),
                 file_has("client.py", &["retry", "sleep", "logging", "return False", "return True"]),
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
        with_scope(with_checks(pf(format!(
            "Add a `Transaction` context manager class to {p} that:\n\
             1. Takes a Database instance in __init__\n\
             2. Implements __enter__ returning self\n\
             3. Implements __exit__: calls commit() if no exception, rollback() if there was one\n\
             4. Has an `execute(sql)` method that delegates to the database\n\
             Also keep the existing Database class intact.")),
            vec![complete(),
                 file_has("transaction.py", &["class Transaction", "__enter__", "__exit__", "commit", "rollback", "class Database"])]),
            vec![p])
    }
    v.push(scen!("errh_context_manager", Category::ErrorHandling, Difficulty::Hard, I, s_context_manager));

    fn s_error_boundary_react(dir: &Path) -> SetupResult {
        let p = ap(dir, "ErrorBoundary.tsx");
        with_checks(pf(format!(
            "Create a React error boundary component at {p} in TypeScript that:\n\
             1. Catches rendering errors in child components\n\
             2. Displays a fallback UI with the error message\n\
             3. Has a 'Try again' button that resets the error state\n\
             4. Accepts a `fallback` prop for custom fallback UI (optional)\n\
             5. Logs errors to console.error\n\
             Export it as the default export.")),
            vec![complete(),
                 file_has("ErrorBoundary.tsx", &["class ErrorBoundary", "componentDidCatch", "getDerivedStateFromError", "render", "Try again", "export default"])])
    }
    v.push(scen!("errh_react_error_boundary", Category::ErrorHandling, Difficulty::Hard, I, s_error_boundary_react));
}
