//! Implement v2 — Test 01: Add search/filter to an existing inventory system
//!
//! An inventory management module with `Inventory` class that supports
//! adding, removing, and listing items. The task is to implement a
//! `search()` method that filters items by multiple criteria (name
//! substring, category, price range, in-stock status).
//!
//! The model must:
//! 1. Implement `search()` matching the existing code style (returns list)
//! 2. Handle all filter combinations (any subset can be provided)
//! 3. Make search case-insensitive for name/category
//! 4. Handle edge cases: empty inventory, no matches, no filters
//!
//! Existing patterns the model must follow:
//! - Items are stored as dicts with specific keys
//! - Methods return copies (not references to internal state)
//! - The `_normalize` helper is used for case-insensitive comparison
//!
//! Hidden test coverage:
//! - Combines multiple filters simultaneously
//! - Tests boundary values for price range (inclusive)
//! - Tests that search doesn't modify internal state

use std::path::Path;

use super::*;
use crate::agent::types::AgentRole::Implement as I;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let inv_file = ap(dir, "inventory.py");
        std::fs::write(
            &inv_file,
            r#"class Inventory:
    """Product inventory with add, remove, list, and bulk operations."""

    def __init__(self):
        self._items = {}
        self._next_id = 1

    @staticmethod
    def _normalize(text: str) -> str:
        """Normalize text for case-insensitive comparison."""
        return text.strip().lower()

    def add_item(self, name: str, category: str, price: float,
                 quantity: int = 0) -> int:
        """Add an item and return its ID."""
        item_id = self._next_id
        self._next_id += 1
        self._items[item_id] = {
            "id": item_id,
            "name": name,
            "category": category,
            "price": price,
            "quantity": quantity,
        }
        return item_id

    def remove_item(self, item_id: int) -> bool:
        """Remove an item by ID. Returns True if it existed."""
        return self._items.pop(item_id, None) is not None

    def get_item(self, item_id: int) -> dict | None:
        """Get a copy of an item by ID, or None."""
        item = self._items.get(item_id)
        if item is None:
            return None
        return dict(item)

    def list_items(self) -> list[dict]:
        """Return a copy of all items, sorted by ID."""
        return [dict(item) for item in
                sorted(self._items.values(), key=lambda x: x["id"])]

    def update_quantity(self, item_id: int, delta: int) -> int:
        """Adjust quantity by delta. Returns new quantity.
        Raises KeyError if item doesn't exist.
        Raises ValueError if result would be negative.
        """
        if item_id not in self._items:
            raise KeyError(f"No item with id {item_id}")
        new_qty = self._items[item_id]["quantity"] + delta
        if new_qty < 0:
            raise ValueError("Quantity cannot be negative")
        self._items[item_id]["quantity"] = new_qty
        return new_qty

    def total_value(self) -> float:
        """Sum of price * quantity for all items."""
        return sum(
            item["price"] * item["quantity"]
            for item in self._items.values()
        )

    def categories(self) -> list[str]:
        """Return sorted list of unique categories."""
        return sorted(set(
            self._normalize(item["category"])
            for item in self._items.values()
        ))

    # TODO: implement search(self, **kwargs) -> list[dict]
    # Accepted keyword arguments (all optional):
    #   name_contains: str
    #   category: str
    #   min_price: float
    #   max_price: float
    #   in_stock: bool
    # Returns items (same dict shape as list_items) matching every provided
    # filter. Items returned must not share identity with internal state.
"#,
        )
        .unwrap();

        let test_file = ap(dir, "test_inventory.py");
        std::fs::write(
            &test_file,
            r#"from inventory import Inventory


def _make_inventory():
    inv = Inventory()
    inv.add_item("Wireless Mouse", "Electronics", 29.99, quantity=50)
    inv.add_item("USB-C Cable", "Electronics", 9.99, quantity=200)
    inv.add_item("Desk Lamp", "Furniture", 45.00, quantity=0)
    inv.add_item("Mechanical Keyboard", "Electronics", 89.99, quantity=15)
    inv.add_item("Office Chair", "Furniture", 299.99, quantity=3)
    inv.add_item("mouse pad", "Accessories", 12.50, quantity=100)
    return inv


def test_search_no_filters():
    inv = _make_inventory()
    results = inv.search()
    assert len(results) == 6, f"no filters should return all 6, got {len(results)}"


def test_search_by_name_substring():
    inv = _make_inventory()
    results = inv.search(name_contains="mouse")
    names = [r["name"] for r in results]
    assert "Wireless Mouse" in names, f"should find 'Wireless Mouse', got {names}"
    assert "mouse pad" in names, f"should find 'mouse pad' (case-insensitive), got {names}"
    assert len(results) == 2, f"expected 2 results for 'mouse', got {len(results)}"


def test_search_by_category():
    inv = _make_inventory()
    results = inv.search(category="electronics")
    assert len(results) == 3, f"expected 3 electronics, got {len(results)}"
    for r in results:
        assert r["category"].lower() == "electronics" or r["category"] == "Electronics"


def test_search_by_category_case_insensitive():
    inv = _make_inventory()
    r1 = inv.search(category="FURNITURE")
    r2 = inv.search(category="furniture")
    r3 = inv.search(category="Furniture")
    assert len(r1) == len(r2) == len(r3) == 2, \
        f"category search should be case-insensitive: {len(r1)}, {len(r2)}, {len(r3)}"


def test_search_by_price_range():
    inv = _make_inventory()
    results = inv.search(min_price=10.00, max_price=50.00)
    prices = [r["price"] for r in results]
    assert all(10.00 <= p <= 50.00 for p in prices), f"prices out of range: {prices}"
    assert len(results) == 3, f"expected 3 in [10, 50], got {len(results)}"


def test_search_price_boundary_inclusive():
    inv = _make_inventory()
    results = inv.search(min_price=29.99, max_price=29.99)
    assert len(results) == 1, f"exact price match should find 1, got {len(results)}"
    assert results[0]["name"] == "Wireless Mouse"


def test_search_min_price_only():
    inv = _make_inventory()
    results = inv.search(min_price=100.00)
    assert len(results) == 1, f"expected 1 item >= 100, got {len(results)}"
    assert results[0]["name"] == "Office Chair"


def test_search_max_price_only():
    inv = _make_inventory()
    results = inv.search(max_price=10.00)
    assert len(results) == 1, f"expected 1 item <= 10, got {len(results)}"
    assert results[0]["name"] == "USB-C Cable"


def test_search_in_stock():
    inv = _make_inventory()
    results = inv.search(in_stock=True)
    assert len(results) == 5, f"expected 5 in-stock items, got {len(results)}"
    for r in results:
        assert r["quantity"] > 0, f"in-stock item has qty 0: {r}"


def test_search_combined_filters():
    inv = _make_inventory()
    results = inv.search(category="electronics", min_price=20.00, in_stock=True)
    assert len(results) == 2, f"expected 2 (Mouse + Keyboard), got {len(results)}"
    names = {r["name"] for r in results}
    assert "Wireless Mouse" in names
    assert "Mechanical Keyboard" in names


def test_search_no_matches():
    inv = _make_inventory()
    results = inv.search(name_contains="nonexistent")
    assert results == [], f"should return empty list, got {results}"


def test_search_empty_inventory():
    inv = Inventory()
    results = inv.search(name_contains="anything")
    assert results == []


def test_search_returns_copies():
    inv = _make_inventory()
    results = inv.search(category="electronics")
    results[0]["name"] = "MODIFIED"
    original = inv.get_item(results[0]["id"])
    assert original["name"] != "MODIFIED", \
        "search results should be copies, not references"


def test_search_sorted_by_id():
    inv = _make_inventory()
    results = inv.search(category="electronics")
    ids = [r["id"] for r in results]
    assert ids == sorted(ids), f"results should be sorted by ID, got {ids}"


def test_existing_methods_still_work():
    inv = _make_inventory()
    assert inv.total_value() > 0
    cats = inv.categories()
    assert "electronics" in cats
    assert inv.get_item(1) is not None
    assert inv.update_quantity(1, -5) == 45


if __name__ == "__main__":
    test_search_no_filters()
    test_search_by_name_substring()
    test_search_by_category()
    test_search_by_category_case_insensitive()
    test_search_by_price_range()
    test_search_price_boundary_inclusive()
    test_search_min_price_only()
    test_search_max_price_only()
    test_search_in_stock()
    test_search_combined_filters()
    test_search_no_matches()
    test_search_empty_inventory()
    test_search_returns_copies()
    test_search_sorted_by_id()
    test_existing_methods_still_work()
    print("ALL_TESTS_PASSED")
"#,
        )
        .unwrap();

        with_blocked(
            with_scope(
                with_checks(
                    pf(format!(
                        "Implement the `search()` method on the `Inventory` class in {}.\n\n\
             Contract:\n\
             - Signature: search(self, **kwargs) -> list[dict].\n\
             - Kwargs (any subset may be omitted): name_contains (str), \
               category (str), min_price (float), max_price (float), \
               in_stock (bool).\n\
             - name_contains matches items whose name contains the substring, \
               case-insensitive.\n\
             - category matches items whose category equals the given value, \
               case-insensitive.\n\
             - min_price and max_price are inclusive bounds on price.\n\
             - in_stock=True keeps only items with quantity > 0; \
               in_stock=False is equivalent to not filtering on stock.\n\
             - With no kwargs, returns every item.\n\
             - Results have the same shape as list_items() (dicts with id, \
               name, category, price, quantity), sorted by id, and mutating \
               a returned dict must not affect internal state.\n\n\
             Verify with `python3 test_inventory.py`.",
                        inv_file
                    )),
                    vec![
                        complete(),
                        succeeded("shell"),
                        run_has("python3 test_inventory.py", &["ALL_TESTS_PASSED"]),
                    ],
                ),
                vec![inv_file],
            ),
            vec![test_file],
        )
    }
    v.push(scen!(
        "xhard_implement_01_inventory_search",
        Category::Implement,
        Difficulty::Hard,
        I,
        setup
    ));
}
