//! Cross-file v2 — Test 02: Selective constant rename across 4 files
//!
//! A notification system with status constants spread across 4 files.
//! The task: rename the status value "PENDING" to "QUEUED" everywhere it
//! represents a **notification** status. However, there is also a
//! "PENDING" status for **payments** in the same codebase that must NOT
//! be renamed — the two domains share a string value but are semantically
//! independent.
//!
//! Files:
//! - notification.py: defines NOTIFICATION_STATUSES including "PENDING"
//! - dispatcher.py: filters notifications by status == "PENDING"
//! - formatter.py: maps status strings to display labels, including "PENDING"
//! - payments.py: has its own PAYMENT_STATUS_PENDING = "PENDING" — must NOT change
//!
//! The model must rename "PENDING" to "QUEUED" in notification-related code
//! across 3 files, without touching the payment status in payments.py.

use std::path::Path;

use super::*;
use crate::agent::types::AgentRole::Implement as I;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let notification_file = ap(dir, "notification.py");
        std::fs::write(
            &notification_file,
            r#"NOTIFICATION_STATUSES = ["PENDING", "SENT", "FAILED", "CANCELLED"]

DEFAULT_STATUS = "PENDING"


class Notification:
    def __init__(self, recipient: str, message: str, channel: str = "email"):
        self.recipient = recipient
        self.message = message
        self.channel = channel
        self.status = DEFAULT_STATUS
        self.attempts = 0

    def mark_sent(self):
        self.status = "SENT"
        self.attempts += 1

    def mark_failed(self):
        self.status = "FAILED"
        self.attempts += 1

    def cancel(self):
        self.status = "CANCELLED"

    def is_pending(self):
        return self.status == "PENDING"

    def to_dict(self) -> dict:
        return {
            "recipient": self.recipient,
            "message": self.message,
            "channel": self.channel,
            "status": self.status,
            "attempts": self.attempts,
        }
"#,
        )
        .unwrap();

        let dispatcher_file = ap(dir, "dispatcher.py");
        std::fs::write(
            &dispatcher_file,
            r#"from notification import Notification


class Dispatcher:
    def __init__(self):
        self._queue = []

    def add(self, notification: Notification):
        self._queue.append(notification)

    def get_pending(self) -> list[Notification]:
        return [n for n in self._queue if n.status == "PENDING"]

    def get_by_status(self, status: str) -> list[Notification]:
        return [n for n in self._queue if n.status == status]

    def dispatch_all_pending(self) -> int:
        pending = self.get_pending()
        count = 0
        for notification in pending:
            notification.mark_sent()
            count += 1
        return count

    def retry_failed(self) -> int:
        failed = self.get_by_status("FAILED")
        count = 0
        for notification in failed:
            notification.status = "PENDING"
            count += 1
        return count

    def summary(self) -> dict:
        result = {}
        for n in self._queue:
            result[n.status] = result.get(n.status, 0) + 1
        return result
"#,
        )
        .unwrap();

        let formatter_file = ap(dir, "formatter.py");
        std::fs::write(
            &formatter_file,
            r#"STATUS_LABELS = {
    "PENDING": "Waiting to send",
    "SENT": "Delivered",
    "FAILED": "Delivery failed",
    "CANCELLED": "Cancelled by user",
}

STATUS_ICONS = {
    "PENDING": "⏳",
    "SENT": "✅",
    "FAILED": "❌",
    "CANCELLED": "🚫",
}


def format_notification(notification_dict: dict) -> str:
    status = notification_dict["status"]
    label = STATUS_LABELS.get(status, "Unknown")
    icon = STATUS_ICONS.get(status, "?")
    return f"{icon} [{status}] {notification_dict['recipient']}: {label}"


def format_status_report(summary: dict) -> str:
    lines = []
    for status, count in sorted(summary.items()):
        label = STATUS_LABELS.get(status, status)
        lines.append(f"  {status}: {count} ({label})")
    return "\n".join(lines)
"#,
        )
        .unwrap();

        let payments_file = ap(dir, "payments.py");
        std::fs::write(
            &payments_file,
            r#"PAYMENT_STATUS_PENDING = "PENDING"
PAYMENT_STATUS_COMPLETED = "COMPLETED"
PAYMENT_STATUS_REFUNDED = "REFUNDED"


class Payment:
    def __init__(self, amount: float, currency: str = "USD"):
        self.amount = amount
        self.currency = currency
        self.status = PAYMENT_STATUS_PENDING

    def complete(self):
        self.status = PAYMENT_STATUS_COMPLETED

    def refund(self):
        self.status = PAYMENT_STATUS_REFUNDED

    def is_pending(self):
        return self.status == PAYMENT_STATUS_PENDING

    def to_dict(self) -> dict:
        return {
            "amount": self.amount,
            "currency": self.currency,
            "status": self.status,
        }
"#,
        )
        .unwrap();

        let test_file = ap(dir, "test_rename.py");
        std::fs::write(
            &test_file,
            r#"from notification import Notification, NOTIFICATION_STATUSES, DEFAULT_STATUS
from dispatcher import Dispatcher
from formatter import format_notification, format_status_report, STATUS_LABELS, STATUS_ICONS
from payments import Payment, PAYMENT_STATUS_PENDING


def test_notification_default_status_is_queued():
    n = Notification("alice@example.com", "Hello")
    assert n.status == "QUEUED", f"Default status should be QUEUED, got {n.status}"


def test_notification_statuses_list():
    assert "QUEUED" in NOTIFICATION_STATUSES, \
        f"NOTIFICATION_STATUSES should contain QUEUED: {NOTIFICATION_STATUSES}"
    assert "PENDING" not in NOTIFICATION_STATUSES, \
        f"NOTIFICATION_STATUSES should not contain PENDING: {NOTIFICATION_STATUSES}"


def test_default_status_constant():
    assert DEFAULT_STATUS == "QUEUED", \
        f"DEFAULT_STATUS should be QUEUED, got {DEFAULT_STATUS}"


def test_is_pending_checks_queued():
    n = Notification("bob@example.com", "Hi")
    assert n.is_pending(), "New notification should be pending (QUEUED)"
    n.mark_sent()
    assert not n.is_pending(), "Sent notification should not be pending"


def test_dispatcher_get_pending():
    d = Dispatcher()
    n1 = Notification("a@b.com", "msg1")
    n2 = Notification("c@d.com", "msg2")
    n2.mark_sent()
    d.add(n1)
    d.add(n2)
    pending = d.get_pending()
    assert len(pending) == 1, f"Expected 1 pending, got {len(pending)}"
    assert pending[0].recipient == "a@b.com"


def test_dispatcher_dispatch_all_pending():
    d = Dispatcher()
    d.add(Notification("a@b.com", "msg1"))
    d.add(Notification("c@d.com", "msg2"))
    count = d.dispatch_all_pending()
    assert count == 2, f"Expected 2 dispatched, got {count}"
    assert len(d.get_pending()) == 0


def test_dispatcher_retry_failed():
    d = Dispatcher()
    n = Notification("a@b.com", "msg")
    n.mark_failed()
    d.add(n)
    count = d.retry_failed()
    assert count == 1
    assert n.status == "QUEUED", f"Retried notification should be QUEUED, got {n.status}"


def test_formatter_labels():
    assert "QUEUED" in STATUS_LABELS, \
        f"STATUS_LABELS should have QUEUED key: {list(STATUS_LABELS.keys())}"
    assert "PENDING" not in STATUS_LABELS, \
        f"STATUS_LABELS should not have PENDING key"


def test_formatter_icons():
    assert "QUEUED" in STATUS_ICONS, \
        f"STATUS_ICONS should have QUEUED key: {list(STATUS_ICONS.keys())}"


def test_format_notification():
    n = Notification("alice@example.com", "Hello")
    text = format_notification(n.to_dict())
    assert "QUEUED" in text, f"Format should show QUEUED: {text}"
    assert "alice@example.com" in text


def test_payment_status_unchanged():
    """Payment PENDING must NOT be renamed."""
    assert PAYMENT_STATUS_PENDING == "PENDING", \
        f"Payment status should still be PENDING, got {PAYMENT_STATUS_PENDING}"
    p = Payment(99.99)
    assert p.status == "PENDING", \
        f"Payment default should be PENDING, got {p.status}"
    assert p.is_pending()


def test_payment_workflow_unchanged():
    p = Payment(50.0)
    p.complete()
    assert p.status == "COMPLETED"
    assert not p.is_pending()


if __name__ == "__main__":
    test_notification_default_status_is_queued()
    test_notification_statuses_list()
    test_default_status_constant()
    test_is_pending_checks_queued()
    test_dispatcher_get_pending()
    test_dispatcher_dispatch_all_pending()
    test_dispatcher_retry_failed()
    test_formatter_labels()
    test_formatter_icons()
    test_format_notification()
    test_payment_status_unchanged()
    test_payment_workflow_unchanged()
    print("ALL_TESTS_PASSED")
"#,
        )
        .unwrap();

        with_blocked(
            with_scope(
                with_checks(
                    pf(
                        "In this codebase, notifications currently start life in a status \
             named \"PENDING\". Rename that notification status to \"QUEUED\" \
             everywhere it appears in notification code — the status list, the \
             default, all comparisons, the display label map, the icon map, and \
             every helper that transitions notifications back to the initial \
             state.\n\n\
             There is also unrelated code in this repo that uses the string \
             \"PENDING\" for a different concept (not notifications). Anything \
             that represents that other concept must stay exactly as it is. \
             Read the files carefully and decide which \"PENDING\" strings \
             belong to the notification domain and which do not.\n\n\
             Apply all edits first, then run the bundled test suite \
             (`python3 test_rename.py`) and iterate until it prints \
             ALL_TESTS_PASSED."
                            .to_string(),
                    ),
                    vec![
                        complete(),
                        succeeded("shell"),
                        // Notification domain: old string fully gone, new string present
                        file_has(&notification_file, &["QUEUED"]),
                        file_lacks(&notification_file, &["PENDING"]),
                        file_has(&dispatcher_file, &["QUEUED"]),
                        file_lacks(&dispatcher_file, &["PENDING"]),
                        file_has(&formatter_file, &["QUEUED"]),
                        file_lacks(&formatter_file, &["PENDING"]),
                        // Payment domain left alone
                        file_has(&payments_file, &["PAYMENT_STATUS_PENDING", "\"PENDING\""]),
                        file_lacks(&payments_file, &["QUEUED"]),
                        // End-to-end behaviour actually works
                        run_has("python3 test_rename.py", &["ALL_TESTS_PASSED"]),
                    ],
                ),
                vec![
                    notification_file,
                    dispatcher_file,
                    formatter_file,
                    payments_file,
                ],
            ),
            vec![test_file],
        )
    }
    v.push(scen!(
        "xhard_cross_file_02_selective_rename",
        Category::CrossFile,
        Difficulty::Hard,
        I,
        setup
    ));
}
