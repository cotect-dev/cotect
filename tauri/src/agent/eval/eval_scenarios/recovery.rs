//! Recovery scenarios — the agent must recover from errors, wrong paths, and ambiguity.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {

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
