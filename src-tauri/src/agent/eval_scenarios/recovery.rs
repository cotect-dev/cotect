//! Recovery scenarios — the agent must recover from errors, wrong paths, and ambiguity.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    // ── Easy ────────────────────────────────────────────────────────────

    fn s_read_before_patch(dir: &Path) -> SetupResult {
        let p = ap(dir, "data.txt");
        std::fs::write(&p, "old value here\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Change 'old value' to 'new value' in {p}. Remember to read the file first before patching.")),
            vec![complete(), file_has("data.txt", &["new value here"]),
                 file_lacks("data.txt", &["old value"])]),
            vec![p])
    }
    v.push(scen!("recovery_read_before_patch", Category::Recovery, Difficulty::Easy, I, s_read_before_patch));

    fn s_file_not_found(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("actual_config.json"), r#"{"port": 3000}"#).unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Read the file {d}/config.json. If it doesn't exist, search {d} for a similar configuration file and read that instead. Report what you found.")),
            vec![complete(), oc_any(&["actual_config", "3000", "port"]),
                 used_any(&["read", "fs_search", "shell"])])
    }
    v.push(scen!("recovery_file_not_found", Category::Recovery, Difficulty::Easy, I, s_file_not_found));

    fn s_empty_search_results(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("app.py"), "def main(): pass\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} for any functions named 'handle_request'. If none are found, tell me so and \
             instead list what functions do exist.")),
            vec![complete(), succeeded("fs_search"),
                 oc_any(&["not found", "no match", "no result", "none", "main"])])
    }
    v.push(scen!("recovery_no_search_results", Category::Recovery, Difficulty::Easy, I, s_empty_search_results));

    // ── Medium ──────────────────────────────────────────────────────────

    fn s_ambiguous_patch(dir: &Path) -> SetupResult {
        let p = ap(dir, "repeat.py");
        std::fs::write(&p, "x = 1\ny = 2\nx = 1\nz = 3\nx = 1\n").unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, change only the second occurrence of `x = 1` (the one between `y = 2` and `z = 3`) to `x = 99`. \
             Leave the first and third occurrences as `x = 1`. \
             The patch tool requires the old_string to match exactly once — include surrounding lines as context.")),
            vec![complete(),
                 file_has("repeat.py", &["x = 1\ny = 2\nx = 99\nz = 3\nx = 1"])]),
            vec![p])
    }
    v.push(scen!("recovery_ambiguous_patch", Category::Recovery, Difficulty::Medium, I, s_ambiguous_patch));

    fn s_wrong_syntax_recovery(dir: &Path) -> SetupResult {
        let p = ap(dir, "broken.py");
        std::fs::write(&p, r#"def process(items)
    result = []
    for item in items:
        result.append(item * 2)
    return result
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Fix the syntax error in {p} and then add a type annotation for the `items` parameter (list[int]) \
             and return type (list[int]).")),
            vec![complete(),
                 file_has("broken.py", &["def process(items", ":", "list"]),
                 file_lacks("broken.py", &["def process(items)\n"])]),
            vec![p])
    }
    v.push(scen!("recovery_fix_syntax_then_edit", Category::Recovery, Difficulty::Medium, I, s_wrong_syntax_recovery));

    fn s_shell_failure_handling(dir: &Path) -> SetupResult {
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Try to run `python3 {d}/nonexistent.py` via shell. It will fail. \
             Then create {d}/hello.py with `print('hello')` and run it successfully. Report the output.")),
            vec![complete(), succeeded("shell"),
                 file_has("hello.py", &["print"]),
                 oc("hello")])
    }
    v.push(scen!("recovery_shell_fail_then_fix", Category::Recovery, Difficulty::Medium, I, s_shell_failure_handling));

    fn s_patch_with_context(dir: &Path) -> SetupResult {
        let p = ap(dir, "funcs.js");
        std::fs::write(&p, r#"function alpha() {
  return 1;
}

function beta() {
  return 1;
}

function gamma() {
  return 1;
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, change only beta's return value from 1 to 42. \
             alpha and gamma must still return 1.")),
            vec![complete(),
                 file_has("funcs.js", &["function beta() {\n  return 42;"]),
                 file_has("funcs.js", &["function alpha() {\n  return 1;"]),
                 file_has("funcs.js", &["function gamma() {\n  return 1;"])]),
            vec![p])
    }
    v.push(scen!("recovery_disambiguate_patch", Category::Recovery, Difficulty::Medium, I, s_patch_with_context));

    // ── Hard ────────────────────────────────────────────────────────────

    fn s_large_file_navigation(dir: &Path) -> SetupResult {
        let p = ap(dir, "big.py");
        let mut content = String::new();
        for i in 1..=200 {
            content.push_str(&format!("def func_{i}():\n    return {i}\n\n"));
        }
        std::fs::write(&p, &content).unwrap();
        with_scope(with_checks(pf(format!(
            "In {p} (a 200-function file), find and modify `func_150` to return 999 instead of 150. \
             Don't modify any other function.")),
            vec![complete(),
                 file_has("big.py", &["def func_150():\n    return 999"]),
                 file_has("big.py", &["def func_149():\n    return 149"]),
                 file_has("big.py", &["def func_151():\n    return 151"])]),
            vec![p])
    }
    v.push(scen!("recovery_large_file_edit", Category::Recovery, Difficulty::Hard, I, s_large_file_navigation));

    fn s_multiple_errors(dir: &Path) -> SetupResult {
        let p = ap(dir, "broken.rs");
        std::fs::write(&p, r#"pub fn process(items: Vec<String>) -> Vec<String> {
    let mut result = Vec:new();
    for item in &items {
        let upper = item.to_uppercase()
        result.push(upper);
    }
    result
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "The code in {p} has multiple syntax errors: \
             `Vec:new()` should be `Vec::new()`, and there's a missing semicolon after `to_uppercase()`. \
             Fix all errors so the code compiles.")),
            vec![complete(),
                 file_has("broken.rs", &["Vec::new()", "to_uppercase();"]),
                 file_lacks("broken.rs", &["Vec:new()", "to_uppercase()\n"])]),
            vec![p])
    }
    v.push(scen!("recovery_fix_multiple_errors", Category::Recovery, Difficulty::Hard, I, s_multiple_errors));

    fn s_wrong_approach_pivot(dir: &Path) -> SetupResult {
        let p = ap(dir, "config.yaml");
        std::fs::write(&p, "server:\n  host: 0.0.0.0\n  port: 8080\n  workers: 4\n\ndatabase:\n  url: postgres://localhost/app\n  pool_size: 10\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} (it's YAML-like), then change the port to 9090 and pool_size to 20. \
             Keep all other values unchanged.")),
            vec![complete(),
                 file_has("config.yaml", &["port: 9090", "pool_size: 20", "host: 0.0.0.0", "workers: 4"]),
                 file_lacks("config.yaml", &["port: 8080", "pool_size: 10"])]),
            vec![p])
    }
    v.push(scen!("recovery_yaml_multi_edit", Category::Recovery, Difficulty::Hard, I, s_wrong_approach_pivot));
}
