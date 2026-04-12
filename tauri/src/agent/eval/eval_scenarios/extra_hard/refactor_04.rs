//! Refactor v2 — Test 04: Dangerous Consolidation
//!
//! Three validator modules that look nearly identical but have subtle
//! differences that make naive consolidation break correctness.
//!
//! Files:
//! - email_validator.py: validates email format, has a `_preprocess` that
//!   lowercases input (emails are case-insensitive in the local part for
//!   this system's convention)
//! - username_validator.py: validates usernames, has a `_preprocess` that
//!   strips whitespace but PRESERVES case (usernames are case-sensitive)
//! - password_validator.py: validates passwords, has a `_preprocess` that
//!   does NOTHING (passwords must not be modified at all)
//! - test_validators.py: comprehensive tests
//!
//! The prompt asks to consolidate the three validators into a single
//! base class with shared validation logic. The trap: the `_preprocess`
//! methods differ in critical ways. A naive "extract base class with
//! shared _preprocess" that lowercases everything (or strips everything)
//! will break username or password tests.
//!
//! Legitimate refactoring: the `validate()` method structure IS genuinely
//! duplicated (check empty, preprocess, run rules, return result). That
//! CAN be extracted into a base class — but `_preprocess` must remain
//! overridden per subclass with its original behavior.
//!
//! Additional trap: password_validator has a `_check_common_passwords()`
//! method that references an inline list. It looks like dead code because
//! `validate()` doesn't call it directly — but `full_validate()` does,
//! and the test calls `full_validate()`.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let email_file = ap(dir, "email_validator.py");
        std::fs::write(&email_file, r#"import re

class EmailValidator:
    """Validates email addresses."""

    def _preprocess(self, value: str) -> str:
        """Prepare input for validation."""
        return value.strip().lower()

    def _check_format(self, value: str) -> str | None:
        """Return error message if format is invalid, None if ok."""
        pattern = r'^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'
        if not re.match(pattern, value):
            return "invalid email format"
        return None

    def _check_length(self, value: str) -> str | None:
        if len(value) > 254:
            return "email too long"
        return None

    def validate(self, value: str) -> dict:
        """Validate an email address.

        Returns dict with 'valid' (bool) and 'errors' (list of strings).
        """
        if not value or not value.strip():
            return {"valid": False, "errors": ["empty value"]}

        processed = self._preprocess(value)
        errors = []

        length_err = self._check_length(processed)
        if length_err:
            errors.append(length_err)

        format_err = self._check_format(processed)
        if format_err:
            errors.append(format_err)

        return {"valid": len(errors) == 0, "errors": errors}
"#).unwrap();

        let username_file = ap(dir, "username_validator.py");
        std::fs::write(&username_file, r#"import re

class UsernameValidator:
    """Validates usernames."""

    def _preprocess(self, value: str) -> str:
        """Prepare input for validation."""
        return value.strip()

    def _check_format(self, value: str) -> str | None:
        """Usernames: alphanumeric, underscores, hyphens, 3-30 chars."""
        pattern = r'^[a-zA-Z0-9_-]{3,30}$'
        if not re.match(pattern, value):
            return "invalid username format (3-30 alphanumeric, _, -)"
        return None

    def _check_length(self, value: str) -> str | None:
        if len(value) < 3:
            return "username too short"
        if len(value) > 30:
            return "username too long"
        return None

    def validate(self, value: str) -> dict:
        """Validate a username.

        Returns dict with 'valid' (bool) and 'errors' (list of strings).
        """
        if not value or not value.strip():
            return {"valid": False, "errors": ["empty value"]}

        processed = self._preprocess(value)
        errors = []

        length_err = self._check_length(processed)
        if length_err:
            errors.append(length_err)

        format_err = self._check_format(processed)
        if format_err:
            errors.append(format_err)

        return {"valid": len(errors) == 0, "errors": errors}
"#).unwrap();

        let password_file = ap(dir, "password_validator.py");
        std::fs::write(&password_file, r#"import re

COMMON_PASSWORDS = [
    "password", "123456", "password1", "qwerty", "abc123",
    "letmein", "admin", "welcome", "monkey", "master",
]

class PasswordValidator:
    """Validates passwords."""

    def _preprocess(self, value: str) -> str:
        """Prepare input for validation."""
        return value

    def _check_format(self, value: str) -> str | None:
        """Passwords: at least one upper, one lower, one digit."""
        if not re.search(r'[A-Z]', value):
            return "must contain an uppercase letter"
        if not re.search(r'[a-z]', value):
            return "must contain a lowercase letter"
        if not re.search(r'[0-9]', value):
            return "must contain a digit"
        return None

    def _check_length(self, value: str) -> str | None:
        if len(value) < 8:
            return "password too short (min 8)"
        if len(value) > 128:
            return "password too long"
        return None

    def _check_common_passwords(self, value: str) -> str | None:
        """Reject commonly-used passwords."""
        if value.lower() in COMMON_PASSWORDS:
            return "password is too common"
        return None

    def validate(self, value: str) -> dict:
        """Validate a password.

        Returns dict with 'valid' (bool) and 'errors' (list of strings).
        """
        if not value or not value.strip():
            return {"valid": False, "errors": ["empty value"]}

        processed = self._preprocess(value)
        errors = []

        length_err = self._check_length(processed)
        if length_err:
            errors.append(length_err)

        format_err = self._check_format(processed)
        if format_err:
            errors.append(format_err)

        return {"valid": len(errors) == 0, "errors": errors}

    def full_validate(self, value: str) -> dict:
        """Full validation including common password check."""
        result = self.validate(value)
        if result["valid"]:
            common_err = self._check_common_passwords(value)
            if common_err:
                result["valid"] = False
                result["errors"].append(common_err)
        return result
"#).unwrap();

        let test_file = ap(dir, "test_validators.py");
        std::fs::write(&test_file, r#"from email_validator import EmailValidator
from username_validator import UsernameValidator
from password_validator import PasswordValidator

def test_email_valid():
    v = EmailValidator()
    r = v.validate("User@Example.COM")
    assert r["valid"], f"should accept valid email, errors: {r['errors']}"

def test_email_case_insensitive():
    v = EmailValidator()
    r = v.validate("ADMIN@EXAMPLE.COM")
    assert r["valid"], "uppercase email should be valid after lowercasing"

def test_email_invalid():
    v = EmailValidator()
    r = v.validate("not-an-email")
    assert not r["valid"]
    assert any("format" in e for e in r["errors"])

def test_email_empty():
    v = EmailValidator()
    r = v.validate("")
    assert not r["valid"]
    assert "empty value" in r["errors"]

def test_username_valid():
    v = UsernameValidator()
    r = v.validate("Alice_123")
    assert r["valid"], f"should accept valid username, errors: {r['errors']}"

def test_username_case_preserved():
    v = UsernameValidator()
    r = v.validate("Alice")
    assert r["valid"]
    processed = v._preprocess("Alice")
    assert processed == "Alice", f"username preprocessing changed case, got {processed!r}"

def test_username_too_short():
    v = UsernameValidator()
    r = v.validate("ab")
    assert not r["valid"]

def test_username_whitespace_stripped():
    v = UsernameValidator()
    r = v.validate("  valid_user  ")
    assert r["valid"], "whitespace should be stripped"

def test_password_valid():
    v = PasswordValidator()
    r = v.validate("MyP@ss1234")
    assert r["valid"], f"should accept, errors: {r['errors']}"

def test_password_not_modified():
    v = PasswordValidator()
    processed = v._preprocess("  MyPass1  ")
    assert processed == "  MyPass1  ", \
        f"password preprocessing changed value, got {processed!r}"

def test_password_needs_uppercase():
    v = PasswordValidator()
    r = v.validate("lowercase1")
    assert not r["valid"]
    assert any("uppercase" in e for e in r["errors"])

def test_password_too_short():
    v = PasswordValidator()
    r = v.validate("Ab1")
    assert not r["valid"]

def test_password_common_rejected():
    v = PasswordValidator()
    r = v.full_validate("Password1")
    assert not r["valid"], "common password should be rejected"
    assert any("common" in e for e in r["errors"])

def test_password_full_validate_good():
    v = PasswordValidator()
    r = v.full_validate("Str0ngP@ssw0rd!")
    assert r["valid"], f"should pass full validation, errors: {r['errors']}"

def test_validate_consolidated():
    """validate() should be defined once in a shared base, not duplicated."""
    import inspect
    # After consolidation, the validate() method should live in a base class.
    # Count how many of the 3 classes define validate() in their OWN source
    # (not inherited). If all 3 still have it, no consolidation happened.
    own_validate_count = 0
    for cls in [EmailValidator, UsernameValidator, PasswordValidator]:
        if 'validate' in cls.__dict__:
            own_validate_count += 1
    assert own_validate_count <= 1, (
        f"{own_validate_count} of 3 validator classes define their own validate() method. "
        f"Expected at most 1 (in a shared base class) after consolidation."
    )

if __name__ == "__main__":
    test_email_valid()
    test_email_case_insensitive()
    test_email_invalid()
    test_email_empty()
    test_username_valid()
    test_username_case_preserved()
    test_username_too_short()
    test_username_whitespace_stripped()
    test_password_valid()
    test_password_not_modified()
    test_password_needs_uppercase()
    test_password_too_short()
    test_password_common_rejected()
    test_password_full_validate_good()
    test_validate_consolidated()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(
            "The three validator modules (email_validator.py, username_validator.py, \
             password_validator.py) have nearly identical structure. Refactor them:\n\
             - Extract a shared base class with the common validate() pattern.\n\
             - Consolidate duplicated methods.\n\
             - Remove dead code (e.g. unused helper methods).\n\n\
             Step 1: Read all files and identify the common pattern.\n\
             Step 2: Apply your refactoring.\n\
             Step 3: Run the existing `python3 test_validators.py` to verify. If tests fail, \
             reconsider — some seemingly identical methods may differ in critical ways."
            .to_string()
        ),
            vec![
                complete(),
                succeeded("shell"),
                // Primary: tests must pass — they verify email case-insensitivity,
                // username case-preservation, password not modified, common
                // password rejection, and all validation rules.
                run_has("python3 test_validators.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![email_file, username_file, password_file]),
            vec![test_file])
    }
    v.push(scen!("xhard_refactor_04_dangerous_consolidation", Category::Refactor, Difficulty::Hard, I, setup));
}
