//! Refactoring scenarios — rename, extract, inline, restructure code.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    // ── Easy ────────────────────────────────────────────────────────────

    fn s_rename_variable(dir: &Path) -> SetupResult {
        let p = ap(dir, "calc.py");
        std::fs::write(&p, "\
def compute(x):
    t = x * 2
    t = t + 10
    t = t / 3
    return t
").unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, rename the variable `t` to `result` throughout the function. Keep all logic identical.")),
            vec![complete(), file_has("calc.py", &["result = x * 2", "result = result + 10", "return result"]),
                 // Use " t =" with leading space to avoid matching "result =" which contains "t ="
                 file_lacks("calc.py", &[" t =", "return t"])]),
            vec![p])
    }
    v.push(scen!("refactor_rename_variable", Category::Refactor, Difficulty::Easy, I, s_rename_variable));

    fn s_const_extraction(dir: &Path) -> SetupResult {
        let p = ap(dir, "pricing.ts");
        std::fs::write(&p, "\
export function calculateTotal(items: number[]): number {
  const subtotal = items.reduce((a, b) => a + b, 0);
  const withTax = subtotal * 1.23;
  const withShipping = withTax + 9.99;
  return Math.round(withShipping * 100) / 100;
}
").unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, the magic numbers 1.23 (tax rate) and 9.99 (shipping cost) should be named constants. \
             Extract them as `const TAX_RATE = 1.23` and `const SHIPPING_COST = 9.99` at the top of the \
             file and use them in the function.")),
            vec![complete(), file_has("pricing.ts", &["TAX_RATE", "SHIPPING_COST", "1.23", "9.99"]),
                 file_lacks("pricing.ts", &["subtotal * 1.23", "withTax + 9.99"])]),
            vec![p])
    }
    v.push(scen!("refactor_extract_constants", Category::Refactor, Difficulty::Easy, I, s_const_extraction));

    fn s_simplify_conditional(dir: &Path) -> SetupResult {
        let p = ap(dir, "check.py");
        std::fs::write(&p, "\
def is_eligible(age, has_license):
    if age >= 18:
        if has_license:
            return True
        else:
            return False
    else:
        return False
").unwrap();
        with_scope(with_checks(pf(format!(
            "The function in {p} has unnecessarily nested conditionals. Simplify it to a single return \
             statement using `and` (e.g. `return age >= 18 and has_license`).")),
            vec![complete(), file_has("check.py", &["return age >= 18 and has_license"]),
                 file_lacks("check.py", &["if age >= 18:", "else:"])]),
            vec![p])
    }
    v.push(scen!("refactor_simplify_conditional", Category::Refactor, Difficulty::Easy, I, s_simplify_conditional));

    // ── Medium ──────────────────────────────────────────────────────────

    fn s_extract_function(dir: &Path) -> SetupResult {
        let p = ap(dir, "report.py");
        std::fs::write(&p, r#"def generate_report(data):
    # Validate
    if not data:
        raise ValueError("No data")
    if not isinstance(data, list):
        raise TypeError("Expected list")

    # Calculate statistics
    total = sum(data)
    average = total / len(data)
    minimum = min(data)
    maximum = max(data)

    # Format output
    lines = []
    lines.append(f"Total:   {total}")
    lines.append(f"Average: {average:.2f}")
    lines.append(f"Min:     {minimum}")
    lines.append(f"Max:     {maximum}")
    return "\n".join(lines)
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "The function in {p} does three things: validation, statistics, and formatting. \
             Extract the statistics calculation into a separate `calculate_stats(data)` function \
             that returns a dict with keys total, average, min, max. Then call it from generate_report.")),
            vec![complete(),
                 file_has("report.py", &["def calculate_stats", "def generate_report"]),
                 file_has("report.py", &["calculate_stats(data)"])]),
            vec![p])
    }
    v.push(scen!("refactor_extract_function", Category::Refactor, Difficulty::Medium, I, s_extract_function));

    fn s_class_from_functions(dir: &Path) -> SetupResult {
        let p = ap(dir, "stack.py");
        std::fs::write(&p, "\
_items = []

def push(item):
    _items.append(item)

def pop():
    return _items.pop()

def peek():
    return _items[-1]

def is_empty():
    return len(_items) == 0

def size():
    return len(_items)
").unwrap();
        with_scope(with_checks(pf(format!(
            "Refactor {p}: wrap the module-level functions and `_items` list into a `Stack` class. \
             The class should have an `__init__` that creates `self.items = []`, and each function \
             becomes a method. Remove the module-level `_items`.")),
            vec![complete(),
                 file_has("stack.py", &["class Stack", "def __init__", "self.items", "def push(self", "def pop(self"]),
                 file_lacks("stack.py", &["_items = []"])]),
            vec![p])
    }
    v.push(scen!("refactor_functions_to_class", Category::Refactor, Difficulty::Medium, I, s_class_from_functions));

    fn s_loops_to_comprehension(dir: &Path) -> SetupResult {
        let p = ap(dir, "transform.py");
        std::fs::write(&p, r#"def get_upper_names(users):
    """Return uppercase names of active users."""
    result = []
    for user in users:
        if user.get("active"):
            name = user.get("name", "")
            result.append(name.upper())
    return result

def get_emails(users):
    """Return a set of unique email domains."""
    domains = set()
    for user in users:
        email = user.get("email", "")
        if "@" in email:
            domain = email.split("@")[1]
            domains.add(domain)
    return domains
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Refactor both functions in {p} to use Python comprehensions instead of explicit loops. \
             `get_upper_names` should use a list comprehension, `get_emails` should use a set comprehension.")),
            vec![complete(),
                 file_has("transform.py", &["return ["]),
                 file_has("transform.py", &["return {"]),
                 file_lacks("transform.py", &["result = []", "domains = set()"])]),
            vec![p])
    }
    v.push(scen!("refactor_to_comprehensions", Category::Refactor, Difficulty::Medium, I, s_loops_to_comprehension));

    fn s_callback_to_promise(dir: &Path) -> SetupResult {
        let p = ap(dir, "api.js");
        std::fs::write(&p, "\
function fetchUser(id, callback) {
  makeRequest('/users/' + id, function(err, response) {
    if (err) {
      callback(err, null);
      return;
    }
    parseJSON(response, function(err, data) {
      if (err) {
        callback(err, null);
        return;
      }
      callback(null, data.user);
    });
  });
}
").unwrap();
        with_scope(with_checks(pf(format!(
            "Refactor {p} to use async/await instead of nested callbacks. The function should become \
             `async function fetchUser(id)` that awaits makeRequest and parseJSON, and returns data.user. \
             Errors should propagate naturally via exceptions rather than callback(err, null).")),
            vec![complete(),
                 file_has("api.js", &["async function fetchUser", "await"]),
                 file_lacks("api.js", &["callback(err", "callback(null"])]),
            vec![p])
    }
    v.push(scen!("refactor_callbacks_to_async", Category::Refactor, Difficulty::Medium, I, s_callback_to_promise));

    // ── Hard ────────────────────────────────────────────────────────────

    fn s_decompose_god_function(dir: &Path) -> SetupResult {
        let p = ap(dir, "processor.py");
        std::fs::write(&p, r#"def process_order(order):
    # Validate order
    if not order.get("items"):
        return {"error": "No items"}
    if not order.get("customer_id"):
        return {"error": "No customer"}
    for item in order["items"]:
        if item.get("quantity", 0) <= 0:
            return {"error": f"Invalid quantity for {item.get('name')}"}
        if item.get("price", 0) < 0:
            return {"error": f"Invalid price for {item.get('name')}"}

    # Calculate totals
    subtotal = 0
    for item in order["items"]:
        subtotal += item["price"] * item["quantity"]
    tax = subtotal * 0.08
    shipping = 5.99 if subtotal < 50 else 0
    total = subtotal + tax + shipping

    # Build response
    return {
        "customer_id": order["customer_id"],
        "subtotal": round(subtotal, 2),
        "tax": round(tax, 2),
        "shipping": round(shipping, 2),
        "total": round(total, 2),
        "item_count": sum(i["quantity"] for i in order["items"]),
    }
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "The function in {p} does validation, calculation, and response building all in one. \
             Decompose it into three helper functions: `validate_order(order)`, `calculate_totals(order)`, \
             and keep `process_order` as the orchestrator that calls them.")),
            vec![complete(),
                 file_has("processor.py", &["def validate_order", "def calculate_totals", "def process_order"]),
                 file_has("processor.py", &["validate_order(order)", "calculate_totals(order)"])]),
            vec![p])
    }
    v.push(scen!("refactor_decompose_function", Category::Refactor, Difficulty::Hard, I, s_decompose_god_function));

    fn s_enum_from_strings(dir: &Path) -> SetupResult {
        let p = ap(dir, "status.ts");
        std::fs::write(&p, r#"export function getStatusLabel(status: string): string {
  if (status === "pending") return "Pending Review";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "archived") return "Archived";
  return "Unknown";
}

export function isTerminal(status: string): boolean {
  return status === "approved" || status === "rejected" || status === "archived";
}

export function canTransition(from: string, to: string): boolean {
  if (from === "pending" && (to === "approved" || to === "rejected")) return true;
  if ((from === "approved" || from === "rejected") && to === "archived") return true;
  return false;
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, status values are raw strings repeated everywhere. Refactor: \
             1) Create an enum `Status` with members Pending, Approved, Rejected, Archived. \
             2) Update all three functions to use the enum instead of string literals.")),
            vec![complete(),
                 file_has("status.ts", &["enum Status"]),
                 file_has("status.ts", &["Status.Pending", "Status.Approved", "Status.Rejected", "Status.Archived"]),
                 // string literals are OK inside enum value assignments like `Pending = "pending"`
                 // but the function bodies should use enum members not raw strings
                 file_lacks("status.ts", &["=== \"pending\"", "=== \"approved\"", "=== \"rejected\"", "=== \"archived\""])]),
            vec![p])
    }
    v.push(scen!("refactor_strings_to_enum", Category::Refactor, Difficulty::Hard, I, s_enum_from_strings));

    fn s_rename_across_file(dir: &Path) -> SetupResult {
        let p = ap(dir, "utils.rs");
        std::fs::write(&p, r#"pub fn calc(a: f64, b: f64) -> f64 {
    a + b
}

pub fn calc_diff(a: f64, b: f64) -> f64 {
    a - b
}

pub fn do_calc(values: &[f64]) -> f64 {
    let mut total = 0.0;
    for &v in values {
        total = calc(total, v);
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calc() {
        assert_eq!(calc(2.0, 3.0), 5.0);
    }

    #[test]
    fn test_do_calc() {
        assert_eq!(do_calc(&[1.0, 2.0, 3.0]), 6.0);
    }
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, rename the function `calc` to `add` everywhere it appears (definition, calls, tests). \
             Also rename `calc_diff` to `subtract` and `do_calc` to `sum_all`. Keep the logic and tests intact.")),
            vec![complete(),
                 file_has("utils.rs", &["fn add(", "fn subtract(", "fn sum_all(", "total = add(total", "test_add", "add(2.0"]),
                 file_lacks("utils.rs", &["fn calc(", "fn calc_diff(", "fn do_calc("])]),
            vec![p])
    }
    v.push(scen!("refactor_rename_multi_symbol", Category::Refactor, Difficulty::Hard, I, s_rename_across_file));
}
