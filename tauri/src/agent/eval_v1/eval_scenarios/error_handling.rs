//! Error-handling scenarios — add, improve, or fix error handling in code.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    // ── Easy ────────────────────────────────────────────────────────────

    fn s_add_try_catch(dir: &Path) -> SetupResult {
        let p = ap(dir, "parse.ts");
        std::fs::write(&p, r#"export function parseConfig(raw: string): Record<string, unknown> {
  return JSON.parse(raw);
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "The function in {p} can throw if the input is not valid JSON. \
             Wrap the JSON.parse call in a try/catch that returns an empty object on failure.")),
            vec![complete(),
                 file_has("parse.ts", &["try", "catch", "JSON.parse", "{}"]),
                 ]),
            vec![p])
    }
    v.push(scen!("errh_add_try_catch", Category::ErrorHandling, Difficulty::Easy, I, s_add_try_catch));

    fn s_null_check(dir: &Path) -> SetupResult {
        let p = ap(dir, "display.ts");
        std::fs::write(&p, r#"export function displayUser(user: { name: string; email: string } | null): string {
  return `${user.name} <${user.email}>`;
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "The function in {p} accepts null but doesn't handle it. \
             Add a null check that returns 'Unknown user' if user is null.")),
            vec![complete(),
                 file_has("display.ts", &["null", "Unknown user"]),
                 file_has("display.ts", &["user.name"])]),
            vec![p])
    }
    v.push(scen!("errh_null_check", Category::ErrorHandling, Difficulty::Easy, I, s_null_check));

    fn s_add_input_validation(dir: &Path) -> SetupResult {
        let p = ap(dir, "divide.py");
        std::fs::write(&p, "\
def divide(a: float, b: float) -> float:\n    return a / b\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Add input validation to {p}: raise a ValueError with a clear message if b is zero, \
             and raise a TypeError if a or b is not a number (int or float).")),
            vec![complete(),
                 file_has("divide.py", &["ValueError", "TypeError", "0"]),
                 file_has("divide.py", &["return a / b"])]),
            vec![p])
    }
    v.push(scen!("errh_input_validation", Category::ErrorHandling, Difficulty::Easy, I, s_add_input_validation));

    // ── Medium ──────────────────────────────────────────────────────────

    fn s_custom_exceptions(dir: &Path) -> SetupResult {
        let p = ap(dir, "auth.py");
        std::fs::write(&p, r#"def authenticate(username: str, password: str) -> dict:
    if not username:
        raise Exception("Username required")
    if not password:
        raise Exception("Password required")
    if username != "admin" or password != "secret":
        raise Exception("Invalid credentials")
    return {"user": username, "role": "admin"}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, replace the generic Exception raises with custom exception classes: \
             `ValidationError` for missing fields and `AuthenticationError` for invalid credentials. \
             Define both classes in the same file, inheriting from Exception.")),
            vec![complete(),
                 file_has("auth.py", &["class ValidationError", "class AuthenticationError", "raise ValidationError", "raise AuthenticationError"]),
                 file_lacks("auth.py", &["raise Exception"])]),
            vec![p])
    }
    v.push(scen!("errh_custom_exceptions", Category::ErrorHandling, Difficulty::Medium, I, s_custom_exceptions));

    fn s_result_type(dir: &Path) -> SetupResult {
        let p = ap(dir, "parser.rs");
        std::fs::write(&p, r#"pub fn parse_int(s: &str) -> i64 {
    s.trim().parse::<i64>().unwrap()
}

pub fn parse_pair(s: &str) -> (i64, i64) {
    let parts: Vec<&str> = s.split(',').collect();
    let a = parts[0].trim().parse::<i64>().unwrap();
    let b = parts[1].trim().parse::<i64>().unwrap();
    (a, b)
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Both functions in {p} use unwrap() which will panic on bad input. \
             Refactor them to return Result types instead. \
             `parse_int` should return `Result<i64, String>` and `parse_pair` should return `Result<(i64, i64), String>`.")),
            vec![complete(),
                 file_has("parser.rs", &["Result<i64", "Result<(i64, i64)"]),
                 file_lacks("parser.rs", &[".unwrap()"])]),
            vec![p])
    }
    v.push(scen!("errh_result_type_rust", Category::ErrorHandling, Difficulty::Medium, I, s_result_type));

    fn s_graceful_degradation(dir: &Path) -> SetupResult {
        let p = ap(dir, "weather.py");
        std::fs::write(&p, r#"import requests

def get_weather(city: str) -> dict:
    resp = requests.get(f"https://api.weather.com/{city}", timeout=5)
    resp.raise_for_status()
    data = resp.json()
    return {
        "temperature": data["main"]["temp"],
        "description": data["weather"][0]["description"],
        "humidity": data["main"]["humidity"],
    }
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Add graceful error handling to {p}:\n\
             1. Catch network errors (requests.RequestException) and return a dict with 'error' key\n\
             2. Catch JSON decode errors and return an error dict\n\
             3. Catch KeyError for missing fields and return partial data with a 'warning' key\n\
             Never let the function raise an exception to callers.")),
            vec![complete(),
                 file_has("weather.py", &["except", "error", "RequestException"]),
                 file_lacks("weather.py", &["\n    resp.raise_for_status()\n    data = resp.json()"])]),
            vec![p])
    }
    v.push(scen!("errh_graceful_degradation", Category::ErrorHandling, Difficulty::Medium, I, s_graceful_degradation));

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
