//! Testing v2 — Scenario 05: Banking system
//!
//! Four-file Python banking system. The model must write tests
//! that exercise the classes across all modules per their docstrings.

use std::path::Path;

use super::*;
use crate::agent::types::AgentRole::Implement as I;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let account_file = ap(dir, "account.py");
        std::fs::write(
            &account_file,
            r#""""Bank account with balance tracking."""

from datetime import date


class Account:
    """A bank account that records all transactions.

    Each transaction is a dict: {"date": date, "type": str, "amount": float}
    where type is "deposit" or "withdrawal".

    >>> a = Account("Alice", 100.0)
    >>> a.balance
    100.0
    >>> a.deposit(50.0)
    >>> a.balance
    150.0
    """

    def __init__(self, owner: str, initial_balance: float = 0.0):
        if initial_balance < 0:
            raise ValueError("initial balance must be non-negative")
        self.owner = owner
        self._balance = initial_balance
        self._transactions = []
        if initial_balance > 0:
            self._transactions.append({
                "date": date.today(),
                "type": "deposit",
                "amount": initial_balance,
            })

    @property
    def balance(self):
        return self._balance

    def deposit(self, amount: float):
        """Deposit money. Amount must be positive."""
        if amount <= 0:
            raise ValueError("deposit amount must be positive")
        self._balance += amount
        self._transactions.append({
            "date": date.today(),
            "type": "deposit",
            "amount": amount,
        })

    def withdraw(self, amount: float):
        """Withdraw money. Amount must be positive and <= balance.

        Raises ValueError if insufficient funds.
        """
        if amount <= 0:
            raise ValueError("withdrawal amount must be positive")
        if amount > self._balance:
            raise ValueError("insufficient funds")
        self._balance -= amount
        self._transactions.append({
            "date": date.today(),
            "type": "withdrawal",
            "amount": amount,
        })

    @property
    def transactions(self):
        """Return a copy of the transaction list."""
        return list(self._transactions)
"#,
        )
        .unwrap();

        let transfer_file = ap(dir, "transfer.py");
        std::fs::write(
            &transfer_file,
            r#""""Transfer service between accounts."""


def transfer(source, destination, amount: float):
    """Transfer amount from source to destination account.

    The source must have sufficient funds — if not, raise ValueError
    and neither account should be modified.

    >>> from account import Account
    >>> a = Account("A", 100.0)
    >>> b = Account("B", 50.0)
    >>> transfer(a, b, 30.0)
    >>> a.balance
    70.0
    >>> b.balance
    80.0
    """
    destination.deposit(amount)
    source.withdraw(amount)
"#,
        )
        .unwrap();

        let interest_file = ap(dir, "interest.py");
        std::fs::write(
            &interest_file,
            r#""""Interest calculation utilities."""


def apply_interest(account, annual_rate: float):
    """Apply simple interest to the account balance.

    Computes interest = balance * annual_rate / 100,
    rounds to 2 decimal places, and deposits it.

    >>> from account import Account
    >>> a = Account("X", 1000.0)
    >>> apply_interest(a, 5.0)
    >>> a.balance
    1050.0
    """
    interest = int(account.balance * annual_rate / 100)
    if interest > 0:
        account.deposit(interest)
"#,
        )
        .unwrap();

        let statement_file = ap(dir, "statement.py");
        std::fs::write(
            &statement_file,
            r#""""Account statement generation."""

from datetime import date


def get_transactions(account, start: date, end: date):
    """Return transactions within the date range [start, end] inclusive.

    Both start and end dates are included in the range.

    >>> from account import Account
    >>> a = Account("Y", 100.0)
    >>> txns = get_transactions(a, date.today(), date.today())
    >>> len(txns)
    1
    """
    return [t for t in account.transactions if start <= t["date"] < end]


def balance_at(account, target_date: date) -> float:
    """Compute the account balance as of a given date.

    Replays all transactions up to and including target_date.
    Deposits add to balance, withdrawals subtract from it.
    Starts from 0.0 (the initial deposit is a transaction too).

    >>> from account import Account
    >>> a = Account("Z", 100.0)
    >>> balance_at(a, date.today())
    100.0
    """
    total = 0.0
    for txn in account.transactions:
        if txn["date"] <= target_date:
            total += txn["amount"]
    return total
"#,
        )
        .unwrap();

        // Fixed versions
        let transfer_fixed = ap(dir, "transfer_fixed.py");
        std::fs::write(
            &transfer_fixed,
            r#""""Transfer service between accounts."""


def transfer(source, destination, amount: float):
    """Transfer amount from source to destination account.

    The source must have sufficient funds — if not, raise ValueError
    and neither account should be modified.

    >>> from account import Account
    >>> a = Account("A", 100.0)
    >>> b = Account("B", 50.0)
    >>> transfer(a, b, 30.0)
    >>> a.balance
    70.0
    >>> b.balance
    80.0
    """
    source.withdraw(amount)
    destination.deposit(amount)
"#,
        )
        .unwrap();

        let interest_fixed = ap(dir, "interest_fixed.py");
        std::fs::write(
            &interest_fixed,
            r#""""Interest calculation utilities."""


def apply_interest(account, annual_rate: float):
    """Apply simple interest to the account balance.

    Computes interest = balance * annual_rate / 100,
    rounds to 2 decimal places, and deposits it.

    >>> from account import Account
    >>> a = Account("X", 1000.0)
    >>> apply_interest(a, 5.0)
    >>> a.balance
    1050.0
    """
    interest = round(account.balance * annual_rate / 100, 2)
    if interest > 0:
        account.deposit(interest)
"#,
        )
        .unwrap();

        let statement_fixed = ap(dir, "statement_fixed.py");
        std::fs::write(
            &statement_fixed,
            r#""""Account statement generation."""

from datetime import date


def get_transactions(account, start: date, end: date):
    """Return transactions within the date range [start, end] inclusive.

    Both start and end dates are included in the range.

    >>> from account import Account
    >>> a = Account("Y", 100.0)
    >>> txns = get_transactions(a, date.today(), date.today())
    >>> len(txns)
    1
    """
    return [t for t in account.transactions if start <= t["date"] <= end]


def balance_at(account, target_date: date) -> float:
    """Compute the account balance as of a given date.

    Replays all transactions up to and including target_date.
    Deposits add to balance, withdrawals subtract from it.
    Starts from 0.0 (the initial deposit is a transaction too).

    >>> from account import Account
    >>> a = Account("Z", 100.0)
    >>> balance_at(a, date.today())
    100.0
    """
    total = 0.0
    for txn in account.transactions:
        if txn["date"] <= target_date:
            if txn["type"] == "deposit":
                total += txn["amount"]
            else:
                total -= txn["amount"]
    return total
"#,
        )
        .unwrap();

        let runner = ap(dir, "run_tests.py");
        std::fs::write(
            &runner,
            r#"import subprocess, sys, os, shutil

test_file = None
for f in sorted(os.listdir(".")):
    if f.startswith("test_") and f.endswith(".py") and f != "run_tests.py":
        test_file = f
        break

if test_file is None:
    print("NO_TEST_FILE_FOUND")
    sys.exit(1)

pairs = [
    ("transfer.py", "transfer_buggy.py", "transfer_fixed.py"),
    ("interest.py", "interest_buggy.py", "interest_fixed.py"),
    ("statement.py", "statement_buggy.py", "statement_fixed.py"),
]

def swap_all(suffix):
    for target, buggy, fixed in pairs:
        src = buggy if suffix == "buggy" else fixed
        if os.path.exists(src):
            shutil.copy(src, target)
    shutil.rmtree('__pycache__', ignore_errors=True)

def _invoke(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired as e:
        class R: pass
        r = R()
        r.returncode = 124
        r.stdout = (e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or ""))
        r.stderr = "TIMEOUT after 30s (tests hung)"
        return r

def run_tests():
    # Prefer pytest (handles unittest.TestCase + bare test_ funcs); fall back
    # to direct execution if pytest collected nothing (script-style tests).
    r = _invoke([sys.executable, '-B', '-m', 'pytest', test_file, '-x', '--tb=short', '-q'])
    if r.returncode == 5:
        r = _invoke([sys.executable, '-B', test_file])
    return r

swap_all("buggy")
buggy_result = run_tests()
buggy_failed = buggy_result.returncode != 0

swap_all("fixed")
fixed_result = run_tests()
fixed_passed = fixed_result.returncode == 0

if buggy_failed and fixed_passed:
    print("ALL_TESTS_PASSED")
elif not buggy_failed:
    print(f"FAIL: tests did not catch any bugs in buggy code")
    print(f"stdout: {buggy_result.stdout[-500:]}")
else:
    print(f"FAIL: tests fail on corrected code too")
    print(f"stdout: {fixed_result.stdout[-500:]}")
    print(f"stderr: {fixed_result.stderr[-500:]}")
"#,
        )
        .unwrap();

        // account.py has no bugs
        let transfer_buggy = ap(dir, "transfer_buggy.py");
        std::fs::write(
            &transfer_buggy,
            std::fs::read_to_string(&transfer_file).unwrap(),
        )
        .unwrap();
        let interest_buggy = ap(dir, "interest_buggy.py");
        std::fs::write(
            &interest_buggy,
            std::fs::read_to_string(&interest_file).unwrap(),
        )
        .unwrap();
        let statement_buggy = ap(dir, "statement_buggy.py");
        std::fs::write(
            &statement_buggy,
            std::fs::read_to_string(&statement_file).unwrap(),
        )
        .unwrap();

        with_blocked(
            with_scope(
                with_checks(
                    pf(format!(
                        "The banking system spread across {}, {}, {}, and {} is \
             suspected to contain defects where the implementations diverge \
             from their documented contracts. Write a test suite that \
             catches any such divergence — a faithful implementation must \
             pass every assertion, while any deviation from the specified \
             behaviour (including edge cases around failure paths, \
             cross-module interactions, and boundary conditions) must cause \
             at least one failure.\n\n\
             Deliverable: a Python test script whose filename matches \
             `test_*.py`. The current source in this directory is suspected \
             to be buggy — running your test script directly against it is \
             expected to fail; that is the point, not a problem to paper \
             over by weakening assertions. To validate end-to-end, run \
             `python3 run_tests.py`: it prints exactly `ALL_TESTS_PASSED` \
             once your tests both catch the defects and still pass on a \
             faithful implementation. Stop as soon as you see that \
             sentinel — don't keep iterating. The structure, framework, \
             and choice of assertions is yours.",
                        account_file, transfer_file, interest_file, statement_file
                    )),
                    vec![
                        complete(),
                        succeeded("shell"),
                        run_has("python3 run_tests.py", &["ALL_TESTS_PASSED"]),
                    ],
                ),
                vec![
                    account_file.clone(),
                    transfer_file.clone(),
                    interest_file.clone(),
                    statement_file.clone(),
                ],
            ),
            vec![
                transfer_fixed,
                interest_fixed,
                statement_fixed,
                runner,
                transfer_buggy,
                interest_buggy,
                statement_buggy,
            ],
        )
    }
    v.push(scen!(
        "xhard_testing_05_banking_system",
        Category::Testing,
        Difficulty::Hard,
        I,
        setup
    ));
}
