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
            "Refactor both functions in {p} to be more concise and idiomatic Python. \
             The explicit accumulator loops are verbose — each function can be expressed as a single \
             expression. Preserve behavior: `get_upper_names` returns a list of uppercased names of \
             active users, `get_emails` returns a set of unique domains from addresses containing '@'.")),
            vec![complete(),
                 file_lacks("transform.py", &["result = []", "result.append(", "domains = set()", "domains.add("])]),
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
            "Refactor {p} to eliminate the nested callback pyramid. Modernize the control flow so that \
             errors propagate naturally instead of being threaded through `callback(err, ...)` arguments, \
             and so the two sequential async steps read linearly. The function should still fetch a user \
             by id, parse the JSON response, and yield `data.user`. Assume `makeRequest` and `parseJSON` \
             can be adapted/wrapped as needed.")),
            vec![complete(),
                 file_has("api.js", &["await"]),
                 file_lacks("api.js", &["callback(err", "callback(null", "function(err,"])]),
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
            "The function in {p} mixes three distinct concerns — input validation, numeric calculation, \
             and response assembly — in one long body. Split it so each concern lives in its own helper \
             and `process_order` becomes a short orchestrator that delegates to them. Preserve the \
             existing behavior and return shape exactly.")),
            vec![complete(),
                 file_has("processor.py", &["def process_order"]),
                 // At least three top-level `def` statements means process_order plus two helpers.
                 run_ok("python3 -c \"import re,sys; sys.exit(0 if len(re.findall(r'^def \\\\w+', open('processor.py').read(), re.M))>=3 else 1)\"")]),
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
            "In {p}, status values are raw strings repeated across multiple functions — a classic \
             stringly-typed smell. Introduce a proper type so the valid statuses are declared once and \
             reused, then update the three functions to reference that type instead of comparing against \
             string literals. Preserve the existing function signatures and behavior.")),
            vec![complete(),
                 // A type abstraction must exist: enum, const-enum, or an `as const` object literal.
                 Check::RunOutputContains(
                     "grep -qE '(enum[[:space:]]+[A-Z]|as[[:space:]]+const)' status.ts && echo TYPE_OK".into(),
                     10,
                     vec!["TYPE_OK".into()],
                 ),
                 // String-literal comparisons in function bodies must be gone.
                 file_lacks("status.ts", &["=== \"pending\"", "=== \"approved\"", "=== \"rejected\"", "=== \"archived\"",
                                           "== \"pending\"", "== \"approved\"", "== \"rejected\"", "== \"archived\""])]),
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
