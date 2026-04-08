//! Patch v2 — Test 02: Surgical edit in repetitive generated code
//!
//! A database migration system with 3 nearly identical table definitions
//! in `schema.py`. The task: change ONLY the `orders` table's `total`
//! column from INTEGER to DECIMAL(10,2) — the `invoices` and `payments`
//! tables also have a `total` column typed as INTEGER, but those must
//! NOT change.
//!
//! Additionally, `queries.py` has 3 query functions that reference
//! the `orders.total` column. The one that sums totals must be updated
//! to cast the result appropriately (CAST AS DECIMAL), while the other
//! two queries (for invoices and payments) must remain unchanged.
//!
//! The model must also update `models.py` to change the `total` field
//! type from `int` to `float` in the `Order` class ONLY — the
//! `Invoice` and `Payment` classes must keep `int`.
//!
//! Red herrings:
//! - All three table defs look identical; changing the wrong one is easy
//! - A `_migrate_legacy()` function references "total INTEGER" in a
//!   comment — this comment should NOT be updated
//! - The `Payment` model has a `total` field right after `Order` — easy
//!   to accidentally change both

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let schema_file = ap(dir, "schema.py");
        std::fs::write(&schema_file, r#""""Database schema definitions for the billing system."""


def create_tables(cursor) -> None:
    """Create all billing tables."""

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            invoice_number TEXT NOT NULL UNIQUE,
            total INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'draft',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            order_number TEXT NOT NULL UNIQUE,
            total INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            payment_ref TEXT NOT NULL UNIQUE,
            total INTEGER NOT NULL DEFAULT 0,
            method TEXT NOT NULL DEFAULT 'card',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)


def _migrate_legacy(cursor) -> None:
    """Migrate from legacy schema.

    The old schema had:
        orders: total INTEGER (no decimals)
        invoices: total INTEGER
        payments: total INTEGER

    This function handles data migration for pre-2024 records.
    Do NOT change this function — it must match the historical schema.
    """
    cursor.execute("SELECT COUNT(*) FROM orders WHERE total > 0")
"#).unwrap();

        let queries_file = ap(dir, "queries.py");
        std::fs::write(&queries_file, r#""""Query functions for the billing system."""


def get_order_total_sum(cursor, customer_id: int):
    """Get the sum of all order totals for a customer."""
    cursor.execute(
        "SELECT SUM(total) FROM orders WHERE customer_id = ?",
        (customer_id,)
    )
    row = cursor.fetchone()
    return row[0] if row[0] is not None else 0


def get_invoice_total_sum(cursor, customer_id: int):
    """Get the sum of all invoice totals for a customer."""
    cursor.execute(
        "SELECT SUM(total) FROM invoices WHERE customer_id = ?",
        (customer_id,)
    )
    row = cursor.fetchone()
    return row[0] if row[0] is not None else 0


def get_payment_total_sum(cursor, customer_id: int):
    """Get the sum of all payment totals for a customer."""
    cursor.execute(
        "SELECT SUM(total) FROM payments WHERE customer_id = ?",
        (customer_id,)
    )
    row = cursor.fetchone()
    return row[0] if row[0] is not None else 0


def get_order_by_number(cursor, order_number: str) -> dict | None:
    """Fetch a single order by its order number."""
    cursor.execute(
        "SELECT id, customer_id, order_number, total, status FROM orders WHERE order_number = ?",
        (order_number,)
    )
    row = cursor.fetchone()
    if row is None:
        return None
    return {
        "id": row[0],
        "customer_id": row[1],
        "order_number": row[2],
        "total": row[3],
        "status": row[4],
    }
"#).unwrap();

        let models_file = ap(dir, "models.py");
        std::fs::write(&models_file, r#""""Data models for the billing system."""

from dataclasses import dataclass


@dataclass
class Invoice:
    id: int
    customer_id: int
    invoice_number: str
    total: int
    status: str = "draft"


@dataclass
class Order:
    id: int
    customer_id: int
    order_number: str
    total: int
    status: str = "pending"


@dataclass
class Payment:
    id: int
    customer_id: int
    payment_ref: str
    total: int
    method: str = "card"


def order_from_row(row: tuple) -> Order:
    """Construct an Order from a database row."""
    return Order(
        id=row[0],
        customer_id=row[1],
        order_number=row[2],
        total=row[3],
        status=row[4],
    )
"#).unwrap();

        let test_file = ap(dir, "test_billing.py");
        std::fs::write(&test_file, r#"import sqlite3
from schema import create_tables
from queries import get_order_total_sum, get_invoice_total_sum, get_payment_total_sum, get_order_by_number
from models import Order, Invoice, Payment, order_from_row


def _setup_db():
    conn = sqlite3.connect(":memory:")
    cursor = conn.cursor()
    create_tables(cursor)
    conn.commit()
    return conn, cursor


def test_order_total_is_decimal():
    """The orders table total column should support decimal values."""
    conn, cursor = _setup_db()
    cursor.execute(
        "INSERT INTO orders (customer_id, order_number, total, status) VALUES (1, 'ORD-001', 19.99, 'pending')"
    )
    cursor.execute(
        "INSERT INTO orders (customer_id, order_number, total, status) VALUES (1, 'ORD-002', 5.50, 'pending')"
    )
    conn.commit()

    total = get_order_total_sum(cursor, 1)
    # With DECIMAL type, we should get precise decimal results
    assert abs(total - 25.49) < 0.01, \
        f"Order total sum should be 25.49, got {total}"
    conn.close()


def test_order_by_number_returns_float_total():
    """Individual order total should be a float."""
    conn, cursor = _setup_db()
    cursor.execute(
        "INSERT INTO orders (customer_id, order_number, total, status) VALUES (1, 'ORD-100', 42.75, 'pending')"
    )
    conn.commit()

    order = get_order_by_number(cursor, "ORD-100")
    assert order is not None
    assert abs(order["total"] - 42.75) < 0.01, \
        f"Order total should be 42.75, got {order['total']}"
    conn.close()


def test_invoice_total_still_integer():
    """Invoice totals must remain integers (no change)."""
    conn, cursor = _setup_db()
    cursor.execute(
        "INSERT INTO invoices (customer_id, invoice_number, total, status) VALUES (1, 'INV-001', 100, 'draft')"
    )
    conn.commit()

    total = get_invoice_total_sum(cursor, 1)
    assert total == 100, f"Invoice total should be 100, got {total}"
    conn.close()


def test_payment_total_still_integer():
    """Payment totals must remain integers (no change)."""
    conn, cursor = _setup_db()
    cursor.execute(
        "INSERT INTO payments (customer_id, payment_ref, total, method) VALUES (1, 'PAY-001', 50, 'card')"
    )
    conn.commit()

    total = get_payment_total_sum(cursor, 1)
    assert total == 50, f"Payment total should be 50, got {total}"
    conn.close()


def test_order_model_has_float_total():
    """The Order dataclass total field should accept float values."""
    o = Order(id=1, customer_id=1, order_number="ORD-X", total=29.99)
    assert isinstance(o.total, float), \
        f"Order.total should be float, got {type(o.total).__name__}"


def test_invoice_model_has_int_total():
    """The Invoice dataclass total field should remain int."""
    inv = Invoice(id=1, customer_id=1, invoice_number="INV-X", total=100)
    assert isinstance(inv.total, int), \
        f"Invoice.total should be int, got {type(inv.total).__name__}"


def test_payment_model_has_int_total():
    """The Payment dataclass total field should remain int."""
    pay = Payment(id=1, customer_id=1, payment_ref="PAY-X", total=50)
    assert isinstance(pay.total, int), \
        f"Payment.total should be int, got {type(pay.total).__name__}"


def test_order_from_row_with_float():
    """order_from_row should correctly handle float totals."""
    row = (1, 1, "ORD-Y", 15.75, "pending")
    o = order_from_row(row)
    assert abs(o.total - 15.75) < 0.01, \
        f"order_from_row total should be 15.75, got {o.total}"


if __name__ == "__main__":
    test_order_total_is_decimal()
    test_order_by_number_returns_float_total()
    test_invoice_total_still_integer()
    test_payment_total_still_integer()
    test_order_model_has_float_total()
    test_invoice_model_has_int_total()
    test_payment_model_has_int_total()
    test_order_from_row_with_float()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(format!(
            "We need to change the `orders` table to store totals as decimals \
             instead of integers (to support cents). The `invoices` and `payments` \
             tables must remain unchanged — they use whole-number totals by design.\n\n\
             You need to update the schema, queries, and models so that ONLY \
             order-related code uses decimal totals.\n\n\
             Step 1: Read all source files and identify every place that needs \
             to change for orders (and only orders).\n\
             Step 2: Apply your patches WITHOUT running the code first.\n\
             Step 3: Run the existing `python3 test_billing.py` to verify. If tests fail, \
             read the errors and iterate until all tests pass.",
        )),
            vec![
                complete(),
                succeeded("shell"),
                // Primary: all tests pass — the test suite inserts 19.99
                // and 5.50 and verifies they sum to 25.49, which proves
                // the column type was changed to support decimals.
                run_has("python3 test_billing.py", &["ALL_TESTS_PASSED"]),
                // Order model must use float
                file_has("models.py", &["total: float"]),
                // Legacy migration function must not change (still has INTEGER reference)
                file_has("schema.py", &["total INTEGER"]),
            ]),
            vec![schema_file, queries_file, models_file]),
            vec![test_file])
    }
    v.push(scen!("xhard_patch_02_surgical_decimal_migration", Category::Patch, Difficulty::Hard, I, setup));
}
