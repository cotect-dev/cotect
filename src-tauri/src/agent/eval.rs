//! Model evaluation harness.
//!
//! Run with:
//!   COTECT_EVAL_ENDPOINT=http://localhost:11434/v1 \
//!   COTECT_EVAL_MODEL=llama3 \
//!   cargo test -p cotect eval:: -- --nocapture --ignored
//!
//! Or use the helper script:
//!   ./scripts/eval-model.sh --endpoint http://localhost:11434/v1 --model llama3
//!
//! Optional env vars:
//!   COTECT_EVAL_API_KEY   - Bearer token (omit for local Ollama)
//!   COTECT_EVAL_MAX_TURNS - Override max turns per scenario (default: 20)
//!   COTECT_EVAL_TIMEOUT   - Seconds before a scenario times out (default: 120)
//!
//! Each scenario returns a structured `EvalResult` with pass/fail, turn count,
//! tool calls made, and timing. The final summary prints a table suitable for
//! comparing models side-by-side.

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use tokio::sync::mpsc;

    use crate::agent::orch::Orchestrator;
    use crate::agent::types::*;

    // ─── Config from env ─────────────────────────────────────────────────

    struct EvalConfig {
        endpoint: String,
        model: String,
        api_key: Option<String>,
        max_turns: usize,
        timeout: Duration,
    }

    impl EvalConfig {
        fn from_env() -> Option<Self> {
            let endpoint = std::env::var("COTECT_EVAL_ENDPOINT").ok()?;
            let model = std::env::var("COTECT_EVAL_MODEL").ok()?;
            let api_key = std::env::var("COTECT_EVAL_API_KEY").ok();
            let max_turns = std::env::var("COTECT_EVAL_MAX_TURNS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(20);
            let timeout_secs = std::env::var("COTECT_EVAL_TIMEOUT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(120u64);

            Some(Self {
                endpoint,
                model,
                api_key,
                max_turns,
                timeout: Duration::from_secs(timeout_secs),
            })
        }

        fn provider(&self) -> ProviderConfig {
            ProviderConfig {
                id: "eval".into(),
                name: "Eval Provider".into(),
                endpoint: self.endpoint.clone(),
                api_key: self.api_key.clone(),
                model: self.model.clone(),
            }
        }
    }

    // ─── Result collection ───────────────────────────────────────────────

    #[derive(Debug)]
    #[allow(dead_code)]
    struct EvalResult {
        scenario: String,
        passed: bool,
        turns: usize,
        tool_calls: Vec<String>,
        elapsed: Duration,
        error: Option<String>,
        output: String,
    }

    impl std::fmt::Display for EvalResult {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            let status = if self.passed { "PASS" } else { "FAIL" };
            write!(
                f,
                "[{status}] {:<40} {:>5.1}s  {:>2} turns  {:>2} tools",
                self.scenario,
                self.elapsed.as_secs_f64(),
                self.turns,
                self.tool_calls.len(),
            )?;
            if let Some(err) = &self.error {
                write!(f, "  err: {}", &err[..err.len().min(80)])?;
            }
            Ok(())
        }
    }

    // ─── Scenario runner ─────────────────────────────────────────────────

    async fn run_scenario(
        cfg: &EvalConfig,
        name: &str,
        prompt: &str,
        role: AgentRole,
        scope: TaskScope,
        check: impl Fn(&[TaskEvent], &str) -> (bool, String),
    ) -> EvalResult {
        use std::io::Write;

        let (tx, rx) = mpsc::channel::<TaskEvent>(512);

        let request = TaskRequest {
            id: format!("eval-{name}"),
            prompt: prompt.into(),
            scope,
            role,
            conversation_id: None,
        };

        let start = Instant::now();

        // Print scenario header
        eprint!("  {name:<40} ");
        let _ = std::io::stderr().flush();

        // Spawn event collector that prints dots for each LLM response/tool event
        let events_handle = tokio::spawn(async move {
            let mut rx = rx;
            let mut events = Vec::new();
            let mut tool_calls = Vec::new();
            let mut full_text = String::new();

            while let Some(ev) = rx.recv().await {
                match &ev {
                    TaskEvent::Text { content, partial } => {
                        if *partial {
                            // First text delta of a new response — print dot
                            if full_text.is_empty() || content.len() < 10 {
                                eprint!(".");
                                let _ = std::io::stderr().flush();
                            }
                            full_text.push_str(content);
                        } else {
                            full_text = content.clone();
                        }
                    }
                    TaskEvent::Reasoning { .. } => {
                        // Print 'r' for reasoning tokens (first chunk only per turn)
                        eprint!("r");
                        let _ = std::io::stderr().flush();
                    }
                    TaskEvent::ToolStart { tool_name, .. } => {
                        eprint!("T({})", tool_name);
                        let _ = std::io::stderr().flush();
                        tool_calls.push(tool_name.clone());
                    }
                    TaskEvent::ToolEnd { success, .. } => {
                        if *success {
                            eprint!("ok ");
                        } else {
                            eprint!("ERR ");
                        }
                        let _ = std::io::stderr().flush();
                    }
                    TaskEvent::Error { message } => {
                        eprint!("E({}) ", &message[..message.len().min(30)]);
                        let _ = std::io::stderr().flush();
                    }
                    TaskEvent::Complete => {
                        eprint!(" DONE");
                        let _ = std::io::stderr().flush();
                    }
                    TaskEvent::Interrupted { reason } => {
                        eprint!(" INT({})", &reason[..reason.len().min(30)]);
                        let _ = std::io::stderr().flush();
                    }
                    _ => {}  // Followup, etc.
                }
                events.push(ev);
            }
            eprintln!();
            (events, tool_calls, full_text)
        });

        // Run orchestrator with timeout
        let orch_result = tokio::time::timeout(cfg.timeout, async {
            let mut orch = Orchestrator::new(&cfg.provider(), &request, tx);
            orch.run().await
        })
        .await;

        let elapsed = start.elapsed();

        // Wait for event collector to finish (it stops when tx is dropped)
        let (events, tool_calls, full_text) = events_handle.await.unwrap_or_else(|_| {
            (Vec::new(), Vec::new(), String::new())
        });

        let approx_turns = (tool_calls.len() + 1).min(cfg.max_turns);

        match orch_result {
            Ok(Ok(())) => {
                let (passed, detail) = check(&events, &full_text);
                EvalResult {
                    scenario: name.into(),
                    passed,
                    turns: approx_turns,
                    tool_calls,
                    elapsed,
                    error: if passed { None } else { Some(detail) },
                    output: full_text,
                }
            }
            Ok(Err(e)) => EvalResult {
                scenario: name.into(),
                passed: false,
                turns: approx_turns,
                tool_calls,
                elapsed,
                error: Some(format!("Orchestrator error: {e}")),
                output: full_text,
            },
            Err(_) => {
                eprintln!("  TIMEOUT after {}s", cfg.timeout.as_secs());
                EvalResult {
                    scenario: name.into(),
                    passed: false,
                    turns: approx_turns,
                    tool_calls,
                    elapsed,
                    error: Some(format!("Timed out after {}s", cfg.timeout.as_secs())),
                    output: full_text,
                }
            },
        }
    }

    fn make_scope(root: &str) -> TaskScope {
        TaskScope {
            root_path: root.into(),
            files: vec![],
            directory: None,
            declarations: vec![],
            description: None,
        }
    }

    // ─── Checkers ────────────────────────────────────────────────────────

    fn has_event(events: &[TaskEvent], pred: impl Fn(&TaskEvent) -> bool) -> bool {
        events.iter().any(pred)
    }

    fn completed(events: &[TaskEvent]) -> bool {
        has_event(events, |e| matches!(e, TaskEvent::Complete))
    }

    fn used_tool(events: &[TaskEvent], name: &str) -> bool {
        has_event(events, |e| {
            matches!(e, TaskEvent::ToolStart { tool_name, .. } if tool_name == name)
        })
    }

    fn tool_succeeded(events: &[TaskEvent], name: &str) -> bool {
        has_event(events, |e| {
            matches!(e, TaskEvent::ToolEnd { tool_name, success, .. } if tool_name == name && *success)
        })
    }

    // ─── Individual scenarios ────────────────────────────────────────────
    //
    // Each scenario tests a specific agent capability.
    // They are #[ignore] so they only run when explicitly requested.

    #[tokio::test]
    #[ignore]
    async fn eval_simple_question() {
        let cfg = EvalConfig::from_env().expect(
            "Set COTECT_EVAL_ENDPOINT and COTECT_EVAL_MODEL to run eval tests",
        );
        let result = run_scenario(
            &cfg,
            "simple_question",
            "What is 2 + 2? Reply with just the number.",
            AgentRole::Research,
            make_scope("/tmp"),
            |events, text| {
                let ok = completed(events) && text.contains('4');
                (ok, format!("Expected '4' in output, got: {}", &text[..text.len().min(200)]))
            },
        )
        .await;
        println!("\n{result}");
        assert!(result.passed, "{}", result.error.unwrap_or_default());
    }

    #[tokio::test]
    #[ignore]
    async fn eval_read_file() {
        let cfg = EvalConfig::from_env().expect(
            "Set COTECT_EVAL_ENDPOINT and COTECT_EVAL_MODEL to run eval tests",
        );

        // Create a temp file to read
        let dir = tempfile::TempDir::new().unwrap();
        let file_path = dir.path().join("sample.txt");
        std::fs::write(&file_path, "The secret password is: COTECT_42\n").unwrap();

        let mut scope = make_scope(dir.path().to_str().unwrap());
        scope.files = vec![file_path.to_str().unwrap().into()];

        let prompt = format!(
            "Read the file at {} and tell me the secret password.",
            file_path.display()
        );

        let result = run_scenario(
            &cfg,
            "read_file",
            &prompt,
            AgentRole::Research,
            scope,
            |events, text| {
                let read_used = used_tool(events, "read");
                let read_ok = tool_succeeded(events, "read");
                let has_password = text.contains("COTECT_42");
                let ok = completed(events) && read_used && read_ok && has_password;
                let mut detail = String::new();
                if !read_used { detail.push_str("did not use read tool; "); }
                if !read_ok { detail.push_str("read tool failed; "); }
                if !has_password { detail.push_str("password not in output; "); }
                (ok, detail)
            },
        )
        .await;
        println!("\n{result}");
        assert!(result.passed, "{}", result.error.unwrap_or_default());
    }

    #[tokio::test]
    #[ignore]
    async fn eval_write_file() {
        let cfg = EvalConfig::from_env().expect(
            "Set COTECT_EVAL_ENDPOINT and COTECT_EVAL_MODEL to run eval tests",
        );

        let dir = tempfile::TempDir::new().unwrap();
        let file_path = dir.path().join("output.txt");

        let prompt = format!(
            "Create a file at {} with the content: Hello from Cotect agent!",
            file_path.display()
        );

        let result = run_scenario(
            &cfg,
            "write_file",
            &prompt,
            AgentRole::Implement,
            make_scope(dir.path().to_str().unwrap()),
            |events, _text| {
                let write_used = used_tool(events, "write");
                let write_ok = tool_succeeded(events, "write");
                let ok = completed(events) && write_used && write_ok;
                let mut detail = String::new();
                if !write_used { detail.push_str("did not use write tool; "); }
                if !write_ok { detail.push_str("write tool failed; "); }
                (ok, detail)
            },
        )
        .await;

        // Also verify the file was actually created
        let on_disk = std::fs::read_to_string(&file_path).unwrap_or_default();
        let file_ok = on_disk.contains("Hello from Cotect agent");

        println!("\n{result}");
        println!("  File created: {file_ok} (content: {:?})", &on_disk[..on_disk.len().min(100)]);
        assert!(result.passed && file_ok, "passed={} file_ok={file_ok} {}", result.passed, result.error.unwrap_or_default());
    }

    #[tokio::test]
    #[ignore]
    async fn eval_read_then_patch() {
        let cfg = EvalConfig::from_env().expect(
            "Set COTECT_EVAL_ENDPOINT and COTECT_EVAL_MODEL to run eval tests",
        );

        let dir = tempfile::TempDir::new().unwrap();
        let file_path = dir.path().join("config.json");
        std::fs::write(&file_path, r#"{"version": "1.0.0", "name": "old-name"}"#).unwrap();

        let prompt = format!(
            "Read the file at {} then change the name from 'old-name' to 'new-name' using patch.",
            file_path.display()
        );

        let mut scope = make_scope(dir.path().to_str().unwrap());
        scope.files = vec![file_path.to_str().unwrap().into()];

        let result = run_scenario(
            &cfg,
            "read_then_patch",
            &prompt,
            AgentRole::Implement,
            scope,
            |events, _text| {
                let read_used = used_tool(events, "read");
                let patch_used = used_tool(events, "patch");
                let patch_ok = tool_succeeded(events, "patch");
                let ok = completed(events) && read_used && patch_used && patch_ok;
                let mut detail = String::new();
                if !read_used { detail.push_str("did not read first; "); }
                if !patch_used { detail.push_str("did not use patch; "); }
                if !patch_ok { detail.push_str("patch failed; "); }
                (ok, detail)
            },
        )
        .await;

        let on_disk = std::fs::read_to_string(&file_path).unwrap_or_default();
        let file_ok = on_disk.contains("new-name") && !on_disk.contains("old-name");

        println!("\n{result}");
        println!("  File patched: {file_ok} (content: {on_disk:?})");
        assert!(result.passed && file_ok, "passed={} file_ok={file_ok} {}", result.passed, result.error.unwrap_or_default());
    }

    #[tokio::test]
    #[ignore]
    async fn eval_shell_command() {
        let cfg = EvalConfig::from_env().expect(
            "Set COTECT_EVAL_ENDPOINT and COTECT_EVAL_MODEL to run eval tests",
        );

        let result = run_scenario(
            &cfg,
            "shell_command",
            "Run `uname -s` and tell me what operating system this is.",
            AgentRole::Implement,
            make_scope("/tmp"),
            |events, text| {
                let shell_used = used_tool(events, "shell");
                let shell_ok = tool_succeeded(events, "shell");
                // The output should mention Linux or Darwin
                let mentions_os = text.to_lowercase().contains("linux")
                    || text.to_lowercase().contains("darwin")
                    || text.to_lowercase().contains("operating system");
                let ok = completed(events) && shell_used && shell_ok && mentions_os;
                let mut detail = String::new();
                if !shell_used { detail.push_str("did not use shell; "); }
                if !shell_ok { detail.push_str("shell failed; "); }
                if !mentions_os { detail.push_str("no OS mention in output; "); }
                (ok, detail)
            },
        )
        .await;
        println!("\n{result}");
        assert!(result.passed, "{}", result.error.unwrap_or_default());
    }

    #[tokio::test]
    #[ignore]
    async fn eval_search_and_report() {
        let cfg = EvalConfig::from_env().expect(
            "Set COTECT_EVAL_ENDPOINT and COTECT_EVAL_MODEL to run eval tests",
        );

        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(dir.path().join("a.rs"), "fn compute_total() -> i32 { 42 }\n").unwrap();
        std::fs::write(dir.path().join("b.rs"), "fn compute_average() -> f64 { 3.14 }\n").unwrap();
        std::fs::write(dir.path().join("c.ts"), "export function getUser() { return null; }\n").unwrap();

        let prompt = format!(
            "Search for all functions named 'compute_*' in {} and list them.",
            dir.path().display()
        );

        let result = run_scenario(
            &cfg,
            "search_and_report",
            &prompt,
            AgentRole::Research,
            make_scope(dir.path().to_str().unwrap()),
            |events, text| {
                let search_used = used_tool(events, "fs_search");
                let mentions_total = text.contains("compute_total");
                let mentions_avg = text.contains("compute_average");
                let ok = completed(events) && search_used && mentions_total && mentions_avg;
                let mut detail = String::new();
                if !search_used { detail.push_str("did not use fs_search; "); }
                if !mentions_total { detail.push_str("missing compute_total; "); }
                if !mentions_avg { detail.push_str("missing compute_average; "); }
                (ok, detail)
            },
        )
        .await;
        println!("\n{result}");
        assert!(result.passed, "{}", result.error.unwrap_or_default());
    }

    #[tokio::test]
    #[ignore]
    async fn eval_multi_step_implementation() {
        let cfg = EvalConfig::from_env().expect(
            "Set COTECT_EVAL_ENDPOINT and COTECT_EVAL_MODEL to run eval tests",
        );

        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(
            dir.path().join("math.py"),
            "def add(a, b):\n    return a + b\n\ndef subtract(a, b):\n    return a - b\n",
        )
        .unwrap();

        let prompt = format!(
            "Read the file {}/math.py, then add a multiply function after the subtract function. \
             The multiply function should take two parameters and return their product.",
            dir.path().display()
        );

        let mut scope = make_scope(dir.path().to_str().unwrap());
        scope.files = vec![dir.path().join("math.py").to_str().unwrap().into()];

        let result = run_scenario(
            &cfg,
            "multi_step_implementation",
            &prompt,
            AgentRole::Implement,
            scope,
            |events, _text| {
                let read_used = used_tool(events, "read");
                let modified = used_tool(events, "patch") || used_tool(events, "write");
                let ok = completed(events) && read_used && modified;
                let mut detail = String::new();
                if !read_used { detail.push_str("did not read first; "); }
                if !modified { detail.push_str("did not modify file; "); }
                (ok, detail)
            },
        )
        .await;

        let on_disk = std::fs::read_to_string(dir.path().join("math.py")).unwrap_or_default();
        let has_multiply = on_disk.contains("multiply") || on_disk.contains("mul");
        let _has_return = on_disk.contains("return") && (on_disk.contains("*") || on_disk.contains("product"));

        println!("\n{result}");
        println!("  File has multiply: {has_multiply}");
        println!("  File content:\n{on_disk}");
        assert!(result.passed && has_multiply, "passed={} has_multiply={has_multiply} {}", result.passed, result.error.unwrap_or_default());
    }

    #[tokio::test]
    #[ignore]
    async fn eval_error_recovery() {
        let cfg = EvalConfig::from_env().expect(
            "Set COTECT_EVAL_ENDPOINT and COTECT_EVAL_MODEL to run eval tests",
        );

        let dir = tempfile::TempDir::new().unwrap();
        let file_path = dir.path().join("data.txt");
        std::fs::write(&file_path, "line one\nline two\nline three\n").unwrap();

        // Ask it to patch with something that will fail on first try (wrong old_string),
        // then it should read and retry correctly
        let prompt = format!(
            "Change 'line two' to 'LINE TWO' in {}. \
             Make sure you read the file first to get the exact content.",
            file_path.display()
        );

        let result = run_scenario(
            &cfg,
            "error_recovery",
            &prompt,
            AgentRole::Implement,
            make_scope(dir.path().to_str().unwrap()),
            |events, _text| {
                let read_used = used_tool(events, "read");
                let patch_ok = tool_succeeded(events, "patch") || tool_succeeded(events, "write");
                let ok = completed(events) && read_used && patch_ok;
                let mut detail = String::new();
                if !read_used { detail.push_str("did not read; "); }
                if !patch_ok { detail.push_str("patch/write did not succeed; "); }
                (ok, detail)
            },
        )
        .await;

        let on_disk = std::fs::read_to_string(&file_path).unwrap_or_default();
        let file_ok = on_disk.contains("LINE TWO");

        println!("\n{result}");
        println!("  File patched: {file_ok} (content: {on_disk:?})");
        assert!(result.passed && file_ok, "passed={} file_ok={file_ok} {}", result.passed, result.error.unwrap_or_default());
    }

    #[tokio::test]
    #[ignore]
    async fn eval_plan_generation() {
        let cfg = EvalConfig::from_env().expect(
            "Set COTECT_EVAL_ENDPOINT and COTECT_EVAL_MODEL to run eval tests",
        );

        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(
            dir.path().join("app.ts"),
            "export function main() {\n  console.log('hello');\n}\n",
        )
        .unwrap();

        let prompt = format!(
            "Create an implementation plan for adding error handling to {}/app.ts. \
             The plan should include numbered steps with specific file changes.",
            dir.path().display()
        );

        let mut scope = make_scope(dir.path().to_str().unwrap());
        scope.files = vec![dir.path().join("app.ts").to_str().unwrap().into()];

        let result = run_scenario(
            &cfg,
            "plan_generation",
            &prompt,
            AgentRole::Plan,
            scope,
            |events, text| {
                let has_steps = text.contains("1.") || text.contains("1)") || text.contains("Step 1");
                let mentions_file = text.contains("app.ts");
                let mentions_error = text.to_lowercase().contains("error") || text.to_lowercase().contains("try");
                let ok = completed(events) && has_steps && mentions_file && mentions_error;
                let mut detail = String::new();
                if !has_steps { detail.push_str("no numbered steps; "); }
                if !mentions_file { detail.push_str("no file reference; "); }
                if !mentions_error { detail.push_str("no error handling mention; "); }
                (ok, detail)
            },
        )
        .await;
        println!("\n{result}");
        assert!(result.passed, "{}", result.error.unwrap_or_default());
    }

    // ─── Full suite runner ───────────────────────────────────────────────

    #[tokio::test]
    #[ignore]
    async fn eval_full_suite() {
        let cfg = EvalConfig::from_env().expect(
            "Set COTECT_EVAL_ENDPOINT and COTECT_EVAL_MODEL to run eval tests",
        );

        println!("\n{}", "=".repeat(72));
        println!(
            "COTECT MODEL EVALUATION: {} @ {}",
            cfg.model, cfg.endpoint
        );
        println!("Max turns: {}  Timeout: {}s", cfg.max_turns, cfg.timeout.as_secs());
        println!("{}", "=".repeat(72));

        let mut results: Vec<EvalResult> = Vec::new();

        // 1. Simple question
        results.push(run_scenario(
            &cfg,
            "simple_question",
            "What is 2 + 2? Reply with just the number.",
            AgentRole::Research,
            make_scope("/tmp"),
            |events, text| {
                let ok = completed(events) && text.contains('4');
                (ok, format!("Expected '4', got: {}", &text[..text.len().min(100)]))
            },
        ).await);

        // 2. Read file
        let dir2 = tempfile::TempDir::new().unwrap();
        let f2 = dir2.path().join("secret.txt");
        std::fs::write(&f2, "SECRET=eval_pass_42\n").unwrap();
        let mut scope2 = make_scope(dir2.path().to_str().unwrap());
        scope2.files = vec![f2.to_str().unwrap().into()];

        results.push(run_scenario(
            &cfg,
            "read_file",
            &format!("Read {} and tell me the value of SECRET.", f2.display()),
            AgentRole::Research,
            scope2,
            |events, text| {
                let ok = completed(events)
                    && used_tool(events, "read")
                    && text.contains("eval_pass_42");
                (ok, "Missing read tool or secret value".into())
            },
        ).await);

        // 3. Write file
        let dir3 = tempfile::TempDir::new().unwrap();
        let f3 = dir3.path().join("greeting.txt");
        results.push(run_scenario(
            &cfg,
            "write_file",
            &format!("Create {} with content: Hello from eval!", f3.display()),
            AgentRole::Implement,
            make_scope(dir3.path().to_str().unwrap()),
            |events, _text| {
                let ok = completed(events) && used_tool(events, "write");
                (ok, "Missing write tool".into())
            },
        ).await);
        let wrote_ok = std::fs::read_to_string(&f3)
            .map(|c| c.contains("Hello from eval"))
            .unwrap_or(false);
        if !wrote_ok {
            if let Some(r) = results.last_mut() {
                r.passed = false;
                r.error = Some("File not created or wrong content".into());
            }
        }

        // 4. Read + Patch
        let dir4 = tempfile::TempDir::new().unwrap();
        let f4 = dir4.path().join("cfg.json");
        std::fs::write(&f4, r#"{"version": "1.0"}"#).unwrap();
        let mut scope4 = make_scope(dir4.path().to_str().unwrap());
        scope4.files = vec![f4.to_str().unwrap().into()];

        results.push(run_scenario(
            &cfg,
            "read_then_patch",
            &format!("Read {} and change the version to '2.0'.", f4.display()),
            AgentRole::Implement,
            scope4,
            |events, _text| {
                let ok = completed(events) && used_tool(events, "read")
                    && (tool_succeeded(events, "patch") || tool_succeeded(events, "write"));
                (ok, "Missing read->patch flow".into())
            },
        ).await);
        let patched_ok = std::fs::read_to_string(&f4)
            .map(|c| c.contains("2.0"))
            .unwrap_or(false);
        if !patched_ok {
            if let Some(r) = results.last_mut() {
                r.passed = false;
                r.error = Some("File not patched correctly".into());
            }
        }

        // 5. Shell command
        results.push(run_scenario(
            &cfg,
            "shell_command",
            "Run `uname -s` and tell me what OS this is.",
            AgentRole::Implement,
            make_scope("/tmp"),
            |events, text| {
                let ok = completed(events) && used_tool(events, "shell")
                    && (text.to_lowercase().contains("linux") || text.to_lowercase().contains("darwin"));
                (ok, "Shell not used or OS not identified".into())
            },
        ).await);

        // 6. Search
        let dir6 = tempfile::TempDir::new().unwrap();
        std::fs::write(dir6.path().join("a.rs"), "fn helper_one() {}\n").unwrap();
        std::fs::write(dir6.path().join("b.rs"), "fn helper_two() {}\n").unwrap();

        results.push(run_scenario(
            &cfg,
            "search_codebase",
            &format!("Search for functions starting with 'helper_' in {}.", dir6.path().display()),
            AgentRole::Research,
            make_scope(dir6.path().to_str().unwrap()),
            |events, text| {
                let ok = completed(events) && used_tool(events, "fs_search")
                    && text.contains("helper_one") && text.contains("helper_two");
                (ok, "Search not used or results incomplete".into())
            },
        ).await);

        // 7. Multi-step implementation
        let dir7 = tempfile::TempDir::new().unwrap();
        std::fs::write(
            dir7.path().join("calc.py"),
            "def add(a, b):\n    return a + b\n",
        ).unwrap();
        let mut scope7 = make_scope(dir7.path().to_str().unwrap());
        scope7.files = vec![dir7.path().join("calc.py").to_str().unwrap().into()];

        results.push(run_scenario(
            &cfg,
            "multi_step_implementation",
            &format!("Read {}/calc.py and add a `multiply` function.", dir7.path().display()),
            AgentRole::Implement,
            scope7,
            |events, _text| {
                let ok = completed(events) && used_tool(events, "read")
                    && (used_tool(events, "patch") || used_tool(events, "write"));
                (ok, "Missing read->modify flow".into())
            },
        ).await);
        let impl_ok = std::fs::read_to_string(dir7.path().join("calc.py"))
            .map(|c| c.contains("multiply") || c.contains("mul"))
            .unwrap_or(false);
        if !impl_ok {
            if let Some(r) = results.last_mut() {
                r.passed = false;
                r.error = Some("multiply function not added".into());
            }
        }

        // 8. Plan generation
        results.push(run_scenario(
            &cfg,
            "plan_generation",
            "Create a plan to add input validation to a REST API. Include numbered steps.",
            AgentRole::Plan,
            make_scope("/tmp"),
            |events, text| {
                let has_steps = text.contains("1.") || text.contains("1)") || text.contains("Step 1");
                let ok = completed(events) && has_steps;
                (ok, "No numbered steps in plan".into())
            },
        ).await);

        // ─── Summary ────────────────────────────────────────────────────

        println!("\n{}", "─".repeat(72));
        println!("RESULTS: {} @ {}", cfg.model, cfg.endpoint);
        println!("{}", "─".repeat(72));

        let mut pass_count = 0;
        for r in &results {
            println!("{r}");
            if r.passed {
                pass_count += 1;
            }
        }

        let total = results.len();
        let total_time: Duration = results.iter().map(|r| r.elapsed).sum();
        let total_tools: usize = results.iter().map(|r| r.tool_calls.len()).sum();

        println!("{}", "─".repeat(72));
        println!(
            "Score: {pass_count}/{total} ({:.0}%)  Total time: {:.1}s  Total tool calls: {total_tools}",
            (pass_count as f64 / total as f64) * 100.0,
            total_time.as_secs_f64(),
        );
        println!("{}", "=".repeat(72));

        // Don't assert — let the user see the full report
        // Individual tests above assert if you want hard failure
    }
}
