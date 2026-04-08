//! Testing v2 — Scenario 03: Shopping cart
//!
//! Three-file Python shopping cart system. The model must write tests
//! that exercise the classes according to their docstrings.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let product_file = ap(dir, "product.py");
        std::fs::write(&product_file, r#"class Product:
    """Represents a product with name and price.

    Two products are equal if they have the same name (case-insensitive).
    Hash is based on the lowercased name so products work correctly in sets/dicts.

    >>> p = Product("Widget", 9.99)
    >>> p.name
    'Widget'
    >>> p.price
    9.99
    """

    def __init__(self, name: str, price: float):
        if price < 0:
            raise ValueError("price must be non-negative")
        self.name = name
        self.price = price

    def __eq__(self, other):
        if not isinstance(other, Product):
            return NotImplemented
        return self.name.lower() == other.name.lower()

    def __hash__(self):
        return hash(self.name.lower())

    def __repr__(self):
        return f"Product({self.name!r}, {self.price})"
"#).unwrap();

        let discount_file = ap(dir, "discount.py");
        std::fs::write(&discount_file, r#"class PercentDiscount:
    """A percentage-based discount.

    The `apply(price)` method returns the discounted price.
    The discount is applied fresh each time — it must not depend
    on any previous call or cached state.

    >>> d = PercentDiscount(20)
    >>> d.apply(100.0)
    80.0
    >>> d.apply(50.0)
    40.0
    """

    def __init__(self, percent: float):
        if not (0 <= percent <= 100):
            raise ValueError("percent must be between 0 and 100")
        self.percent = percent
        self._cached_price = None

    def apply(self, price: float) -> float:
        if self._cached_price is None:
            self._cached_price = price
        return self._cached_price * (1 - self.percent / 100)
"#).unwrap();

        let cart_file = ap(dir, "cart.py");
        std::fs::write(&cart_file, r#"from product import Product


class ShoppingCart:
    """A shopping cart that holds products with quantities.

    Supports adding/removing items and computing totals.
    An optional discount can be applied to the cart subtotal.

    The discount (if any) is applied to the overall subtotal,
    not to individual items.

    >>> cart = ShoppingCart()
    >>> cart.add(Product("A", 10.0), qty=2)
    >>> cart.subtotal()
    20.0
    """

    def __init__(self, discount=None):
        self._items = {}
        self._discount = discount

    def add(self, product: Product, qty: int = 1):
        """Add qty units of product to the cart. qty must be positive."""
        if qty <= 0:
            raise ValueError("qty must be positive")
        if product in self._items:
            self._items[product] += qty
        else:
            self._items[product] = qty

    def remove(self, product: Product, qty: int = 1):
        """Remove qty units. Raises KeyError if product not in cart.
        If qty >= current quantity, removes the product entirely.
        """
        if product not in self._items:
            raise KeyError(f"{product.name} not in cart")
        self._items[product] -= qty
        if self._items[product] <= 0:
            del self._items[product]

    def quantity(self, product: Product) -> int:
        """Return the quantity of a product in the cart (0 if absent)."""
        return self._items.get(product, 0)

    def subtotal(self) -> float:
        """Sum of (price * qty) for all items, before discount."""
        return sum(p.price * q for p, q in self._items.items())

    def total(self) -> float:
        """Subtotal with discount applied (if any).

        The discount is applied to the subtotal as a whole,
        not per-item.
        """
        if self._discount is None:
            return self.subtotal()
        return sum(self._discount.apply(p.price) * q
                   for p, q in self._items.items())

    def item_count(self) -> int:
        """Total number of items (sum of all quantities)."""
        return sum(self._items.values())

    def clear(self):
        """Remove all items from the cart."""
        self._items.clear()
"#).unwrap();

        // Fixed versions
        let discount_fixed = ap(dir, "discount_fixed.py");
        std::fs::write(&discount_fixed, r#"class PercentDiscount:
    """A percentage-based discount.

    The `apply(price)` method returns the discounted price.
    The discount is applied fresh each time — it must not depend
    on any previous call or cached state.

    >>> d = PercentDiscount(20)
    >>> d.apply(100.0)
    80.0
    >>> d.apply(50.0)
    40.0
    """

    def __init__(self, percent: float):
        if not (0 <= percent <= 100):
            raise ValueError("percent must be between 0 and 100")
        self.percent = percent

    def apply(self, price: float) -> float:
        return price * (1 - self.percent / 100)
"#).unwrap();

        let cart_fixed = ap(dir, "cart_fixed.py");
        std::fs::write(&cart_fixed, r#"from product import Product


class ShoppingCart:
    """A shopping cart that holds products with quantities.

    Supports adding/removing items and computing totals.
    An optional discount can be applied to the cart subtotal.

    The discount (if any) is applied to the overall subtotal,
    not to individual items.

    >>> cart = ShoppingCart()
    >>> cart.add(Product("A", 10.0), qty=2)
    >>> cart.subtotal()
    20.0
    """

    def __init__(self, discount=None):
        self._items = {}
        self._discount = discount

    def add(self, product: Product, qty: int = 1):
        """Add qty units of product to the cart. qty must be positive."""
        if qty <= 0:
            raise ValueError("qty must be positive")
        if product in self._items:
            self._items[product] += qty
        else:
            self._items[product] = qty

    def remove(self, product: Product, qty: int = 1):
        """Remove qty units. Raises KeyError if product not in cart.
        If qty >= current quantity, removes the product entirely.
        """
        if product not in self._items:
            raise KeyError(f"{product.name} not in cart")
        self._items[product] -= qty
        if self._items[product] <= 0:
            del self._items[product]

    def quantity(self, product: Product) -> int:
        """Return the quantity of a product in the cart (0 if absent)."""
        return self._items.get(product, 0)

    def subtotal(self) -> float:
        """Sum of (price * qty) for all items, before discount."""
        return sum(p.price * q for p, q in self._items.items())

    def total(self) -> float:
        """Subtotal with discount applied (if any).

        The discount is applied to the subtotal as a whole,
        not per-item.
        """
        if self._discount is None:
            return self.subtotal()
        return self._discount.apply(self.subtotal())

    def item_count(self) -> int:
        """Total number of items (sum of all quantities)."""
        return sum(self._items.values())

    def clear(self):
        """Remove all items from the cart."""
        self._items.clear()
"#).unwrap();

        let runner = ap(dir, "run_tests.py");
        std::fs::write(&runner, r#"import subprocess, sys, os, shutil

test_file = None
for f in sorted(os.listdir(".")):
    if f.startswith("test_") and f.endswith(".py") and f != "run_tests.py":
        test_file = f
        break

if test_file is None:
    print("NO_TEST_FILE_FOUND")
    sys.exit(1)

pairs = [
    ("discount.py", "discount_buggy.py", "discount_fixed.py"),
    ("cart.py", "cart_buggy.py", "cart_fixed.py"),
]

def swap_all(suffix):
    for target, buggy, fixed in pairs:
        src = buggy if suffix == "buggy" else fixed
        if os.path.exists(src):
            shutil.copy(src, target)
    shutil.rmtree('__pycache__', ignore_errors=True)

def run_tests():
    return subprocess.run(
        [sys.executable, '-B', test_file],
        capture_output=True, text=True, timeout=30
    )

swap_all("buggy")
buggy_result = run_tests()
buggy_failed = buggy_result.returncode != 0 or "ALL_TESTS_PASSED" not in buggy_result.stdout

swap_all("fixed")
fixed_result = run_tests()
fixed_passed = fixed_result.returncode == 0 and "ALL_TESTS_PASSED" in fixed_result.stdout

if buggy_failed and fixed_passed:
    print("ALL_TESTS_PASSED")
elif not buggy_failed:
    print(f"FAIL: tests did not catch any bugs in buggy code")
    print(f"stdout: {buggy_result.stdout[-500:]}")
else:
    print(f"FAIL: tests fail on corrected code too")
    print(f"stdout: {fixed_result.stdout[-500:]}")
    print(f"stderr: {fixed_result.stderr[-500:]}")
"#).unwrap();

        // product.py has no bugs — used as-is for both buggy and fixed
        let product_buggy = ap(dir, "product_buggy.py");
        std::fs::write(&product_buggy, std::fs::read_to_string(&product_file).unwrap()).unwrap();
        let discount_buggy = ap(dir, "discount_buggy.py");
        std::fs::write(&discount_buggy, std::fs::read_to_string(&discount_file).unwrap()).unwrap();
        let cart_buggy = ap(dir, "cart_buggy.py");
        std::fs::write(&cart_buggy, std::fs::read_to_string(&cart_file).unwrap()).unwrap();

        with_blocked(with_scope(with_checks(pf(format!(
            "The shopping cart system in {}, {}, and {} may have bugs. \
             Your task is to write a comprehensive test file `test_cart.py` \
             that tests the classes across all three modules according to their docstrings.\n\n\
             Step 1: Read all source files and their docstrings carefully.\n\
             Step 2: Write `test_cart.py` with thorough tests. \
             Print \"ALL_TESTS_PASSED\" at the end if all assertions pass.\n\
             Step 3: Run `python3 test_cart.py` to see which tests catch bugs.",
            product_file, discount_file, cart_file)),
            vec![
                complete(),
                succeeded("shell"),
                run_has("python3 run_tests.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![product_file.clone(), discount_file.clone(), cart_file.clone(),
                 ap(dir, "test_cart.py")]),
            vec![discount_fixed, cart_fixed, runner, product_buggy, discount_buggy, cart_buggy])
    }
    v.push(scen!("v2_testing_03_shopping_cart", Category::Testing, Difficulty::Hard, I, setup));
}
