//! Patch v2 — Test 04: Rename field across tightly-coupled generated code
//!
//! A 3-file system simulating a config-driven pipeline where a field name
//! must be renamed from `user_name` to `display_name` across config,
//! processing, and validation — but ONLY for the "profile" entity.
//!
//! The trick: there are 3 entities (profile, session, audit_log) and all
//! three have a `user_name` field. Only the profile entity's `user_name`
//! should be renamed. The session and audit_log `user_name` fields must
//! remain unchanged because they reference the login username, not the
//! display name.
//!
//! Files:
//! - config.py: Entity schemas with field definitions (3 entities)
//! - processor.py: Pipeline that reads/writes fields by name
//! - validator.py: Validation rules referencing field names
//!
//! Red herrings:
//! - All three entities define `user_name` identically in config.py
//! - processor.py has a generic `_copy_field()` that references `user_name`
//!   for ALL entities — only the profile branch should change
//! - validator.py has a `_RESERVED_NAMES` list containing "user_name" that
//!   should NOT be modified (it's a historical blocklist)

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let config_file = ap(dir, "config.py");
        std::fs::write(&config_file, r#""""Entity configuration schemas."""

PROFILE_SCHEMA = {
    "entity": "profile",
    "fields": [
        {"name": "id", "type": "int", "required": True},
        {"name": "user_name", "type": "str", "required": True, "max_length": 50},
        {"name": "email", "type": "str", "required": True},
        {"name": "bio", "type": "str", "required": False, "max_length": 500},
    ],
    "primary_key": "id",
}

SESSION_SCHEMA = {
    "entity": "session",
    "fields": [
        {"name": "id", "type": "int", "required": True},
        {"name": "user_name", "type": "str", "required": True, "max_length": 50},
        {"name": "token", "type": "str", "required": True},
        {"name": "expires_at", "type": "str", "required": True},
    ],
    "primary_key": "id",
}

AUDIT_LOG_SCHEMA = {
    "entity": "audit_log",
    "fields": [
        {"name": "id", "type": "int", "required": True},
        {"name": "user_name", "type": "str", "required": True, "max_length": 50},
        {"name": "action", "type": "str", "required": True},
        {"name": "timestamp", "type": "str", "required": True},
    ],
    "primary_key": "id",
}

ALL_SCHEMAS = [PROFILE_SCHEMA, SESSION_SCHEMA, AUDIT_LOG_SCHEMA]


def get_schema(entity_name: str) -> dict | None:
    """Look up a schema by entity name."""
    for schema in ALL_SCHEMAS:
        if schema["entity"] == entity_name:
            return schema
    return None


def get_field_names(entity_name: str) -> list[str]:
    """Return field names for an entity."""
    schema = get_schema(entity_name)
    if schema is None:
        return []
    return [f["name"] for f in schema["fields"]]
"#).unwrap();

        let processor_file = ap(dir, "processor.py");
        std::fs::write(&processor_file, r#""""Data processor — transforms raw data based on entity schemas."""

from config import get_schema, get_field_names


def process_profile(data: dict) -> dict:
    """Process a profile record.

    Extracts and normalizes fields according to the profile schema.
    """
    schema = get_schema("profile")
    result = {}
    for field in schema["fields"]:
        fname = field["name"]
        if fname in data:
            value = data[fname]
            if field["type"] == "str" and isinstance(value, str):
                value = value.strip()
            result[fname] = value
    # Add computed display field
    result["display"] = result.get("user_name", "Anonymous")
    return result


def process_session(data: dict) -> dict:
    """Process a session record.

    Extracts fields according to the session schema.
    The user_name here is the login username — different from profile display name.
    """
    schema = get_schema("session")
    result = {}
    for field in schema["fields"]:
        fname = field["name"]
        if fname in data:
            result[fname] = data[fname]
    return result


def process_audit_log(data: dict) -> dict:
    """Process an audit log record.

    The user_name here tracks who performed the action — must stay as user_name.
    """
    schema = get_schema("audit_log")
    result = {}
    for field in schema["fields"]:
        fname = field["name"]
        if fname in data:
            result[fname] = data[fname]
    return result


def _copy_field(data: dict, field_name: str) -> str | None:
    """Generic helper to extract a field value.

    Used internally by various processors. References user_name
    as a common field across entities.
    """
    return data.get(field_name)
"#).unwrap();

        let validator_file = ap(dir, "validator.py");
        std::fs::write(&validator_file, r#""""Validation rules for entity data."""

from config import get_schema

# Historical reserved field names — do NOT modify this list.
# These names were used in the legacy v0 API and are blocked
# from being reused as custom field names.
_RESERVED_NAMES = ["user_name", "password", "admin", "root", "system"]


def validate_profile(data: dict) -> list[str]:
    """Validate a profile record. Returns list of error messages."""
    errors = []
    schema = get_schema("profile")

    for field in schema["fields"]:
        fname = field["name"]
        if field["required"] and fname not in data:
            errors.append(f"Missing required field: {fname}")
            continue
        if fname in data and field["type"] == "str":
            value = data[fname]
            max_len = field.get("max_length")
            if max_len and len(str(value)) > max_len:
                errors.append(f"{fname} exceeds max length {max_len}")

    # Profile-specific: user_name must not be empty
    if "user_name" in data and not data["user_name"].strip():
        errors.append("user_name must not be empty")

    return errors


def validate_session(data: dict) -> list[str]:
    """Validate a session record. Returns list of error messages."""
    errors = []
    schema = get_schema("session")

    for field in schema["fields"]:
        fname = field["name"]
        if field["required"] and fname not in data:
            errors.append(f"Missing required field: {fname}")

    # Session user_name is the login — must exist
    if "user_name" in data and not data["user_name"].strip():
        errors.append("user_name must not be empty")

    return errors


def validate_audit_log(data: dict) -> list[str]:
    """Validate an audit log record."""
    errors = []
    schema = get_schema("audit_log")

    for field in schema["fields"]:
        fname = field["name"]
        if field["required"] and fname not in data:
            errors.append(f"Missing required field: {fname}")

    return errors
"#).unwrap();

        let test_file = ap(dir, "test_entities.py");
        std::fs::write(&test_file, r#"from config import get_schema, get_field_names, PROFILE_SCHEMA, SESSION_SCHEMA, AUDIT_LOG_SCHEMA
from processor import process_profile, process_session, process_audit_log
from validator import validate_profile, validate_session, _RESERVED_NAMES


def test_profile_schema_has_display_name():
    """Profile schema should use 'display_name' instead of 'user_name'."""
    field_names = get_field_names("profile")
    assert "display_name" in field_names, \
        f"Profile should have 'display_name' field, got: {field_names}"
    assert "user_name" not in field_names, \
        f"Profile should NOT have 'user_name' field, got: {field_names}"


def test_session_schema_still_has_user_name():
    """Session schema must still use 'user_name'."""
    field_names = get_field_names("session")
    assert "user_name" in field_names, \
        f"Session should have 'user_name' field, got: {field_names}"
    assert "display_name" not in field_names, \
        f"Session should NOT have 'display_name', got: {field_names}"


def test_audit_log_schema_still_has_user_name():
    """Audit log schema must still use 'user_name'."""
    field_names = get_field_names("audit_log")
    assert "user_name" in field_names, \
        f"Audit log should have 'user_name' field, got: {field_names}"


def test_process_profile_uses_display_name():
    """process_profile should read 'display_name' from input data."""
    data = {"id": 1, "display_name": "Alice W.", "email": "alice@example.com"}
    result = process_profile(data)
    assert "display_name" in result, \
        f"Processed profile should have 'display_name': {result}"
    assert result["display_name"] == "Alice W."
    assert result["display"] == "Alice W.", \
        f"display field should use display_name value, got: {result['display']}"


def test_process_profile_anonymous_fallback():
    """process_profile should show 'Anonymous' when display_name is missing."""
    data = {"id": 1, "email": "anon@example.com"}
    result = process_profile(data)
    assert result["display"] == "Anonymous", \
        f"display should be 'Anonymous' when display_name missing, got: {result['display']}"


def test_process_session_uses_user_name():
    """process_session should still use 'user_name'."""
    data = {"id": 1, "user_name": "alice", "token": "abc", "expires_at": "2025-01-01"}
    result = process_session(data)
    assert "user_name" in result, \
        f"Processed session should have 'user_name': {result}"
    assert result["user_name"] == "alice"


def test_process_audit_log_uses_user_name():
    """process_audit_log should still use 'user_name'."""
    data = {"id": 1, "user_name": "alice", "action": "login", "timestamp": "2025-01-01T00:00:00"}
    result = process_audit_log(data)
    assert "user_name" in result, \
        f"Processed audit log should have 'user_name': {result}"


def test_validate_profile_checks_display_name():
    """Validator should check 'display_name' for profile, not 'user_name'."""
    data = {"id": 1, "display_name": "  ", "email": "a@b.com"}
    errors = validate_profile(data)
    assert any("display_name" in e for e in errors), \
        f"Validation should flag empty display_name, got: {errors}"


def test_validate_session_checks_user_name():
    """Session validation should still check 'user_name'."""
    data = {"id": 1, "user_name": "  ", "token": "abc", "expires_at": "2025-01-01"}
    errors = validate_session(data)
    assert any("user_name" in e for e in errors), \
        f"Session validation should flag empty user_name, got: {errors}"


def test_reserved_names_unchanged():
    """The reserved names list must not be modified."""
    assert "user_name" in _RESERVED_NAMES, \
        f"_RESERVED_NAMES should still contain 'user_name': {_RESERVED_NAMES}"


if __name__ == "__main__":
    test_profile_schema_has_display_name()
    test_session_schema_still_has_user_name()
    test_audit_log_schema_still_has_user_name()
    test_process_profile_uses_display_name()
    test_process_profile_anonymous_fallback()
    test_process_session_uses_user_name()
    test_process_audit_log_uses_user_name()
    test_validate_profile_checks_display_name()
    test_validate_session_checks_user_name()
    test_reserved_names_unchanged()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(
            "The `test_entities.py` suite is failing. Product changed how we \
             represent profile data, but sibling entities (session, audit_log) \
             are expected to keep their current shape — their tests still \
             pass and must continue to pass.\n\n\
             Read every source file and the failing test suite to understand \
             what the profile code path needs to look like now. Make the \
             necessary changes across config.py, processor.py, and \
             validator.py so `python3 test_entities.py` prints \
             ALL_TESTS_PASSED without breaking the session and audit_log \
             tests.\n\n\
             Apply your patches WITHOUT running the code first, then run the \
             tests. If they fail, read the errors and iterate until all tests \
             pass."
            .to_string()
        ),
            vec![
                complete(),
                succeeded("shell"),
                // Primary: all tests pass — the suite checks that profile
                // uses the new name, session/audit_log still use user_name,
                // and _RESERVED_NAMES is unchanged.
                run_has("python3 test_entities.py", &["ALL_TESTS_PASSED"]),
                // The historical reserved-names list must not be modified.
                file_has("validator.py", &[
                    "_RESERVED_NAMES = [\"user_name\", \"password\", \"admin\", \"root\", \"system\"]",
                ]),
            ]),
            vec![config_file, processor_file, validator_file]),
            vec![test_file])
    }
    v.push(scen!("xhard_patch_04_selective_field_rename", Category::Patch, Difficulty::Hard, I, setup));
}
