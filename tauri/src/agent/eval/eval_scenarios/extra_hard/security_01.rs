//! Security — Test 01: Triple-vulnerability auth audit
//!
//! Single-file `auth.py` with three real vulnerabilities:
//!
//! 1. `check_token()` uses char-by-char `==` on secret tokens — leaks timing
//!    information that lets an attacker recover the token one byte at a time.
//!    Fix: `hmac.compare_digest`.
//! 2. `change_password()` does NOT require a CSRF token — trivially CSRF-able.
//!    Fix: require `csrf_token` to match a value from the session store; reject
//!    with HTTP 403 otherwise.
//! 3. `validate_email()` uses a regex with nested quantifiers `^([a-z0-9]+)+@`
//!    — catastrophic backtracking (ReDoS). A crafted 35-char input hangs the
//!    server for tens of seconds. Fix: use a non-catastrophic pattern (strip
//!    the nested quantifier).
//!
//! The test script exercises all three: source inspection for `compare_digest`,
//! behavioral check that CSRF rejects unsigned requests, and a time-budget
//! assertion that the pathological email input completes in <0.3s.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let auth = ap(dir, "auth.py");
        std::fs::write(&auth, r#""""Authentication helpers. Security-critical — review carefully."""

import hashlib
import re

# In a real app this comes from a session store. For the eval it's a fixed set.
VALID_CSRF_TOKENS = {"csrf_alice_xyz", "csrf_bob_abc"}
STORED_TOKEN = "super_secret_token_42"


def _hash_password(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


def check_token(user_token: str) -> bool:
    """Return True if user_token matches the stored token."""
    if len(user_token) != len(STORED_TOKEN):
        return False
    for a, b in zip(user_token, STORED_TOKEN):
        if a != b:
            return False
    return True


def change_password(user_id: int, new_password: str, csrf_token: str | None = None) -> dict:
    """Update a user's password. Returns a response dict with `status`.

    status 200 on success, 403 on auth failure.
    """
    hashed = _hash_password(new_password)
    return {"status": 200, "user_id": user_id, "password_hash": hashed}


EMAIL_RE = re.compile(r"^([a-zA-Z0-9]+)+@([a-zA-Z0-9]+)+\.[a-zA-Z]+$")


def validate_email(email: str) -> bool:
    """Return True if `email` matches a basic email pattern."""
    return EMAIL_RE.match(email) is not None
"#).unwrap();

        let test = ap(dir, "test_security.py");
        std::fs::write(&test, r#""""Security audit: verify all three vulns are fixed."""

import time
import pathlib
import sys

import auth


def test_token_uses_constant_time_compare():
    src = pathlib.Path(__file__).parent.joinpath("auth.py").read_text()
    # Accept any constant-time primitive: hmac.compare_digest or secrets.compare_digest
    ok = ("compare_digest" in src) or ("constant_time" in src)
    assert ok, (
        "check_token must use a constant-time comparison primitive "
        "(hmac.compare_digest / secrets.compare_digest)."
    )
    # Functional: still returns True for the right token and False otherwise.
    assert auth.check_token(auth.STORED_TOKEN) is True
    assert auth.check_token("wrong_token_exact_len_match_xx") is False


def test_csrf_rejects_unsigned():
    r = auth.change_password(1, "new_pw")
    assert r["status"] == 403, f"missing-CSRF must be 403, got {r}"

    r = auth.change_password(1, "new_pw", csrf_token="not_in_session")
    assert r["status"] == 403, f"bad-CSRF must be 403, got {r}"

    r = auth.change_password(1, "new_pw", csrf_token="csrf_alice_xyz")
    assert r["status"] == 200, f"valid-CSRF must be 200, got {r}"
    assert "password_hash" in r


def test_email_regex_no_redos():
    # Pathological input for nested-quantifier regex. A vulnerable pattern
    # takes >10s; a fixed pattern returns in microseconds.
    pathological = "a" * 35 + "!"
    start = time.perf_counter()
    result = auth.validate_email(pathological)
    elapsed = time.perf_counter() - start
    assert elapsed < 0.3, (
        f"validate_email took {elapsed:.2f}s on 36-char input — ReDoS not fixed"
    )
    assert result is False
    # Sanity: real emails still validate.
    assert auth.validate_email("alice@example.com") is True
    assert auth.validate_email("not-an-email") is False


if __name__ == "__main__":
    test_token_uses_constant_time_compare()
    test_csrf_rejects_unsigned()
    test_email_regex_no_redos()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(
            "You are auditing `auth.py` for security issues. The file has \
             THREE real vulnerabilities. Find and fix all of them so that \
             `python3 test_security.py` prints ALL_TESTS_PASSED.\n\n\
             Run the tests before and after your fix. Do not change public \
             function names or return shapes except where a fix demands it \
             (the CSRF fix must make `change_password` reject requests that \
             don't supply a valid csrf_token — use HTTP status 403).\n\n\
             Read only the source and the test output; don't try to reverse \
             the blocked test file directly."
            .to_string()
        ),
            vec![
                complete(),
                succeeded("shell"),
                run_has("python3 test_security.py", &["ALL_TESTS_PASSED"]),
                // Explicit file-level checks for each fix so the rubric is
                // unambiguous even if the model's test run flakes.
                file_has("auth.py", &["compare_digest"]),
            ]),
            vec![auth]),
            vec![test])
    }
    v.push(scen!("xhard_security_01_auth_triple", Category::Security, Difficulty::Hard, I, setup));
}
