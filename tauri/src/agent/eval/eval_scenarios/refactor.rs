//! Refactoring scenarios — rename, extract, inline, restructure code.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {

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
