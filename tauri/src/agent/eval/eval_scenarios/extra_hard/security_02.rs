//! Security — Test 02: Multi-vector injection sweep
//!
//! Three independent vulnerabilities in a toy HTTP-ish request handler:
//!
//! 1. **SQL injection** via f-string concatenation in `find_user()`.
//!    Fix: parameterized query (`?` placeholder).
//! 2. **Path traversal** in `serve_file()` — joins user input to a base dir
//!    without canonicalizing. `../etc/passwd` escapes the jail.
//!    Fix: resolve via `pathlib.Path.resolve()` and verify it's under the
//!    jail root.
//! 3. **Insecure deserialization** in `load_session()` — uses `pickle.loads`
//!    on cookie data. Fix: switch to `json.loads` (the existing serializer
//!    uses only dict/str/int, so JSON suffices).
//!
//! A red-team script exercises all three attacks and asserts they fail.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let app = ap(dir, "app.py");
        std::fs::write(&app, r#""""Vulnerable toy endpoint surface. Audit & fix."""

import os
import pickle
import sqlite3
from pathlib import Path


_DB_PATH = "users.db"
JAIL_DIR = Path("public").resolve()


def _init_db():
    conn = sqlite3.connect(_DB_PATH)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username TEXT UNIQUE,
            email TEXT
        );
        INSERT OR IGNORE INTO users (id, username, email) VALUES
            (1, 'alice', 'alice@example.com'),
            (2, 'bob',   'bob@example.com'),
            (3, 'admin', 'admin@example.com');
        """
    )
    conn.commit()
    return conn


def find_user(username: str) -> dict | None:
    """Look up a user by username. Returns user dict or None."""
    conn = _init_db()
    cur = conn.cursor()
    query = f"SELECT id, username, email FROM users WHERE username = '{username}'"
    rows = cur.execute(query).fetchall()
    conn.close()
    if not rows:
        return None
    row = rows[0]
    return {"id": row[0], "username": row[1], "email": row[2]}


def serve_file(relative_path: str) -> bytes:
    """Read a file from the public jail. Returns the raw bytes.

    Raises FileNotFoundError if the path does not exist.
    """
    JAIL_DIR.mkdir(exist_ok=True)
    # Seed the jail with one file so legitimate requests work.
    sample = JAIL_DIR / "hello.txt"
    if not sample.exists():
        sample.write_text("hello from the public jail\n")
    full = JAIL_DIR / relative_path
    return full.read_bytes()


def load_session(cookie_bytes: bytes) -> dict:
    """Parse a session cookie (produced by `save_session`)."""
    return pickle.loads(cookie_bytes)


def save_session(data: dict) -> bytes:
    """Serialize a session dict. Deliberately simple shape."""
    # Only called with JSON-serializable primitives.
    import json
    return json.dumps(data).encode()
"#).unwrap();

        let attack = ap(dir, "test_redteam.py");
        std::fs::write(&attack, r#""""Red team: exercise each attack vector, require all three blocked."""

import os
import sys
import pickle
from pathlib import Path

import app


def test_sqli_blocked():
    # A classic UNION/OR 1=1 payload. If the query is parameterized, this
    # becomes a literal username lookup and returns None.
    payload = "' OR '1'='1"
    result = app.find_user(payload)
    assert result is None, f"SQL injection returned a row: {result}"

    # Legitimate lookup still works.
    row = app.find_user("alice")
    assert row is not None and row["username"] == "alice"


def test_path_traversal_blocked():
    # Create a "secret" outside the jail.
    secret = Path("outside_secret.txt").resolve()
    secret.write_text("TOP_SECRET_DO_NOT_READ")
    try:
        # Compute a relative path that escapes the jail.
        jail = Path("public").resolve()
        rel = os.path.relpath(secret, jail)
        try:
            result = app.serve_file(rel)
        except (FileNotFoundError, PermissionError, ValueError):
            result = b""
        assert b"TOP_SECRET" not in result, (
            f"path traversal succeeded: read {len(result)} bytes from outside jail"
        )
        # Legitimate read still works.
        assert b"hello" in app.serve_file("hello.txt")
    finally:
        secret.unlink(missing_ok=True)


def test_pickle_rce_blocked():
    # A pickle payload that executes code on deserialization.
    class Boom:
        def __reduce__(self):
            return (os.system, ("touch pwned.txt",))

    payload = pickle.dumps(Boom())
    try:
        app.load_session(payload)
    except Exception:
        pass  # expected — the fix should not accept pickle input
    assert not Path("pwned.txt").exists(), (
        "pickle deserialization executed arbitrary code — `load_session` "
        "must not use pickle.loads"
    )

    # Legitimate session round-trip still works.
    cookie = app.save_session({"user_id": 1, "role": "admin"})
    parsed = app.load_session(cookie)
    assert parsed == {"user_id": 1, "role": "admin"}


if __name__ == "__main__":
    test_sqli_blocked()
    test_path_traversal_blocked()
    test_pickle_rce_blocked()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(
            "Audit `app.py` for injection vulnerabilities. There are THREE \
             separate attack surfaces — find and fix all of them so that \
             `python3 test_redteam.py` prints ALL_TESTS_PASSED.\n\n\
             Constraints:\n\
             - Legitimate requests must still work (existing shape of return \
               values preserved).\n\
             - Do not widen the public function signatures.\n\n\
             Read only the source and the test output; don't try to reverse \
             the blocked test file."
            .to_string()
        ),
            vec![
                complete(),
                succeeded("shell"),
                run_has("python3 test_redteam.py", &["ALL_TESTS_PASSED"]),
                // Direct file checks — each fix has a canonical shape.
                // SQL injection: parameterized query uses a `?` placeholder.
                file_has("app.py", &["?"]),
                // Pickle must be gone from load_session (fix uses json).
                file_lacks("app.py", &["pickle.loads"]),
            ]),
            vec![app]),
            vec![attack])
    }
    v.push(scen!("xhard_security_02_injection_sweep", Category::Security, Difficulty::Hard, I, setup));
}
