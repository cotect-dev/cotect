//! Cross-file v2 — Test 03: Field type migration across 4 files
//!
//! A user profile system where the `address` field is currently a plain
//! string. The task: migrate it to a structured `Address` dict with
//! street, city, state, and zip fields. This change must cascade through:
//!
//! - models.py: the User class stores address as a string
//! - service.py: create_user() accepts address as a string parameter
//! - serializer.py: to_json()/from_json() serialize address as a string
//! - validator.py: validate_user() checks that address is a non-empty string
//!
//! The model must update all 4 files consistently. Forgetting any one
//! file causes a type mismatch at runtime.
//!
//! Red herrings:
//! - models.py has a `bio` field that is also a string — should NOT change
//! - serializer.py has a `serialize_list()` function that handles lists
//!   of users — it must also work after the migration
//! - validator.py has `validate_email()` which is unrelated

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let models_file = ap(dir, "models.py");
        std::fs::write(&models_file, r#"class User:
    def __init__(self, name: str, email: str, address: str, bio: str = ""):
        self.name = name
        self.email = email
        self.address = address
        self.bio = bio

    def display_address(self) -> str:
        return self.address

    def __repr__(self):
        return f"User({self.name!r}, {self.email!r})"
"#).unwrap();

        let service_file = ap(dir, "service.py");
        std::fs::write(&service_file, r#"from models import User
from validator import validate_user


def create_user(name: str, email: str, address: str, bio: str = "") -> User:
    """Create and validate a new user."""
    user = User(name=name, email=email, address=address, bio=bio)
    errors = validate_user(user)
    if errors:
        raise ValueError(f"Validation failed: {', '.join(errors)}")
    return user


def update_address(user: User, new_address: str) -> User:
    """Update a user's address."""
    user.address = new_address
    return user


def get_user_summary(user: User) -> dict:
    """Return a summary dict for a user."""
    return {
        "name": user.name,
        "email": user.email,
        "address": user.display_address(),
    }
"#).unwrap();

        let serializer_file = ap(dir, "serializer.py");
        std::fs::write(&serializer_file, r#"import json
from models import User


def to_json(user: User) -> str:
    """Serialize a User to a JSON string."""
    data = {
        "name": user.name,
        "email": user.email,
        "address": user.address,
        "bio": user.bio,
    }
    return json.dumps(data)


def from_json(json_str: str) -> User:
    """Deserialize a User from a JSON string."""
    data = json.loads(json_str)
    return User(
        name=data["name"],
        email=data["email"],
        address=data["address"],
        bio=data.get("bio", ""),
    )


def serialize_list(users: list[User]) -> str:
    """Serialize a list of users to JSON."""
    items = []
    for user in users:
        items.append(json.loads(to_json(user)))
    return json.dumps(items, indent=2)
"#).unwrap();

        let validator_file = ap(dir, "validator.py");
        std::fs::write(&validator_file, r#"def validate_email(email: str) -> bool:
    """Check basic email format. Unrelated to address validation."""
    return "@" in email and "." in email.split("@")[-1]


def validate_user(user) -> list[str]:
    """Validate a user object. Returns a list of error messages (empty = valid)."""
    errors = []
    if not user.name or not user.name.strip():
        errors.append("Name is required")
    if not user.email or not validate_email(user.email):
        errors.append("Valid email is required")
    if not user.address or not user.address.strip():
        errors.append("Address is required")
    if user.bio and len(user.bio) > 500:
        errors.append("Bio must be 500 characters or less")
    return errors
"#).unwrap();

        let test_file = ap(dir, "test_migration.py");
        std::fs::write(&test_file, r#"import json
from models import User
from service import create_user, update_address, get_user_summary
from serializer import to_json, from_json, serialize_list
from validator import validate_user, validate_email


def test_user_address_is_dict():
    """User.address must be a dict with street, city, state, zip."""
    addr = {"street": "123 Main St", "city": "Springfield", "state": "IL", "zip": "62704"}
    u = User("Alice", "alice@example.com", address=addr)
    assert isinstance(u.address, dict), \
        f"address should be dict, got {type(u.address).__name__}"
    assert u.address["street"] == "123 Main St"
    assert u.address["city"] == "Springfield"
    assert u.address["state"] == "IL"
    assert u.address["zip"] == "62704"


def test_display_address_formatted():
    """display_address() should return a formatted string from the structured address."""
    addr = {"street": "456 Oak Ave", "city": "Portland", "state": "OR", "zip": "97201"}
    u = User("Bob", "bob@example.com", address=addr)
    display = u.display_address()
    assert isinstance(display, str), f"display_address should return str, got {type(display)}"
    assert "456 Oak Ave" in display
    assert "Portland" in display
    assert "OR" in display
    assert "97201" in display


def test_create_user_with_dict_address():
    """create_user must accept a dict address."""
    addr = {"street": "789 Pine Rd", "city": "Austin", "state": "TX", "zip": "73301"}
    u = create_user("Carol", "carol@example.com", address=addr)
    assert u.name == "Carol"
    assert u.address["city"] == "Austin"


def test_update_address_with_dict():
    """update_address must accept a dict address."""
    addr1 = {"street": "1 Old St", "city": "A", "state": "CA", "zip": "90001"}
    addr2 = {"street": "2 New St", "city": "B", "state": "NY", "zip": "10001"}
    u = User("Dave", "dave@example.com", address=addr1)
    update_address(u, addr2)
    assert u.address["street"] == "2 New St"
    assert u.address["city"] == "B"


def test_get_user_summary():
    addr = {"street": "10 Elm St", "city": "Denver", "state": "CO", "zip": "80201"}
    u = User("Eve", "eve@example.com", address=addr)
    summary = get_user_summary(u)
    assert "Denver" in summary["address"]


def test_serializer_roundtrip():
    """JSON serialization must preserve the structured address."""
    addr = {"street": "55 Maple Dr", "city": "Seattle", "state": "WA", "zip": "98101"}
    original = User("Frank", "frank@example.com", address=addr, bio="Hello")
    json_str = to_json(original)
    restored = from_json(json_str)
    assert isinstance(restored.address, dict), \
        f"Deserialized address should be dict, got {type(restored.address)}"
    assert restored.address["street"] == "55 Maple Dr"
    assert restored.address["city"] == "Seattle"
    assert restored.bio == "Hello"


def test_serialize_list():
    addr1 = {"street": "1 A St", "city": "X", "state": "CA", "zip": "90001"}
    addr2 = {"street": "2 B St", "city": "Y", "state": "NY", "zip": "10001"}
    users = [
        User("Alice", "a@b.com", address=addr1),
        User("Bob", "b@c.com", address=addr2),
    ]
    result = serialize_list(users)
    parsed = json.loads(result)
    assert len(parsed) == 2
    assert parsed[0]["address"]["city"] == "X"
    assert parsed[1]["address"]["city"] == "Y"


def test_validator_with_dict_address():
    """Validator must check structured address correctly."""
    addr = {"street": "1 St", "city": "C", "state": "IL", "zip": "60601"}
    u = User("Valid", "v@e.com", address=addr)
    errors = validate_user(u)
    assert errors == [], f"Should be valid, got errors: {errors}"


def test_validator_rejects_empty_address():
    """Empty/missing address fields should fail validation."""
    u = User("Bad", "b@e.com", address={})
    errors = validate_user(u)
    assert len(errors) > 0, "Empty address dict should fail validation"


def test_validator_rejects_missing_fields():
    """Address missing required fields should fail."""
    u = User("Bad", "b@e.com", address={"street": "1 St"})
    errors = validate_user(u)
    assert len(errors) > 0, "Incomplete address should fail validation"


def test_bio_still_string():
    """Bio must remain a plain string."""
    addr = {"street": "1 St", "city": "C", "state": "IL", "zip": "60601"}
    u = User("Test", "t@e.com", address=addr, bio="My bio")
    assert isinstance(u.bio, str)
    assert u.bio == "My bio"


def test_validate_email_unchanged():
    """validate_email must still work."""
    assert validate_email("a@b.com")
    assert not validate_email("invalid")


if __name__ == "__main__":
    test_user_address_is_dict()
    test_display_address_formatted()
    test_create_user_with_dict_address()
    test_update_address_with_dict()
    test_get_user_summary()
    test_serializer_roundtrip()
    test_serialize_list()
    test_validator_with_dict_address()
    test_validator_rejects_empty_address()
    test_validator_rejects_missing_fields()
    test_bio_still_string()
    test_validate_email_unchanged()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(
            "The `User` type in this project currently stores `address` as a \
             plain string. Migrate `address` to a structured dict carrying four \
             sub-fields — street, city, state, zip — and propagate that change \
             everywhere the field is produced, consumed, serialized, or \
             validated. Find the call sites yourself.\n\n\
             After the migration:\n\
             - constructing a User must take a dict address and store it as a \
               dict\n\
             - anything that renders the address for display must format a \
               readable string from the structured fields\n\
             - JSON round-tripping must preserve the dict shape\n\
             - validation must reject an empty address dict and any dict that \
               is missing one of the four required sub-fields (or has an empty \
               value for one)\n\n\
             Other string fields on the user, and validators unrelated to \
             address, must stay exactly as they are.\n\n\
             Apply all edits first, then run the bundled test suite \
             (`python3 test_migration.py`) and iterate until it prints \
             ALL_TESTS_PASSED.".to_string()),
            vec![
                complete(),
                succeeded("shell"),
                // Model: signature no longer declares address as str
                file_lacks(&models_file, &["address: str"]),
                // Service layer: no more `address: str` param in create_user / update_address
                file_lacks(&service_file, &["address: str", "new_address: str"]),
                // Validator must check structured keys
                file_has(&validator_file, &["street", "city", "state", "zip"]),
                // Old validator string-emptiness check on address must be gone
                file_lacks(&validator_file, &["user.address.strip()"]),
                // bio field and validate_email untouched
                file_has(&models_file, &["bio"]),
                file_has(&validator_file, &["def validate_email"]),
                // End-to-end behaviour works
                run_has("python3 test_migration.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![models_file, service_file, serializer_file, validator_file]),
            vec![test_file])
    }
    v.push(scen!("xhard_cross_file_03_schema_migration", Category::CrossFile, Difficulty::Hard, I, setup));
}
