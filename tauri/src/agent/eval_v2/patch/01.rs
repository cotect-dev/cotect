//! Patch v2 — Test 01: Coordinated API version migration
//!
//! A 3-file REST API client where the base URL, version header, and
//! response parser all reference "v1". The task is to migrate from
//! API v1 to v2 — but v2 wraps responses in a `{"data": ...}` envelope
//! that v1 does not use.
//!
//! The model must:
//! 1. Change the base URL from `/api/v1` to `/api/v2` in client.py
//! 2. Update the version header from `X-API-Version: 1` to `X-API-Version: 2`
//!    in auth.py — but NOT change the `X-Client-Version: 1.0` header which
//!    is the client library version, not the API version
//! 3. Update the response parser in parser.py to unwrap the `data` envelope
//!
//! Red herrings:
//! - auth.py has TWO version-related headers; only one should change
//! - client.py has a `_legacy_endpoint()` method referencing v1 that should
//!   NOT be changed (it's explicitly for backward-compatible fallback)
//! - parser.py has a `parse_error()` method that also references v1 error
//!   format strings — these should NOT change (error format didn't change)
//!
//! Doing any single edit in isolation breaks the integration test.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let client_file = ap(dir, "client.py");
        std::fs::write(&client_file, r#"from auth import make_headers
from parser import parse_response, parse_error

BASE_URL = "https://api.example.com/api/v1"


class APIClient:
    """REST client for the Example API."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._session_count = 0

    def get_user(self, user_id: str) -> dict:
        """Fetch a user by ID."""
        url = f"{BASE_URL}/users/{user_id}"
        headers = make_headers(self.api_key)
        raw = _simulate_request("GET", url, headers)
        if raw.get("error"):
            return parse_error(raw)
        return parse_response(raw)

    def list_users(self) -> list:
        """List all users."""
        url = f"{BASE_URL}/users"
        headers = make_headers(self.api_key)
        raw = _simulate_request("GET", url, headers)
        if raw.get("error"):
            return parse_error(raw)
        return parse_response(raw)

    def _legacy_endpoint(self, path: str) -> str:
        """Build a v1 endpoint URL for backward-compatible fallback.

        This is intentionally kept on v1 — some old integrations
        require it and it must NOT be changed during migration.
        """
        return f"https://api.example.com/api/v1/{path}"


def _simulate_request(method: str, url: str, headers: dict) -> dict:
    """Simulate an HTTP request (for testing without a real server).

    Returns different response shapes depending on the API version
    detected in the URL.
    """
    if "/api/v2/" in url:
        # V2 responses wrap everything in a data envelope
        if "users/" in url and not url.endswith("/users"):
            return {
                "data": {"id": "u123", "name": "Alice", "email": "alice@example.com"},
                "api_version": "2",
                "headers": headers,
            }
        else:
            return {
                "data": [
                    {"id": "u123", "name": "Alice", "email": "alice@example.com"},
                    {"id": "u456", "name": "Bob", "email": "bob@example.com"},
                ],
                "api_version": "2",
                "headers": headers,
            }
    else:
        # V1 responses return data directly (no envelope)
        if "users/" in url and not url.endswith("/users"):
            return {
                "id": "u123", "name": "Alice", "email": "alice@example.com",
                "api_version": "1",
                "headers": headers,
            }
        else:
            return [
                {"id": "u123", "name": "Alice", "email": "alice@example.com"},
                {"id": "u456", "name": "Bob", "email": "bob@example.com"},
            ]
"#).unwrap();

        let auth_file = ap(dir, "auth.py");
        std::fs::write(&auth_file, r#"def make_headers(api_key: str) -> dict:
    """Build request headers with authentication and version info.

    X-API-Version tracks which API version we're targeting.
    X-Client-Version tracks the version of THIS client library.
    """
    return {
        "Authorization": f"Bearer {api_key}",
        "X-API-Version": "1",
        "X-Client-Version": "1.0",
        "Content-Type": "application/json",
    }


def validate_key(api_key: str) -> bool:
    """Check that an API key has the expected format."""
    if not api_key or len(api_key) < 8:
        return False
    return api_key.startswith("ek_")
"#).unwrap();

        let parser_file = ap(dir, "parser.py");
        std::fs::write(&parser_file, r#"def parse_response(raw: dict) -> dict | list:
    """Parse a successful API response.

    Extracts the payload directly from the raw response dict.
    """
    # Remove internal metadata before returning
    result = dict(raw)
    result.pop("api_version", None)
    result.pop("headers", None)
    return result


def parse_error(raw: dict) -> dict:
    """Parse an error response.

    V1 error format: {"error": "message", "code": 400}
    This format is unchanged in v2 — only success responses changed.
    """
    return {
        "error": True,
        "message": raw.get("error", "Unknown error"),
        "code": raw.get("code", 500),
        "format": "v1_error",
    }
"#).unwrap();

        let test_file = ap(dir, "test_api.py");
        std::fs::write(&test_file, r#"from client import APIClient, BASE_URL
from auth import make_headers
from parser import parse_response

def test_base_url_is_v2():
    """After migration, base URL must target v2."""
    assert "/api/v2" in BASE_URL, f"BASE_URL should use v2: {BASE_URL}"
    assert "/api/v1" not in BASE_URL or "legacy" in BASE_URL.lower(), \
        f"BASE_URL still points to v1: {BASE_URL}"

def test_api_version_header():
    """The API version header must be '2'."""
    headers = make_headers("ek_testkey123")
    assert headers["X-API-Version"] == "2", \
        f"X-API-Version should be '2', got '{headers['X-API-Version']}'"

def test_client_version_unchanged():
    """The client library version must NOT change."""
    headers = make_headers("ek_testkey123")
    assert headers["X-Client-Version"] == "1.0", \
        f"X-Client-Version should remain '1.0', got '{headers['X-Client-Version']}'"

def test_get_user():
    """Fetching a single user should return the unwrapped user dict."""
    client = APIClient("ek_testkey123")
    user = client.get_user("u123")
    assert isinstance(user, dict), f"Expected dict, got {type(user)}"
    assert user.get("id") == "u123", f"Expected id 'u123', got {user}"
    assert user.get("name") == "Alice", f"Expected name 'Alice', got {user}"
    assert "data" not in user, f"Response should be unwrapped, got {user}"
    assert "api_version" not in user, f"Metadata should be stripped, got {user}"

def test_list_users():
    """Listing users should return a plain list."""
    client = APIClient("ek_testkey123")
    users = client.list_users()
    assert isinstance(users, list), f"Expected list, got {type(users)}"
    assert len(users) == 2, f"Expected 2 users, got {len(users)}"
    assert users[0]["name"] == "Alice"
    assert users[1]["name"] == "Bob"

def test_legacy_endpoint_untouched():
    """The legacy fallback must still reference v1."""
    client = APIClient("ek_testkey123")
    legacy = client._legacy_endpoint("health")
    assert "/api/v1/" in legacy, \
        f"Legacy endpoint should stay on v1: {legacy}"

if __name__ == "__main__":
    test_base_url_is_v2()
    test_api_version_header()
    test_client_version_unchanged()
    test_get_user()
    test_list_users()
    test_legacy_endpoint_untouched()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(format!(
            "We're migrating from API v1 to v2. The v2 API wraps all successful \
             responses in a {{\"data\": ...}} envelope. You need to make \
             coordinated changes across all source files so the client targets v2 \
             and correctly unwraps responses.\n\n\
             Step 1: Read all source files and understand the cross-file dependencies.\n\
             Step 2: Apply all necessary patches WITHOUT running the code first.\n\
             Step 3: Run the existing `python3 test_api.py` to verify. If tests fail, read the \
             errors and iterate until all tests pass.",
        )),
            vec![
                complete(),
                succeeded("shell"),
                // Primary: full test suite must pass
                run_has("python3 test_api.py", &["ALL_TESTS_PASSED"]),
                // URL must be updated to v2
                file_has("client.py", &["/api/v2"]),
                // Legacy endpoint must NOT change
                file_has("client.py", &["api/v1/{path}"]),
            ]),
            vec![client_file, auth_file, parser_file]),
            vec![test_file])
    }
    v.push(scen!("v2_patch_01_api_version_migration", Category::Patch, Difficulty::Hard, I, setup));
}
