//! Scenario registry for the eval harness — 100 scenarios.
//! See eval.rs for the runner and types.

use std::path::Path;

use crate::agent::types::AgentRole;
use super::{Category, Check, Difficulty, ScenarioSpec, SetupResult};

// Shorthand builders
fn pf(prompt: impl Into<String>) -> SetupResult {
    SetupResult { prompt: prompt.into(), scope_files: vec![], checks: vec![] }
}

fn with_checks(mut s: SetupResult, checks: Vec<Check>) -> SetupResult { s.checks = checks; s }
fn with_scope(mut s: SetupResult, files: Vec<String>) -> SetupResult { s.scope_files = files; s }

// Common check helpers
fn oc(needle: &str) -> Check { Check::OutputContains(needle.into()) }
fn oc_all(needles: &[&str]) -> Check { Check::OutputContainsAll(needles.iter().map(|s| s.to_string()).collect()) }
fn oc_any(needles: &[&str]) -> Check { Check::OutputContainsAny(needles.iter().map(|s| s.to_string()).collect()) }
#[allow(dead_code)]
fn oc_not(needles: &[&str]) -> Check { Check::OutputDoesNotContain(needles.iter().map(|s| s.to_string()).collect()) }
/// The last integer in the output must equal `n`. Use this for numeric answers
/// instead of `oc("42")` because Gemma 4 may reason through examples (e.g. "I see
/// 4 rows, so 4 - 1 header = 3 data rows") and oc would match the wrong number.
fn num(n: i64) -> Check { Check::LastNumberEquals(n) }
#[allow(dead_code)]
fn used(tool: &str) -> Check { Check::UsedTool(tool.into()) }
fn succeeded(tool: &str) -> Check { Check::ToolSucceeded(tool.into()) }
fn used_any(tools: &[&str]) -> Check { Check::UsedAnyTool(tools.iter().map(|s| s.to_string()).collect()) }
fn complete() -> Check { Check::Completed }
#[allow(dead_code)]
fn file_exists(path: &str) -> Check { Check::FileExists(path.into()) }
fn file_has(path: &str, needles: &[&str]) -> Check { Check::FileContains(path.into(), needles.iter().map(|s| s.to_string()).collect()) }
fn file_lacks(path: &str, needles: &[&str]) -> Check { Check::FileDoesNotContain(path.into(), needles.iter().map(|s| s.to_string()).collect()) }

// Path helper — absolute path under the temp dir
fn ap(dir: &Path, rel: &str) -> String { dir.join(rel).to_string_lossy().into_owned() }

// Scenario construction shortcut
macro_rules! scen {
    ($id:expr, $cat:expr, $diff:expr, $role:expr, $setup:ident) => {
        ScenarioSpec {
            id: $id,
            category: $cat,
            difficulty: $diff,
            role: $role,
            setup: $setup,
        }
    };
}

pub(super) fn make_scenarios() -> Vec<ScenarioSpec> {
    let mut v = Vec::with_capacity(100);
    reasoning_scenarios(&mut v);
    read_scenarios(&mut v);
    write_scenarios(&mut v);
    patch_scenarios(&mut v);
    search_scenarios(&mut v);
    shell_scenarios(&mut v);
    workflow_scenarios(&mut v);
    recovery_scenarios(&mut v);
    understanding_scenarios(&mut v);
    planning_scenarios(&mut v);
    v
}

// ────────────────────────────────────────────────────────────────────────
// REASONING — 10 scenarios (no tools needed)
// ────────────────────────────────────────────────────────────────────────

fn reasoning_scenarios(v: &mut Vec<ScenarioSpec>) {
    use AgentRole::Research as R;

    fn s_add(_: &Path) -> SetupResult { with_checks(pf("What is 17 + 26? State your final answer as the last number in your reply."), vec![complete(), num(43)]) }
    v.push(scen!("reason_add_2digit", Category::Reasoning, Difficulty::Easy, R, s_add));

    fn s_mul(_: &Path) -> SetupResult { with_checks(pf("What is 13 * 24? State your final answer as the last number in your reply."), vec![complete(), num(312)]) }
    v.push(scen!("reason_mul_2digit", Category::Reasoning, Difficulty::Easy, R, s_mul));

    fn s_seq(_: &Path) -> SetupResult { with_checks(pf("Continue this sequence with the next number only: 2, 4, 8, 16, ? Reply with only the next number."), vec![complete(), num(32)]) }
    v.push(scen!("reason_seq_powers2", Category::Reasoning, Difficulty::Easy, R, s_seq));

    fn s_reverse(_: &Path) -> SetupResult { with_checks(pf("Reverse the characters of the string 'hello world'. Reply with only the reversed string."), vec![complete(), oc("dlrow olleh")]) }
    v.push(scen!("reason_reverse_string", Category::Reasoning, Difficulty::Easy, R, s_reverse));

    fn s_fib(_: &Path) -> SetupResult { with_checks(pf("What is the 10th Fibonacci number (starting F1=1, F2=1)? State your final answer as the last number in your reply."), vec![complete(), num(55)]) }
    v.push(scen!("reason_fib_10", Category::Reasoning, Difficulty::Medium, R, s_fib));

    fn s_prime(_: &Path) -> SetupResult { with_checks(pf("How many prime numbers are there between 1 and 30 (inclusive)? State your final answer as the last number in your reply."), vec![complete(), num(10)]) }
    v.push(scen!("reason_count_primes_30", Category::Reasoning, Difficulty::Medium, R, s_prime));

    fn s_logic(_: &Path) -> SetupResult { with_checks(pf("If all bloops are razzies, and all razzies are lazzies, are all bloops definitely lazzies? Reply yes or no."), vec![complete(), oc("yes")]) }
    v.push(scen!("reason_syllogism", Category::Reasoning, Difficulty::Medium, R, s_logic));

    fn s_word(_: &Path) -> SetupResult { with_checks(pf("How many times does the letter 'r' appear in the word 'strawberry'? State your final answer as the last number in your reply."), vec![complete(), num(3)]) }
    v.push(scen!("reason_count_letters", Category::Reasoning, Difficulty::Medium, R, s_word));

    fn s_code(_: &Path) -> SetupResult { with_checks(pf(
        "What does this Python code print?\n\n```python\nx = [1,2,3,4,5]\nprint(sum(x[::2]))\n```\n\nState your final answer as the last number in your reply."),
        vec![complete(), num(9)]) }
    v.push(scen!("reason_code_trace_py", Category::Reasoning, Difficulty::Medium, R, s_code));

    fn s_hard(_: &Path) -> SetupResult { with_checks(pf(
        "Three friends split a restaurant bill of $87.60 equally. Then each person leaves an additional $3 tip. How much did each person pay total? Show the answer in dollars, e.g. '$12.34'."),
        vec![complete(), oc_any(&["$32.20", "32.20"])]) }
    v.push(scen!("reason_word_problem", Category::Reasoning, Difficulty::Hard, R, s_hard));
}

// ────────────────────────────────────────────────────────────────────────
// READ — 10 scenarios: file reading / content extraction
// ────────────────────────────────────────────────────────────────────────

fn read_scenarios(v: &mut Vec<ScenarioSpec>) {
    use AgentRole::Research as R;

    fn s1(dir: &Path) -> SetupResult {
        let p = ap(dir, "a.txt");
        std::fs::write(&p, "MAGIC_TOKEN=ZULU-7142\nother=stuff\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read the file {p} and tell me the value of MAGIC_TOKEN.")),
            vec![complete(), succeeded("read"), oc("ZULU-7142")]),
            vec![p])
    }
    v.push(scen!("read_simple_kv", Category::Read, Difficulty::Easy, R, s1));

    fn s2(dir: &Path) -> SetupResult {
        let p = ap(dir, "nums.txt");
        std::fs::write(&p, "10\n20\n30\n40\n50\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} and tell me the sum of all numbers in the file. State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("read"), num(150)]),
            vec![p])
    }
    v.push(scen!("read_sum_numbers", Category::Read, Difficulty::Easy, R, s2));

    fn s3(dir: &Path) -> SetupResult {
        let p = ap(dir, "names.csv");
        std::fs::write(&p, "name,age\nalice,30\nbob,25\ncarol,40\ndan,35\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} (CSV file) and tell me how many rows of data it has (excluding the header). State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("read"), num(4)]),
            vec![p])
    }
    v.push(scen!("read_csv_rowcount", Category::Read, Difficulty::Easy, R, s3));

    fn s4(dir: &Path) -> SetupResult {
        let p = ap(dir, "config.json");
        std::fs::write(&p, r#"{"debug": false, "port": 8080, "host": "localhost"}"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read the JSON file {p} and tell me the value of the 'port' field. State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("read"), num(8080)]),
            vec![p])
    }
    v.push(scen!("read_json_field", Category::Read, Difficulty::Easy, R, s4));

    fn s5(dir: &Path) -> SetupResult {
        let p = ap(dir, "log.txt");
        let mut content = String::new();
        for i in 1..=100 {
            content.push_str(&format!("line {i}: event {}\n", (i * 7 + 3) % 17));
        }
        std::fs::write(&p, content).unwrap();
        // (52*7+3) % 17 = 367 % 17 = 367 - 21*17 = 367 - 357 = 10
        with_scope(with_checks(pf(format!(
            "Read lines 50 to 55 (inclusive) of {p}. Tell me the event number on line 52. State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("read"), num(10)]),
            vec![p])
    }
    v.push(scen!("read_line_range", Category::Read, Difficulty::Medium, R, s5));

    fn s6(dir: &Path) -> SetupResult {
        let p1 = ap(dir, "a.txt");
        let p2 = ap(dir, "b.txt");
        std::fs::write(&p1, "apples: 7\n").unwrap();
        std::fs::write(&p2, "oranges: 11\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read both {p1} and {p2}. What is the total count (apples + oranges)? State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("read"), num(18)]),
            vec![p1, p2])
    }
    v.push(scen!("read_two_files_sum", Category::Read, Difficulty::Medium, R, s6));

    fn s7(dir: &Path) -> SetupResult {
        let p = ap(dir, "code.py");
        std::fs::write(&p, "def greet(name):\n    return f'Hello, {name}!'\n\ndef farewell(name):\n    return f'Bye, {name}.'\n\ndef shout(text):\n    return text.upper()\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} and tell me how many function definitions it contains. State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("read"), num(3)]),
            vec![p])
    }
    v.push(scen!("read_count_functions", Category::Read, Difficulty::Medium, R, s7));

    fn s8(dir: &Path) -> SetupResult {
        let p = ap(dir, "data.txt");
        std::fs::write(&p, "temperature: 22.5\nhumidity: 67\npressure: 1013.25\nwind_speed: 15.3\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} and list all keys present. Separate them with commas.")),
            vec![complete(), succeeded("read"), oc_all(&["temperature", "humidity", "pressure", "wind_speed"])]),
            vec![p])
    }
    v.push(scen!("read_list_keys", Category::Read, Difficulty::Medium, R, s8));

    fn s9(dir: &Path) -> SetupResult {
        let p = ap(dir, "story.txt");
        std::fs::write(&p, "Once upon a time in a land far away, there lived a curious fox named Rufus. Rufus loved exploring the forest and learning about plants, animals, and the occasional hidden treasure.\nOne day, Rufus discovered a glowing mushroom that granted him the ability to understand the language of birds.\nFrom that day forward, Rufus became the messenger of the forest, bridging the communication gap between woodland creatures.\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} and tell me the name of the main character. State the name clearly.")),
            vec![complete(), succeeded("read"), oc("Rufus")]),
            vec![p])
    }
    v.push(scen!("read_story_character", Category::Read, Difficulty::Medium, R, s9));

    fn s10(dir: &Path) -> SetupResult {
        let p = ap(dir, "yaml.txt");
        std::fs::write(&p, "database:\n  host: db.internal\n  port: 5432\n  credentials:\n    user: admin\n    password: s3cret\nfeatures:\n  - beta_mode\n  - new_ui\n  - fast_search\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} (YAML-like). List the items under 'features'. Separate them with commas.")),
            vec![complete(), succeeded("read"), oc_all(&["beta_mode", "new_ui", "fast_search"])]),
            vec![p])
    }
    v.push(scen!("read_yaml_list", Category::Read, Difficulty::Hard, R, s10));
}

// ────────────────────────────────────────────────────────────────────────
// WRITE — 10 scenarios: file creation
// ────────────────────────────────────────────────────────────────────────

fn write_scenarios(v: &mut Vec<ScenarioSpec>) {
    use AgentRole::Implement as I;

    fn s1(dir: &Path) -> SetupResult {
        let p = ap(dir, "greet.txt");
        with_checks(pf(format!(
            "Create a new file at {p} with the exact content: Hello, World!")),
            vec![complete(), used_any(&["write", "shell"]), file_has("greet.txt", &["Hello, World!"])])
    }
    v.push(scen!("write_hello_world", Category::Write, Difficulty::Easy, I, s1));

    fn s2(dir: &Path) -> SetupResult {
        let p = ap(dir, "nums.txt");
        with_checks(pf(format!(
            "Create a new file at {p} containing the numbers 1 through 5, one per line.")),
            vec![complete(), used_any(&["write", "shell"]), file_has("nums.txt", &["1\n2", "2\n3", "3\n4", "4\n5"])])
    }
    v.push(scen!("write_numbers_list", Category::Write, Difficulty::Easy, I, s2));

    fn s3(dir: &Path) -> SetupResult {
        let p = ap(dir, "config.json");
        with_checks(pf(format!(
            "Write a JSON file to {p} with exactly two fields: name set to 'cotect' and version set to '1.0.0'. Use the write tool to create the file.")),
            vec![complete(), used_any(&["write", "shell"]), file_has("config.json", &["cotect", "1.0.0"])])
    }
    v.push(scen!("write_small_json", Category::Write, Difficulty::Easy, I, s3));

    fn s4(dir: &Path) -> SetupResult {
        let p = ap(dir, "script.sh");
        with_checks(pf(format!(
            "Create a bash script at {p} that echoes 'ready'. Include a proper shebang line.")),
            vec![complete(), used_any(&["write", "shell"]), file_has("script.sh", &["#!", "bash", "ready"])])
    }
    v.push(scen!("write_bash_script", Category::Write, Difficulty::Easy, I, s4));

    fn s5(dir: &Path) -> SetupResult {
        let p = ap(dir, "add.py");
        with_checks(pf(format!(
            "Create a Python file at {p} that defines a function called add(a, b) returning a + b.")),
            vec![complete(), used_any(&["write", "shell"]), file_has("add.py", &["def add", "return"])])
    }
    v.push(scen!("write_python_fn", Category::Write, Difficulty::Easy, I, s5));

    fn s6(dir: &Path) -> SetupResult {
        let p = ap(dir, "Todo.md");
        with_checks(pf(format!(
            "Create a Markdown todo list at {p} with exactly three tasks: 'Buy groceries', 'Clean house', 'Write blog post'. Use checkbox syntax (- [ ]).")),
            vec![complete(), used_any(&["write", "shell"]), file_has("Todo.md", &["Buy groceries", "Clean house", "Write blog post", "- [ ]"])])
    }
    v.push(scen!("write_markdown_todo", Category::Write, Difficulty::Medium, I, s6));

    fn s7(dir: &Path) -> SetupResult {
        let p = ap(dir, "users.csv");
        with_checks(pf(format!(
            "Create a CSV file at {p} with header 'name,age,city' and exactly 2 data rows: Alice,30,Paris and Bob,25,Rome.")),
            vec![complete(), used_any(&["write", "shell"]), file_has("users.csv", &["name,age,city", "Alice,30,Paris", "Bob,25,Rome"])])
    }
    v.push(scen!("write_csv_with_header", Category::Write, Difficulty::Medium, I, s7));

    fn s8(dir: &Path) -> SetupResult {
        let p = ap(dir, "nested/deep/file.txt");
        with_checks(pf(format!(
            "Create a file at {p} with content 'deeply nested'. The parent directories do not exist yet.")),
            vec![complete(), used_any(&["write", "shell"]), file_has("nested/deep/file.txt", &["deeply nested"])])
    }
    v.push(scen!("write_nested_dirs", Category::Write, Difficulty::Medium, I, s8));

    fn s9(dir: &Path) -> SetupResult {
        let p = ap(dir, "fizzbuzz.py");
        with_checks(pf(format!(
            "Create a Python file at {p} that defines a function fizzbuzz(n) that returns 'Fizz' if n is divisible by 3, 'Buzz' if by 5, 'FizzBuzz' if by both, and str(n) otherwise.")),
            vec![complete(), used_any(&["write", "shell"]), file_has("fizzbuzz.py", &["def fizzbuzz", "Fizz", "Buzz"])])
    }
    v.push(scen!("write_fizzbuzz_py", Category::Write, Difficulty::Medium, I, s9));

    fn s10(dir: &Path) -> SetupResult {
        let p = ap(dir, "server.ts");
        with_checks(pf(format!(
            "Create a TypeScript file at {p} that exports a class called HttpServer with a start(port: number) method that logs 'Listening on ' concatenated with the port. Include proper types.")),
            vec![complete(), used_any(&["write", "shell"]), file_has("server.ts", &["class HttpServer", "start", "port", "number", "Listening on"])])
    }
    v.push(scen!("write_typescript_class", Category::Write, Difficulty::Hard, I, s10));
}

// Stub categories — will be filled in below
fn patch_scenarios(v: &mut Vec<ScenarioSpec>) {
    use AgentRole::Implement as I;

    fn s1(dir: &Path) -> SetupResult {
        let p = ap(dir, "version.txt");
        std::fs::write(&p, "version: 1.0.0\nname: old-name\n").unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, change 'old-name' to 'new-name'.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("version.txt", &["new-name"]), file_lacks("version.txt", &["old-name"])]),
            vec![p])
    }
    v.push(scen!("patch_rename_value", Category::Patch, Difficulty::Easy, I, s1));

    fn s2(dir: &Path) -> SetupResult {
        let p = ap(dir, "config.json");
        std::fs::write(&p, r#"{"version": "1.0.0", "name": "app"}"#).unwrap();
        with_scope(with_checks(pf(format!(
            "In the JSON file {p}, change the version from 1.0.0 to 2.0.0.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("config.json", &["2.0.0"]), file_lacks("config.json", &["1.0.0"])]),
            vec![p])
    }
    v.push(scen!("patch_bump_version", Category::Patch, Difficulty::Easy, I, s2));

    fn s3(dir: &Path) -> SetupResult {
        let p = ap(dir, "greeting.py");
        std::fs::write(&p, "def greet():\n    return 'Hello'\n").unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, change the return value from 'Hello' to 'Goodbye'.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("greeting.py", &["Goodbye"]), file_lacks("greeting.py", &["'Hello'"])]),
            vec![p])
    }
    v.push(scen!("patch_function_return", Category::Patch, Difficulty::Easy, I, s3));

    fn s4(dir: &Path) -> SetupResult {
        let p = ap(dir, "math.py");
        std::fs::write(&p, "def multiply(a, b):\n    return a + b  # BUG: should multiply\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Fix the bug in {p}: the multiply function uses + instead of *.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("math.py", &["a * b"])]),
            vec![p])
    }
    v.push(scen!("patch_fix_operator", Category::Patch, Difficulty::Easy, I, s4));

    fn s5(dir: &Path) -> SetupResult {
        let p = ap(dir, "app.ts");
        std::fs::write(&p, "const PORT = 3000;\nconst HOST = 'localhost';\nconsole.log(`Listening on ${HOST}:${PORT}`);\n").unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, change the PORT from 3000 to 8080.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("app.ts", &["8080"]), file_lacks("app.ts", &["3000"])]),
            vec![p])
    }
    v.push(scen!("patch_change_port", Category::Patch, Difficulty::Easy, I, s5));

    fn s6(dir: &Path) -> SetupResult {
        let p = ap(dir, "handlers.js");
        std::fs::write(&p, "function handle(req, res) {\n  console.log('request');\n  res.send('ok');\n}\n").unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, remove the console.log line. Keep the rest intact.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("handlers.js", &["res.send", "function handle"]), file_lacks("handlers.js", &["console.log"])]),
            vec![p])
    }
    v.push(scen!("patch_delete_line", Category::Patch, Difficulty::Medium, I, s6));

    fn s7(dir: &Path) -> SetupResult {
        let p = ap(dir, "user.go");
        std::fs::write(&p, "package main\n\ntype User struct {\n    Name string\n    Age  int\n}\n\nfunc main() {\n    u := User{Name: \"alice\", Age: 30}\n    _ = u\n}\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Add an Email field (string) to the User struct in {p}. Keep Name and Age fields intact.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("user.go", &["Email string", "Name", "Age"])]),
            vec![p])
    }
    v.push(scen!("patch_add_struct_field", Category::Patch, Difficulty::Medium, I, s7));

    fn s8(dir: &Path) -> SetupResult {
        let p = ap(dir, "routes.py");
        std::fs::write(&p, "routes = {\n    '/home': home_view,\n    '/about': about_view,\n    '/contact': contact_view,\n}\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Add a new route '/login' mapped to login_view in {p}. Preserve the existing routes.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("routes.py", &["'/login'", "login_view", "'/home'", "'/about'", "'/contact'"])]),
            vec![p])
    }
    v.push(scen!("patch_add_dict_entry", Category::Patch, Difficulty::Medium, I, s8));

    fn s9(dir: &Path) -> SetupResult {
        let p = ap(dir, "conf.toml");
        std::fs::write(&p, "[server]\nhost = \"0.0.0.0\"\nport = 8000\ntimeout = 30\n\n[database]\nurl = \"sqlite://db.sqlite\"\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Change the timeout in {p} from 30 to 120. Keep all other values unchanged.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("conf.toml", &["timeout = 120", "port = 8000"]), file_lacks("conf.toml", &["timeout = 30"])]),
            vec![p])
    }
    v.push(scen!("patch_toml_value", Category::Patch, Difficulty::Medium, I, s9));

    fn s10(dir: &Path) -> SetupResult {
        let p = ap(dir, "api.rs");
        std::fs::write(&p, "pub fn get_user(id: u32) -> Option<User> {\n    database.fetch(id)\n}\n\npub fn delete_user(id: u32) -> Result<(), Error> {\n    database.remove(id)\n}\n").unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, rename get_user to fetch_user (the function signature and definition). Keep delete_user unchanged.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("api.rs", &["fn fetch_user", "fn delete_user"]), file_lacks("api.rs", &["fn get_user"])]),
            vec![p])
    }
    v.push(scen!("patch_rename_function", Category::Patch, Difficulty::Hard, I, s10));
}

fn search_scenarios(v: &mut Vec<ScenarioSpec>) {
    use AgentRole::Research as R;

    fn s1(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("a.rs"), "fn helper_one() {}\nfn helper_two() {}\n").unwrap();
        std::fs::write(dir.join("b.rs"), "fn helper_three() {}\nfn unrelated() {}\n").unwrap();
        std::fs::write(dir.join("c.rs"), "fn nothing_here() {}\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search for all functions starting with 'helper_' in {d}. List each one you find.")),
            vec![complete(), succeeded("fs_search"), oc_all(&["helper_one", "helper_two", "helper_three"])])
    }
    v.push(scen!("search_prefix_functions", Category::Search, Difficulty::Easy, R, s1));

    fn s2(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("main.py"), "# TODO: implement main\ndef main(): pass\n").unwrap();
        std::fs::write(dir.join("utils.py"), "def util():\n    # TODO: add validation\n    return 1\n").unwrap();
        std::fs::write(dir.join("done.py"), "# all good here\ndef x(): return 2\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Find all lines containing 'TODO' in files under {d}. How many TODO comments are there in total? State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("fs_search"), num(2)])
    }
    v.push(scen!("search_todo_count", Category::Search, Difficulty::Easy, R, s2));

    fn s3(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("prod.js"), "const API_KEY = 'sk-prod-abc123';\n").unwrap();
        std::fs::write(dir.join("test.js"), "const TEST_VAL = 42;\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} for 'API_KEY'. Tell me the value found.")),
            vec![complete(), succeeded("fs_search"), oc("sk-prod-abc123")])
    }
    v.push(scen!("search_secret_value", Category::Search, Difficulty::Easy, R, s3));

    fn s4(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("pkg.json"), r#"{"name": "myapp", "version": "0.1.0"}"#).unwrap();
        std::fs::write(dir.join("README.md"), "# myapp\nVersion: 0.1.0\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "In how many files under {d} does the string '0.1.0' appear? State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("fs_search"), num(2)])
    }
    v.push(scen!("search_version_files", Category::Search, Difficulty::Medium, R, s4));

    fn s5(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("red.txt"), "color: red\n").unwrap();
        std::fs::write(dir.join("blue.txt"), "color: blue\n").unwrap();
        std::fs::write(dir.join("green.txt"), "color: green\n").unwrap();
        std::fs::write(dir.join("shape.txt"), "circle\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "In {d}, how many files contain the word 'color'? State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("fs_search"), num(3)])
    }
    v.push(scen!("search_word_fileount", Category::Search, Difficulty::Medium, R, s5));

    fn s6(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("a.py"), "import os\nimport sys\nfrom json import dumps\n").unwrap();
        std::fs::write(dir.join("b.py"), "import os\nfrom typing import List\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} Python files for import statements. Which module is imported in both files? State the module name clearly.")),
            vec![complete(), succeeded("fs_search"), oc("os")])
    }
    v.push(scen!("search_common_import", Category::Search, Difficulty::Medium, R, s6));

    fn s7(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("err1.log"), "ERROR: connection refused\n").unwrap();
        std::fs::write(dir.join("warn1.log"), "WARN: slow query\n").unwrap();
        std::fs::write(dir.join("err2.log"), "ERROR: timeout\nERROR: disconnected\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} for lines starting with 'ERROR:'. How many such lines are there in total? State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("fs_search"), num(3)])
    }
    v.push(scen!("search_error_lines", Category::Search, Difficulty::Medium, R, s7));

    fn s8(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("a.ts"), "export function getUser(id: string) {}\nexport function deleteUser(id: string) {}\n").unwrap();
        std::fs::write(dir.join("b.ts"), "function internalHelper() {}\nexport function createUser(data: any) {}\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} for all 'export function' declarations. How many are there? State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("fs_search"), num(3)])
    }
    v.push(scen!("search_exports", Category::Search, Difficulty::Medium, R, s8));

    fn s9(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("alpha.txt"), "key_a = first\n").unwrap();
        std::fs::write(dir.join("beta.txt"), "key_b = second\n").unwrap();
        std::fs::write(dir.join("gamma.txt"), "key_c = third\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} for keys matching the pattern 'key_[a-c]'. List them in alphabetical order, separated by commas.")),
            vec![complete(), succeeded("fs_search"), oc_all(&["key_a", "key_b", "key_c"])])
    }
    v.push(scen!("search_regex_keys", Category::Search, Difficulty::Hard, R, s9));

    fn s10(dir: &Path) -> SetupResult {
        std::fs::create_dir_all(dir.join("src")).ok();
        std::fs::create_dir_all(dir.join("tests")).ok();
        std::fs::write(dir.join("src/main.rs"), "fn main() {}\n#[test]\nfn test_a() {}\n").unwrap();
        std::fs::write(dir.join("tests/int.rs"), "#[test]\nfn test_b() {}\n#[test]\nfn test_c() {}\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} for all '#[test]' attributes. How many test functions are defined? State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("fs_search"), num(3)])
    }
    v.push(scen!("search_test_attrs", Category::Search, Difficulty::Hard, R, s10));
}

fn shell_scenarios(v: &mut Vec<ScenarioSpec>) {
    use AgentRole::Implement as I;

    fn s1(_: &Path) -> SetupResult {
        with_checks(pf("Run 'uname -s' and tell me what operating system kernel this is."),
            vec![complete(), succeeded("shell"), oc_any(&["Linux", "Darwin"])])
    }
    v.push(scen!("shell_uname", Category::Shell, Difficulty::Easy, I, s1));

    fn s2(_: &Path) -> SetupResult {
        with_checks(pf("Run 'echo hello world' and tell me exactly what it printed."),
            vec![complete(), succeeded("shell"), oc("hello world")])
    }
    v.push(scen!("shell_echo", Category::Shell, Difficulty::Easy, I, s2));

    fn s3(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("x.txt"), "alpha\nbeta\ngamma\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Run 'wc -l {d}/x.txt' and tell me how many lines the file has. State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("shell"), num(3)])
    }
    v.push(scen!("shell_wc_lines", Category::Shell, Difficulty::Easy, I, s3));

    fn s4(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("data.txt"), "zebra\napple\nmango\nbanana\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Sort the contents of {d}/data.txt alphabetically and tell me the first line (use the shell tool with sort).")),
            vec![complete(), succeeded("shell"), oc("apple")])
    }
    v.push(scen!("shell_sort_first", Category::Shell, Difficulty::Easy, I, s4));

    fn s5(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("a.txt"), "").unwrap();
        std::fs::write(dir.join("b.txt"), "").unwrap();
        std::fs::write(dir.join("c.txt"), "").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Use 'ls -1 {d}' to list the files and tell me how many .txt files are there. State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("shell"), num(3)])
    }
    v.push(scen!("shell_ls_count", Category::Shell, Difficulty::Medium, I, s5));

    fn s6(_: &Path) -> SetupResult {
        with_checks(pf("Use a shell command to compute 123 * 456 and tell me the result. State your final answer as the last number in your reply."),
            vec![complete(), succeeded("shell"), num(56088)])
    }
    v.push(scen!("shell_arithmetic", Category::Shell, Difficulty::Medium, I, s6));

    fn s7(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("fruits.txt"), "apple\napple\nbanana\napple\nbanana\ncherry\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Use a shell command to count how many times 'apple' appears in {d}/fruits.txt. State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("shell"), num(3)])
    }
    v.push(scen!("shell_grep_count", Category::Shell, Difficulty::Medium, I, s7));

    fn s8(_: &Path) -> SetupResult {
        with_checks(pf("Use 'date +%Y' to tell me the current year. State the year clearly as a 4-digit number."),
            vec![complete(), succeeded("shell"), oc_any(&["2024", "2025", "2026", "2027"])])
    }
    v.push(scen!("shell_current_year", Category::Shell, Difficulty::Medium, I, s8));

    fn s9(dir: &Path) -> SetupResult {
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Use shell commands to create a file at {d}/created.txt with content 'shell-made', then verify using cat. Tell me what's in the file.")),
            vec![complete(), succeeded("shell"), oc("shell-made"), file_has("created.txt", &["shell-made"])])
    }
    v.push(scen!("shell_create_and_verify", Category::Shell, Difficulty::Hard, I, s9));

    fn s10(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("nums.txt"), "10\n20\n30\n40\n50\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Use shell commands (awk, paste, bc, or similar) to sum the numbers in {d}/nums.txt. State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("shell"), num(150)])
    }
    v.push(scen!("shell_sum_numbers", Category::Shell, Difficulty::Hard, I, s10));
}

fn workflow_scenarios(v: &mut Vec<ScenarioSpec>) {
    use AgentRole::Implement as I;

    fn s1(dir: &Path) -> SetupResult {
        let p = ap(dir, "calc.py");
        std::fs::write(&p, "def add(a, b):\n    return a + b\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}, then add a new function subtract(a, b) that returns a - b below the add function.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("calc.py", &["def subtract", "a - b", "def add"])]),
            vec![p])
    }
    v.push(scen!("workflow_read_add_function", Category::Workflow, Difficulty::Easy, I, s1));

    fn s2(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("a.rs"), "fn old_api() {}\n").unwrap();
        std::fs::write(dir.join("b.rs"), "fn use_old_api() { old_api(); }\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} for 'old_api'. Then read each file that contains it. Tell me how many files contain the term 'old_api'. State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("fs_search"), succeeded("read"), num(2)])
    }
    v.push(scen!("workflow_search_then_read", Category::Workflow, Difficulty::Easy, I, s2));

    fn s3(dir: &Path) -> SetupResult {
        let p = ap(dir, "config.json");
        std::fs::write(&p, r#"{"debug": false, "port": 3000}"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}, then set debug to true (keep other fields).")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("config.json", &["\"debug\": true", "3000"])]),
            vec![p])
    }
    v.push(scen!("workflow_read_edit_json", Category::Workflow, Difficulty::Easy, I, s3));

    fn s4(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("main.py"), "def main():\n    print('start')\n    foo()\n\ndef foo():\n    print('foo')\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} for 'def foo'. Read the file and tell me what the foo function prints. State the printed string clearly.")),
            vec![complete(), succeeded("fs_search"), succeeded("read"), oc("foo")])
    }
    v.push(scen!("workflow_search_read_explain", Category::Workflow, Difficulty::Medium, I, s4));

    fn s5(dir: &Path) -> SetupResult {
        let p = ap(dir, "greet.ts");
        std::fs::write(&p, "export function greet(name: string) {\n  return 'Hi ' + name;\n}\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}, then change the greeting from 'Hi ' to 'Hello '.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("greet.ts", &["Hello "]), file_lacks("greet.ts", &["'Hi '"])]),
            vec![p])
    }
    v.push(scen!("workflow_read_patch_ts", Category::Workflow, Difficulty::Medium, I, s5));

    fn s6(dir: &Path) -> SetupResult {
        let p = ap(dir, "sum.py");
        std::fs::write(&p, "def sum_list(nums):\n    total = 0\n    for n in nums:\n        total += n\n    return total\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}, then add a docstring to sum_list explaining it returns the sum of a list of numbers.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("sum.py", &["def sum_list", "\"\"\""])]),
            vec![p])
    }
    v.push(scen!("workflow_add_docstring", Category::Workflow, Difficulty::Medium, I, s6));

    fn s7(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("v1.txt"), "version: 1.0\n").unwrap();
        std::fs::write(dir.join("v2.txt"), "version: 1.0\n").unwrap();
        std::fs::write(dir.join("v3.txt"), "version: 1.0\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Find all files under {d} containing 'version: 1.0'. Update each file to say 'version: 2.0' instead.")),
            vec![complete(), used_any(&["fs_search", "shell"]), file_has("v1.txt", &["version: 2.0"]), file_has("v2.txt", &["version: 2.0"]), file_has("v3.txt", &["version: 2.0"]), file_lacks("v1.txt", &["version: 1.0"]), file_lacks("v2.txt", &["version: 1.0"]), file_lacks("v3.txt", &["version: 1.0"])])
    }
    v.push(scen!("workflow_bulk_update", Category::Workflow, Difficulty::Hard, I, s7));

    fn s8(dir: &Path) -> SetupResult {
        let p = ap(dir, "server.py");
        std::fs::write(&p, "def start(port):\n    print(f'running on port {port}')\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. Add a parameter 'host' (defaulting to 'localhost') to the start function, before port. Also update the print to include the host.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("server.py", &["def start(host", "port", "localhost"])]),
            vec![p])
    }
    v.push(scen!("workflow_add_parameter", Category::Workflow, Difficulty::Hard, I, s8));

    fn s9(dir: &Path) -> SetupResult {
        let p = ap(dir, "app.rs");
        std::fs::write(&p, "pub struct App { name: String }\n\nimpl App {\n    pub fn new(name: String) -> Self { App { name } }\n}\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} and add a new method `name(&self) -> &str` that returns `&self.name` in the impl block. Keep the existing `new` method.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("app.rs", &["pub fn name", "&self", "&self.name", "pub fn new"])]),
            vec![p])
    }
    v.push(scen!("workflow_add_method", Category::Workflow, Difficulty::Hard, I, s9));

    fn s10(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("math.py"), "def add(a, b): return a + b\ndef sub(a, b): return a - b\n").unwrap();
        std::fs::write(dir.join("main.py"), "from math import add\nprint(add(2, 3))\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "In {d}, find all files that import from 'math'. Then in main.py, also import 'sub' alongside 'add' (keep add).")),
            vec![complete(), file_has("main.py", &["from math import", "add", "sub"])])
    }
    v.push(scen!("workflow_multi_file_import", Category::Workflow, Difficulty::Hard, I, s10));
}

fn recovery_scenarios(v: &mut Vec<ScenarioSpec>) {
    use AgentRole::Implement as I;

    fn s1(dir: &Path) -> SetupResult {
        // Have model attempt patch without reading first — it should read then retry
        let p = ap(dir, "text.txt");
        std::fs::write(&p, "original text here\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Change 'original' to 'updated' in {p}. You may need to read the file first.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("text.txt", &["updated text here"])]),
            vec![p])
    }
    v.push(scen!("recovery_read_first", Category::Recovery, Difficulty::Easy, I, s1));

    fn s2(dir: &Path) -> SetupResult {
        // Wrong filename hint in prompt — model must recover
        let p = ap(dir, "correct.txt");
        std::fs::write(&p, "data here\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Read the file at {d}/wrong.txt. If it doesn't exist, look for a similar file in {d} and read that instead, then tell me its contents.")),
            vec![complete(), used_any(&["read", "fs_search", "shell"]), oc("data here")])
    }
    v.push(scen!("recovery_wrong_path", Category::Recovery, Difficulty::Medium, I, s2));

    fn s3(dir: &Path) -> SetupResult {
        // File doesn't exist at all — must report that
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Try to read the file {d}/nonexistent.txt. If it doesn't exist, tell me so. Reply with either the content or 'does not exist'.")),
            vec![complete(), oc_any(&["does not exist", "not found", "No such", "nonexistent"])])
    }
    v.push(scen!("recovery_missing_file", Category::Recovery, Difficulty::Medium, I, s3));

    fn s4(dir: &Path) -> SetupResult {
        // Need to patch something that appears multiple times — first attempt will fail.
        // The patch tool requires a unique match, so the model must include surrounding
        // context (e.g. old_string="bar\nfoo\nbaz") to target just the middle occurrence.
        let p = ap(dir, "multi.txt");
        std::fs::write(&p, "foo\nbar\nfoo\nbaz\nfoo\n").unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, change only the second occurrence of 'foo' (the one between 'bar' and 'baz') to 'FOO'. Keep the first and third occurrences as 'foo'. \
             HINT: the `patch` tool requires the old_string to match exactly once — include surrounding lines as context.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("multi.txt", &["foo\nbar\nFOO\nbaz\nfoo"])]),
            vec![p])
    }
    v.push(scen!("recovery_ambiguous_patch", Category::Recovery, Difficulty::Hard, I, s4));

    fn s5(dir: &Path) -> SetupResult {
        // Empty directory — model must handle the no-results case
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} for any files containing 'MAGIC_UNLIKELY_STRING_ZZ'. If none found, tell me so. Reply with either the location(s) or 'no matches found'.")),
            vec![complete(), used_any(&["fs_search", "shell"]), oc_any(&["no matches", "not found", "no results", "No matches", "none", "0 matches"])])
    }
    v.push(scen!("recovery_no_results", Category::Recovery, Difficulty::Medium, I, s5));

    fn s6(dir: &Path) -> SetupResult {
        // Model expected to handle a patch failure by switching to write
        let p = ap(dir, "tricky.py");
        std::fs::write(&p, "x = 1\nx = 1\nx = 1\n").unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, change exactly the first occurrence of 'x = 1' to 'x = 2' (leave others as 'x = 1').")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("tricky.py", &["x = 2"]), file_has("tricky.py", &["x = 1"])]),
            vec![p])
    }
    v.push(scen!("recovery_first_occurrence", Category::Recovery, Difficulty::Hard, I, s6));

    fn s7(dir: &Path) -> SetupResult {
        // Invalid initial search — model should broaden
        std::fs::write(dir.join("greet.py"), "def say_hi(): return 'hi'\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} for a function named 'hello'. If not found, broaden your search to any greeting-related function and tell me what you found.")),
            vec![complete(), used_any(&["fs_search", "read"]), oc_any(&["say_hi", "hi"])])
    }
    v.push(scen!("recovery_broaden_search", Category::Recovery, Difficulty::Hard, I, s7));

    fn s8(_dir: &Path) -> SetupResult {
        with_checks(pf("Run 'false' (the Unix command). The command will exit with a non-zero status. Tell me what the exit code was (it's not 0)."),
            vec![complete(), used_any(&["shell"]), oc_any(&["1", "non-zero", "failed", "error", "false"])])
    }
    v.push(scen!("recovery_shell_failure", Category::Recovery, Difficulty::Medium, I, s8));

    fn s9(dir: &Path) -> SetupResult {
        // Ambiguous patch — needs unique surrounding context
        let p = ap(dir, "code.js");
        std::fs::write(&p, "function a() {\n  return 1;\n}\nfunction b() {\n  return 1;\n}\n").unwrap();
        with_scope(with_checks(pf(format!(
            "In {p}, change only the return value of function `a` from 1 to 99. Leave function `b` returning 1.")),
            vec![complete(), used_any(&["patch", "write", "shell"]), file_has("code.js", &["return 99", "return 1"])]),
            vec![p])
    }
    v.push(scen!("recovery_context_needed", Category::Recovery, Difficulty::Hard, I, s9));

    fn s10(dir: &Path) -> SetupResult {
        // Must recover from an initial wrong assumption
        let p = ap(dir, "data.csv");
        std::fs::write(&p, "a,b,c\n1,2,3\n4,5,6\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. Assume it's TSV at first, but if that doesn't parse well, try CSV. The first line is a header row. Tell me the value in the second DATA row (ignoring the header), column named 'b'. State your final answer as the last number in your reply.")),
            vec![complete(), used_any(&["read", "shell"]), num(5)]),
            vec![p])
    }
    v.push(scen!("recovery_reassess_format", Category::Recovery, Difficulty::Hard, I, s10));
}

fn understanding_scenarios(v: &mut Vec<ScenarioSpec>) {
    use AgentRole::Research as R;

    fn s1(dir: &Path) -> SetupResult {
        let p = ap(dir, "f.py");
        std::fs::write(&p, "def f(x):\n    if x < 0:\n        return -x\n    return x\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} and tell me in one word what mathematical operation this function implements.")),
            vec![complete(), succeeded("read"), oc_any(&["absolute value", "absolute", "abs"])]),
            vec![p])
    }
    v.push(scen!("understand_abs_function", Category::Understanding, Difficulty::Easy, R, s1));

    fn s2(dir: &Path) -> SetupResult {
        let p = ap(dir, "f.py");
        std::fs::write(&p, "def mystery(xs):\n    result = []\n    for x in xs:\n        if x not in result:\n            result.append(x)\n    return result\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. What does the mystery function do? Reply in one short phrase.")),
            vec![complete(), succeeded("read"), oc_any(&["dedup", "unique", "duplicate", "distinct"])]),
            vec![p])
    }
    v.push(scen!("understand_dedup", Category::Understanding, Difficulty::Easy, R, s2));

    fn s3(dir: &Path) -> SetupResult {
        let p = ap(dir, "bug.py");
        std::fs::write(&p, "def factorial(n):\n    if n == 0:\n        return 1\n    return n * factorial(n)\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. There is a bug in this function. Describe the bug in one short sentence.")),
            vec![complete(), succeeded("read"), oc_any(&["n - 1", "n-1", "infinite", "recursion", "never decrements", "should call factorial(n - 1)", "minus 1"])]),
            vec![p])
    }
    v.push(scen!("understand_factorial_bug", Category::Understanding, Difficulty::Medium, R, s3));

    fn s4(dir: &Path) -> SetupResult {
        let p = ap(dir, "code.ts");
        std::fs::write(&p, "function foo(n: number): number {\n  let r = 0;\n  for (let i = 1; i <= n; i++) { r += i; }\n  return r;\n}\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. If called with n=10, what value does foo return? State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("read"), num(55)]),
            vec![p])
    }
    v.push(scen!("understand_sum_1_to_n", Category::Understanding, Difficulty::Medium, R, s4));

    fn s5(dir: &Path) -> SetupResult {
        let p = ap(dir, "algo.rs");
        std::fs::write(&p, "fn mystery(arr: &[i32], target: i32) -> Option<usize> {\n    let mut lo = 0;\n    let mut hi = arr.len();\n    while lo < hi {\n        let mid = (lo + hi) / 2;\n        if arr[mid] == target { return Some(mid); }\n        if arr[mid] < target { lo = mid + 1; } else { hi = mid; }\n    }\n    None\n}\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. What algorithm does this implement? Reply in 1-3 words.")),
            vec![complete(), succeeded("read"), oc_any(&["binary search", "bsearch"])]),
            vec![p])
    }
    v.push(scen!("understand_binary_search", Category::Understanding, Difficulty::Medium, R, s5));

    fn s6(dir: &Path) -> SetupResult {
        let p = ap(dir, "perf.py");
        std::fs::write(&p, "def find_dups(arr):\n    dups = []\n    for i in range(len(arr)):\n        for j in range(len(arr)):\n            if i != j and arr[i] == arr[j]:\n                dups.append(arr[i])\n    return dups\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. What is the time complexity of find_dups? Reply in big-O notation like O(n), O(n^2), etc.")),
            vec![complete(), succeeded("read"), oc_any(&["O(n^2)", "O(n²)", "O(n*n)", "quadratic"])]),
            vec![p])
    }
    v.push(scen!("understand_complexity", Category::Understanding, Difficulty::Medium, R, s6));

    fn s7(dir: &Path) -> SetupResult {
        let p = ap(dir, "security.py");
        std::fs::write(&p, "def query_user(conn, username):\n    q = f\"SELECT * FROM users WHERE name = '{username}'\"\n    return conn.execute(q)\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. Identify the security vulnerability. Reply with the vulnerability name only (e.g. 'XSS', 'SQL injection', 'CSRF').")),
            vec![complete(), succeeded("read"), oc_any(&["sql injection", "sqli"])]),
            vec![p])
    }
    v.push(scen!("understand_sqli", Category::Understanding, Difficulty::Hard, R, s7));

    fn s8(dir: &Path) -> SetupResult {
        let p = ap(dir, "concurrent.go");
        std::fs::write(&p, "func race() int {\n    var counter int\n    for i := 0; i < 10; i++ {\n        go func() { counter++ }()\n    }\n    time.Sleep(time.Second)\n    return counter\n}\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. What concurrency bug does this code have? Reply in 2-4 words.")),
            vec![complete(), succeeded("read"), oc_any(&["race condition", "data race"])]),
            vec![p])
    }
    v.push(scen!("understand_race_condition", Category::Understanding, Difficulty::Hard, R, s8));

    fn s9(dir: &Path) -> SetupResult {
        let p = ap(dir, "recursion.py");
        std::fs::write(&p, "def f(n):\n    if n <= 1: return n\n    return f(n-1) + f(n-2)\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. What well-known mathematical sequence does f compute? Reply with the sequence name only.")),
            vec![complete(), succeeded("read"), oc("fibonacci")]),
            vec![p])
    }
    v.push(scen!("understand_fibonacci", Category::Understanding, Difficulty::Easy, R, s9));

    fn s10(dir: &Path) -> SetupResult {
        let p = ap(dir, "tricky.py");
        std::fs::write(&p, "def process(items):\n    cache = {}\n    for item in items:\n        if item in cache:\n            cache[item] += 1\n        else:\n            cache[item] = 1\n    return [k for k, v in cache.items() if v > 1]\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. In a single short phrase, what does process([1,2,2,3,4,4,4]) return?")),
            vec![complete(), succeeded("read"), oc_any(&["[2, 4]", "2, 4", "2 and 4", "duplicates"])]),
            vec![p])
    }
    v.push(scen!("understand_dup_filter", Category::Understanding, Difficulty::Hard, R, s10));
}

fn planning_scenarios(v: &mut Vec<ScenarioSpec>) {
    use AgentRole::Plan as P;

    fn s1(_: &Path) -> SetupResult {
        with_checks(pf("Create a plan with numbered steps for adding user authentication to a REST API. Use at least 3 steps."),
            vec![complete(), oc_all(&["1.", "2.", "3."]), oc_any(&["auth", "login", "token", "password"])])
    }
    v.push(scen!("plan_auth_api", Category::Planning, Difficulty::Easy, P, s1));

    fn s2(_: &Path) -> SetupResult {
        with_checks(pf("Create a plan with numbered steps for adding a dark mode toggle to a web application. Use at least 3 steps."),
            vec![complete(), oc_all(&["1.", "2.", "3."]), oc_any(&["theme", "dark", "toggle", "css"])])
    }
    v.push(scen!("plan_dark_mode", Category::Planning, Difficulty::Easy, P, s2));

    fn s3(_: &Path) -> SetupResult {
        with_checks(pf("Create a numbered plan for migrating a SQLite database to PostgreSQL. Include at least 4 steps."),
            vec![complete(), oc_all(&["1.", "2.", "3.", "4."]), oc_any(&["postgres", "migration", "schema", "export", "import"])])
    }
    v.push(scen!("plan_db_migration", Category::Planning, Difficulty::Medium, P, s3));

    fn s4(_: &Path) -> SetupResult {
        with_checks(pf("Create a numbered plan for adding rate limiting to an API. Include at least 4 steps and mention specific libraries or techniques."),
            vec![complete(), oc_all(&["1.", "2.", "3.", "4."]), oc_any(&["rate limit", "throttle", "middleware", "redis", "token bucket"])])
    }
    v.push(scen!("plan_rate_limiting", Category::Planning, Difficulty::Medium, P, s4));

    fn s5(dir: &Path) -> SetupResult {
        let p = ap(dir, "user.py");
        std::fs::write(&p, "class User:\n    def __init__(self, name):\n        self.name = name\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} and create a numbered plan for adding input validation to the User class (at least 3 steps).")),
            vec![complete(), succeeded("read"), oc_all(&["1.", "2.", "3."]), oc_any(&["validation", "validate", "name"])]),
            vec![p])
    }
    v.push(scen!("plan_add_validation", Category::Planning, Difficulty::Medium, P, s5));

    fn s6(dir: &Path) -> SetupResult {
        let p = ap(dir, "app.ts");
        std::fs::write(&p, "export function main() {\n  console.log('hello');\n}\n").unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} and produce a numbered plan for adding error handling. At least 3 steps; reference the file.")),
            vec![complete(), succeeded("read"), oc_all(&["1.", "2.", "3."]), oc_any(&["error", "try", "catch", "handle", "app.ts"])]),
            vec![p])
    }
    v.push(scen!("plan_error_handling", Category::Planning, Difficulty::Medium, P, s6));

    fn s7(_: &Path) -> SetupResult {
        with_checks(pf("Create a numbered plan with at least 5 steps for setting up a CI/CD pipeline on GitHub Actions for a Node.js project. \
            Cover linting, testing, building, deploying, and any additional steps you consider important (e.g. caching, notifications, environment config). \
            Number each step (1., 2., etc.)."),
            vec![complete(), oc_all(&["1.", "2.", "3.", "4.", "5."]), oc_any(&["github action", "workflow", "lint", "test", "deploy"])])
    }
    v.push(scen!("plan_ci_cd", Category::Planning, Difficulty::Hard, P, s7));

    fn s8(_: &Path) -> SetupResult {
        with_checks(pf("Create a numbered plan for refactoring a monolithic 1000-line file into modules. \
            List at least 5 concrete steps, numbered 1. through 5. (or more). \
            Consider: analyzing dependencies, identifying boundaries, extracting modules, updating imports, and testing."),
            vec![complete(), oc_all(&["1.", "2.", "3.", "4.", "5."]), oc_any(&["module", "split", "refactor", "extract"])])
    }
    v.push(scen!("plan_refactor_monolith", Category::Planning, Difficulty::Hard, P, s8));

    fn s9(_: &Path) -> SetupResult {
        with_checks(pf("Create a numbered plan for implementing undo/redo in a text editor. Include at least 4 steps."),
            vec![complete(), oc_all(&["1.", "2.", "3.", "4."]), oc_any(&["undo", "redo", "stack", "history", "command"])])
    }
    v.push(scen!("plan_undo_redo", Category::Planning, Difficulty::Hard, P, s9));

    fn s10(dir: &Path) -> SetupResult {
        std::fs::write(dir.join("sync.ts"), "export function sync(a: number, b: number) { return a + b; }\n").unwrap();
        let d = dir.to_string_lossy().into_owned();
        with_checks(pf(format!(
            "Search {d} for exported functions, then create a numbered plan to convert them to async (at least 3 steps, mention any file(s) you find).")),
            vec![complete(), used_any(&["fs_search", "read"]), oc_all(&["1.", "2.", "3."]), oc_any(&["async", "await", "promise"])])
    }
    v.push(scen!("plan_convert_async", Category::Planning, Difficulty::Hard, P, s10));
}
