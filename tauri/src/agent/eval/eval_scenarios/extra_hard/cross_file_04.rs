//! Cross-file v2 — Test 04: Add required parameter to shared function
//!
//! A logging system where `log_event()` in logger.py currently takes
//! (level, message). The task: add a required `source` parameter (the
//! module name producing the log) as the first argument. Every caller
//! across 3 other files must be updated.
//!
//! Files:
//! - logger.py: defines log_event(level, message) and LogBuffer
//! - auth.py: calls log_event from authentication handlers
//! - api.py: calls log_event from API request handlers
//! - jobs.py: calls log_event from background job runners
//!
//! The model must add the parameter AND update all callers with
//! appropriate source values. Missing any caller causes a TypeError
//! at runtime.
//!
//! Red herrings:
//! - logger.py has a `log_debug()` convenience function that wraps
//!   log_event — it must also be updated but is easy to miss
//! - api.py has a `_log_metric()` function that does NOT call
//!   log_event — it uses a completely separate metrics system
//! - jobs.py has a comment referencing an old `log()` function
//!   that no longer exists

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let logger_file = ap(dir, "logger.py");
        std::fs::write(&logger_file, r#"from datetime import datetime


class LogBuffer:
    """In-memory log buffer for testing and inspection."""

    def __init__(self):
        self._entries = []

    def append(self, entry: dict):
        self._entries.append(entry)

    def get_entries(self) -> list[dict]:
        return list(self._entries)

    def find_by_level(self, level: str) -> list[dict]:
        return [e for e in self._entries if e["level"] == level]

    def find_by_source(self, source: str) -> list[dict]:
        return [e for e in self._entries if e.get("source") == source]

    def clear(self):
        self._entries.clear()

    @property
    def count(self):
        return len(self._entries)


_buffer = LogBuffer()


def get_buffer() -> LogBuffer:
    return _buffer


def log_event(level: str, message: str) -> dict:
    """Log an event with level and message.

    Returns the log entry dict.
    """
    entry = {
        "timestamp": datetime.now().isoformat(),
        "level": level,
        "message": message,
    }
    _buffer.append(entry)
    return entry


def log_debug(message: str) -> dict:
    """Convenience: log a DEBUG-level message."""
    return log_event("DEBUG", message)
"#).unwrap();

        let auth_file = ap(dir, "auth.py");
        std::fs::write(&auth_file, r#"from logger import log_event


def login(username: str, password: str) -> dict:
    """Authenticate a user."""
    if not username or not password:
        log_event("WARN", f"Login attempt with empty credentials")
        return {"success": False, "error": "Missing credentials"}

    if username == "admin" and password == "secret":
        log_event("INFO", f"User '{username}' logged in successfully")
        return {"success": True, "user": username, "role": "admin"}

    log_event("WARN", f"Failed login attempt for user '{username}'")
    return {"success": False, "error": "Invalid credentials"}


def logout(username: str) -> dict:
    """Log out a user."""
    log_event("INFO", f"User '{username}' logged out")
    return {"success": True}


def change_password(username: str, old_pw: str, new_pw: str) -> dict:
    """Change a user's password."""
    if len(new_pw) < 8:
        log_event("WARN", f"Password change rejected for '{username}': too short")
        return {"success": False, "error": "Password too short"}
    log_event("INFO", f"Password changed for user '{username}'")
    return {"success": True}
"#).unwrap();

        let api_file = ap(dir, "api.py");
        std::fs::write(&api_file, r#"from logger import log_event


_metrics = []


def _log_metric(name: str, value: float):
    """Record a metric. Uses a completely separate metrics system."""
    _metrics.append({"name": name, "value": value})


def handle_get_users() -> dict:
    """Handle GET /users request."""
    log_event("INFO", "Fetching user list")
    _log_metric("api_requests", 1)
    return {"status": 200, "data": [{"id": 1, "name": "Alice"}]}


def handle_create_user(data: dict) -> dict:
    """Handle POST /users request."""
    name = data.get("name", "")
    if not name:
        log_event("ERROR", "Create user failed: missing name")
        return {"status": 400, "error": "Name required"}
    log_event("INFO", f"Created user '{name}'")
    _log_metric("api_requests", 1)
    return {"status": 201, "data": {"id": 2, "name": name}}


def handle_delete_user(user_id: int) -> dict:
    """Handle DELETE /users/:id request."""
    log_event("WARN", f"Deleting user {user_id}")
    return {"status": 200, "data": {"deleted": user_id}}
"#).unwrap();

        let jobs_file = ap(dir, "jobs.py");
        std::fs::write(&jobs_file, r#"from logger import log_event, log_debug


# NOTE: the old `log()` function was removed in v2.0.
# All logging now goes through log_event().


def run_cleanup() -> dict:
    """Run the daily cleanup job."""
    log_debug("Starting cleanup job")
    log_event("INFO", "Cleanup job completed: removed 42 stale records")
    return {"removed": 42}


def run_sync(target: str) -> dict:
    """Sync data with an external system."""
    log_event("INFO", f"Starting sync with {target}")
    if target == "invalid":
        log_event("ERROR", f"Sync failed: unknown target '{target}'")
        return {"success": False, "error": f"Unknown target: {target}"}
    log_event("INFO", f"Sync with {target} completed")
    return {"success": True, "target": target}


def run_report() -> dict:
    """Generate a daily report."""
    log_event("INFO", "Generating daily report")
    return {"report": "Daily summary", "items": 15}
"#).unwrap();

        let test_file = ap(dir, "test_logging.py");
        std::fs::write(&test_file, r#"from logger import log_event, log_debug, get_buffer
from auth import login, logout, change_password
from api import handle_get_users, handle_create_user, handle_delete_user
from jobs import run_cleanup, run_sync, run_report


def setup():
    get_buffer().clear()


def test_log_event_has_source():
    """log_event must accept source as the first parameter."""
    setup()
    entry = log_event("auth", "INFO", "test message")
    assert entry["source"] == "auth", f"Expected source 'auth', got {entry.get('source')}"
    assert entry["level"] == "INFO"
    assert entry["message"] == "test message"


def test_log_debug_has_source():
    """log_debug must also pass a source."""
    setup()
    entry = log_debug("jobs", "debug test")
    assert entry["source"] == "jobs", f"Expected source 'jobs', got {entry.get('source')}"
    assert entry["level"] == "DEBUG"


def test_buffer_find_by_source():
    """Buffer's find_by_source must work with the new field."""
    setup()
    log_event("auth", "INFO", "from auth")
    log_event("api", "INFO", "from api")
    log_event("auth", "WARN", "also from auth")
    auth_entries = get_buffer().find_by_source("auth")
    assert len(auth_entries) == 2, f"Expected 2 auth entries, got {len(auth_entries)}"


def test_auth_login_logs_with_source():
    """Auth module must pass source='auth' to log_event."""
    setup()
    login("admin", "secret")
    entries = get_buffer().find_by_source("auth")
    assert len(entries) > 0, "login should log with source='auth'"


def test_auth_logout_logs_with_source():
    setup()
    logout("admin")
    entries = get_buffer().find_by_source("auth")
    assert len(entries) > 0, "logout should log with source='auth'"


def test_auth_change_password_logs():
    setup()
    change_password("admin", "old", "newpassword123")
    entries = get_buffer().find_by_source("auth")
    assert len(entries) > 0, "change_password should log with source='auth'"


def test_api_get_users_logs_with_source():
    setup()
    handle_get_users()
    entries = get_buffer().find_by_source("api")
    assert len(entries) > 0, "handle_get_users should log with source='api'"


def test_api_create_user_logs_with_source():
    setup()
    handle_create_user({"name": "Test"})
    entries = get_buffer().find_by_source("api")
    assert len(entries) > 0, "handle_create_user should log with source='api'"


def test_api_delete_user_logs_with_source():
    setup()
    handle_delete_user(1)
    entries = get_buffer().find_by_source("api")
    assert len(entries) > 0, "handle_delete_user should log with source='api'"


def test_jobs_cleanup_logs_with_source():
    setup()
    run_cleanup()
    entries = get_buffer().find_by_source("jobs")
    assert len(entries) > 0, "run_cleanup should log with source='jobs'"


def test_jobs_sync_logs_with_source():
    setup()
    run_sync("external-db")
    entries = get_buffer().find_by_source("jobs")
    assert len(entries) > 0, "run_sync should log with source='jobs'"


def test_jobs_report_logs_with_source():
    setup()
    run_report()
    entries = get_buffer().find_by_source("jobs")
    assert len(entries) > 0, "run_report should log with source='jobs'"


def test_functionality_preserved():
    """Core functionality must still work."""
    setup()
    result = login("admin", "secret")
    assert result["success"] is True

    result = handle_create_user({"name": "NewUser"})
    assert result["status"] == 201

    result = run_sync("external-db")
    assert result["success"] is True

    result = run_cleanup()
    assert result["removed"] == 42


if __name__ == "__main__":
    test_log_event_has_source()
    test_log_debug_has_source()
    test_buffer_find_by_source()
    test_auth_login_logs_with_source()
    test_auth_logout_logs_with_source()
    test_auth_change_password_logs()
    test_api_get_users_logs_with_source()
    test_api_create_user_logs_with_source()
    test_api_delete_user_logs_with_source()
    test_jobs_cleanup_logs_with_source()
    test_jobs_sync_logs_with_source()
    test_jobs_report_logs_with_source()
    test_functionality_preserved()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(
            "The shared logging primitive in this project records log entries \
             with only a level and a message. Change its contract: it must now \
             take a required `source` string as the FIRST positional argument \
             (before level and message) and the resulting log entry dict must \
             carry a `source` field. Any convenience wrappers around it must \
             also accept and forward `source` as their first positional \
             argument.\n\n\
             Every call site in the project that produces log entries has to \
             be updated to pass a sensible source string identifying which \
             subsystem the log came from. Forgetting a single call site will \
             break the code at runtime. Find the call sites yourself.\n\n\
             Any helper that talks to a different subsystem (for example a \
             separate metrics mechanism) is out of scope and must not change.\n\n\
             Apply all edits first, then run the bundled test suite \
             (`python3 test_logging.py`) and iterate until it prints \
             ALL_TESTS_PASSED.".to_string()),
            vec![
                complete(),
                succeeded("shell"),
                // Logger: old signatures gone (new ones must accept `source`)
                file_lacks(&logger_file, &["def log_event(level: str, message: str)"]),
                file_lacks(&logger_file, &["def log_debug(message: str)"]),
                // Every caller file now mentions its own source label
                file_has(&auth_file, &["\"auth\""]),
                file_has(&api_file, &["\"api\""]),
                file_has(&jobs_file, &["\"jobs\""]),
                // Unrelated metrics helper preserved
                file_has(&api_file, &["def _log_metric"]),
                // End-to-end behaviour actually works
                run_has("python3 test_logging.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![logger_file, auth_file, api_file, jobs_file]),
            vec![test_file])
    }
    v.push(scen!("xhard_cross_file_04_add_parameter", Category::CrossFile, Difficulty::Hard, I, setup));
}
