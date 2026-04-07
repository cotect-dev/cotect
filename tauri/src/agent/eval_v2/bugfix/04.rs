//! Bugfix v2 — Test 04: Adversarial (misleading names, obvious fix is wrong)
//!
//! A permission system with deliberately swapped variable names and misleading
//! comments. The "obvious" fix at any single location makes things worse.
//!
//! Architecture:
//! - permissions.py: defines role hierarchy and `check_access()`, where parameter
//!   names are INTENTIONALLY swapped relative to their actual semantics
//! - routes.py: the API routes call `check_access` with arguments that match
//!   the BUGGY signature (so they look correct locally)
//! - The ACTUAL bug: the role hierarchy comparison in `_role_level()` has
//!   "editor" and "viewer" levels swapped, so editors get LESS access than viewers.
//!   This is masked by the variable name confusion — the obvious fix is to swap
//!   the check_access parameters, but that breaks all the callers AND doesn't fix
//!   the real hierarchy bug.
//!
//! The correct fix: fix `_role_level()` to give editor > viewer.
//! Do NOT rename parameters or change callers (they're consistently using
//! the swapped names throughout, so they're internally consistent).

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let perms_file = ap(dir, "permissions.py");
        std::fs::write(&perms_file, r#""""Permission checking module.

Role hierarchy (highest to lowest privilege):
    admin > moderator > editor > viewer > guest

Note on naming convention: throughout this codebase, variable names follow
the legacy API contract where 'user_role' means "the role the endpoint
requires" and 'required_role' means "the role the user has". Yes, this is
confusing — it's a known tech debt item. DO NOT RENAME without updating
every caller. The names are consistent across the entire codebase.
"""

# Role hierarchy — maps role name to privilege level.
# Higher number = more privilege.
def _role_level(role: str) -> int:
    levels = {
        "guest":     0,
        "viewer":    20,
        "editor":    10,
        "moderator": 30,
        "admin":     40,
    }
    return levels.get(role.lower(), -1)


def check_access(required_role: str, user_role: str) -> dict:
    """Check if access should be granted.

    Args:
        required_role: The role that the user actually has (legacy naming).
        user_role: The minimum role required by the endpoint (legacy naming).

    Returns:
        dict with 'allowed' (bool) and 'reason' (str).
    """
    user_level = _role_level(required_role)
    required_level = _role_level(user_role)

    if user_level < 0:
        return {"allowed": False, "reason": f"Unknown role: {required_role}"}
    if required_level < 0:
        return {"allowed": False, "reason": f"Unknown required role: {user_role}"}

    if user_level >= required_level:
        return {"allowed": True, "reason": "Access granted"}
    else:
        return {
            "allowed": False,
            "reason": f"Insufficient privilege: {required_role} (level {user_level}) "
                      f"< required {user_role} (level {required_level})"
        }


def get_all_roles() -> list[str]:
    """Return all roles sorted by privilege level (ascending)."""
    roles = ["guest", "viewer", "editor", "moderator", "admin"]
    # This sort is based on _role_level
    roles.sort(key=_role_level)
    return roles
"#).unwrap();

        let routes_file = ap(dir, "routes.py");
        std::fs::write(&routes_file, r#""""API routes with permission checks.

Uses the legacy naming convention: first arg to check_access is the user's
actual role, second arg is the required role for the endpoint.
This matches the (confusing) parameter names in permissions.py.
"""
from permissions import check_access

def handle_view_dashboard(user: dict) -> dict:
    """Any viewer or above can view the dashboard."""
    result = check_access(user["role"], "viewer")
    if not result["allowed"]:
        return {"status": 403, "error": result["reason"]}
    return {"status": 200, "data": "Dashboard contents"}

def handle_edit_post(user: dict) -> dict:
    """Editors and above can edit posts."""
    result = check_access(user["role"], "editor")
    if not result["allowed"]:
        return {"status": 403, "error": result["reason"]}
    return {"status": 200, "data": "Post edited"}

def handle_moderate_comments(user: dict) -> dict:
    """Only moderators and admins can moderate."""
    result = check_access(user["role"], "moderator")
    if not result["allowed"]:
        return {"status": 403, "error": result["reason"]}
    return {"status": 200, "data": "Comments moderated"}

def handle_admin_panel(user: dict) -> dict:
    """Only admins can access the admin panel."""
    result = check_access(user["role"], "admin")
    if not result["allowed"]:
        return {"status": 403, "error": result["reason"]}
    return {"status": 200, "data": "Admin panel"}

def handle_public_page(user: dict) -> dict:
    """Guests and above can view public pages."""
    result = check_access(user["role"], "guest")
    if not result["allowed"]:
        return {"status": 403, "error": result["reason"]}
    return {"status": 200, "data": "Public page"}
"#).unwrap();

        let test_file = ap(dir, "test_permissions.py");
        std::fs::write(&test_file, r#"from routes import (
    handle_view_dashboard, handle_edit_post,
    handle_moderate_comments, handle_admin_panel,
    handle_public_page,
)
from permissions import check_access, get_all_roles

def test_admin_can_do_everything():
    admin = {"role": "admin", "name": "Alice"}
    assert handle_view_dashboard(admin)["status"] == 200
    assert handle_edit_post(admin)["status"] == 200
    assert handle_moderate_comments(admin)["status"] == 200
    assert handle_admin_panel(admin)["status"] == 200
    assert handle_public_page(admin)["status"] == 200

def test_editor_can_edit_and_view():
    editor = {"role": "editor", "name": "Bob"}
    assert handle_public_page(editor)["status"] == 200, \
        "Editor should access public pages"
    assert handle_view_dashboard(editor)["status"] == 200, \
        "Editor should view dashboard"
    assert handle_edit_post(editor)["status"] == 200, \
        "Editor should be able to edit posts"

def test_editor_cannot_moderate():
    editor = {"role": "editor", "name": "Bob"}
    assert handle_moderate_comments(editor)["status"] == 403, \
        "Editor should NOT be able to moderate"
    assert handle_admin_panel(editor)["status"] == 403, \
        "Editor should NOT access admin panel"

def test_viewer_can_view_but_not_edit():
    viewer = {"role": "viewer", "name": "Carol"}
    assert handle_public_page(viewer)["status"] == 200, \
        "Viewer should access public pages"
    assert handle_view_dashboard(viewer)["status"] == 200, \
        "Viewer should view dashboard"
    assert handle_edit_post(viewer)["status"] == 403, \
        "Viewer should NOT be able to edit posts"

def test_guest_only_public():
    guest = {"role": "guest", "name": "Dave"}
    assert handle_public_page(guest)["status"] == 200, \
        "Guest should access public pages"
    assert handle_view_dashboard(guest)["status"] == 403, \
        "Guest should NOT view dashboard"

def test_role_hierarchy_order():
    """Roles should be ordered: guest < viewer < editor < moderator < admin."""
    roles = get_all_roles()
    assert roles == ["guest", "viewer", "editor", "moderator", "admin"], \
        f"Role order is wrong: {roles}"

if __name__ == "__main__":
    test_admin_can_do_everything()
    test_editor_can_edit_and_view()
    test_editor_cannot_moderate()
    test_viewer_can_view_but_not_edit()
    test_guest_only_public()
    test_role_hierarchy_order()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(format!(
            "The permission system is broken: editors are being denied access to \
             edit posts, while viewers can somehow edit. The role hierarchy seems \
             inverted for some roles.\n\n\
             Step 1: Read {} and {} carefully. Identify the root cause and \
             apply your fix WITHOUT running the code first.\n\
             Step 2: Run `python3 test_permissions.py` to check your work.\n\
             Step 3: If any tests fail, read the error output, adjust your \
             fix, and re-run until all tests pass.",
            perms_file, routes_file)),
            vec![
                complete(),
                succeeded("shell"),
                // Primary: the test suite must pass — it comprehensively covers
                // admin/editor/viewer/guest access levels, role hierarchy ordering,
                // and correct permission grants/denials across all route handlers.
                run_has("python3 test_permissions.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![perms_file, routes_file]),
            vec![test_file])
    }
    v.push(scen!("v2_bugfix_04_adversarial_perms", Category::Bugfix, Difficulty::Hard, I, setup));
}
