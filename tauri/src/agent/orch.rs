use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::mpsc;

use super::context::ConversationContext;
use super::doom_loop::DoomLoopDetector;
use super::llm_client::LlmClient;
use super::retry::retry_with_backoff;
use super::system_prompt::{self, EnvironmentInfo};
use super::tools::{self, ToolState};
use super::types::*;
use super::utils::truncate_chars;

/// Tracks per-tool error counts to enforce error budgets.
#[derive(Debug, Default)]
struct ToolErrorTracker {
    errors: HashMap<String, usize>,
    limit: usize,
}

impl ToolErrorTracker {
    fn new(limit: usize) -> Self {
        Self {
            errors: HashMap::new(),
            limit,
        }
    }

    fn record_error(&mut self, tool_name: &str) {
        *self.errors.entry(tool_name.to_string()).or_insert(0) += 1;
    }

    fn record_success(&mut self, tool_name: &str) {
        self.errors.remove(tool_name);
    }

    fn remaining(&self, tool_name: &str) -> usize {
        let used = self.errors.get(tool_name).copied().unwrap_or(0);
        self.limit.saturating_sub(used)
    }

    fn limit_reached(&self) -> bool {
        self.errors.values().any(|&count| count >= self.limit)
    }
}

/// The agentic orchestration loop.
///
/// Budgets and circuit-breakers:
/// - `max_turns` is the only hard ceiling on how long the model can work.
/// - `error_tracker` stops the loop when a single tool fails repeatedly
///   (5 per tool).
/// - `doom_detector` intervenes when tool-call patterns loop.
///
/// Reasoning length is NOT a failure mode — earlier per-turn/cumulative
/// byte caps interrupted legitimate multi-step planning and were removed.
pub struct Orchestrator {
    llm: LlmClient,
    context: ConversationContext,
    tool_state: Arc<ToolState>,
    sender: mpsc::UnboundedSender<TaskEvent>,
    error_tracker: ToolErrorTracker,
    doom_detector: DoomLoopDetector,
    max_turns: usize,
    tool_call_counter: usize,
    /// Stall tracker: timestamp of the last tool call (or task start)
    /// and accumulated reasoning+text bytes since then. Drives a one-shot
    /// `TaskEvent::ReasoningStall` when both thresholds are exceeded.
    /// Advisory only — does not change orchestration.
    last_action_at: Instant,
    reasoning_bytes_since_action: usize,
    stall_emitted: bool,
}

/// Both thresholds must be exceeded to trigger `ReasoningStall` — short
/// bursts of long reasoning don't trip; long bursts of trivial reasoning
/// don't either. Tuned from eval transcripts (testing_04 burned ~13.7k
/// stream events / 600s between tool calls; everyone else stayed under
/// 60s + 4 KB).
const STALL_REASONING_BYTES: usize = 4 * 1024;
const STALL_WALL_MS: u64 = 60_000;

impl Orchestrator {
    pub fn new(
        provider: &ProviderConfig,
        request: &TaskRequest,
        sender: mpsc::UnboundedSender<TaskEvent>,
    ) -> Self {
        let llm = LlmClient::new(provider);
        let tool_defs = tools::definitions_for_role(request.role);
        let tool_state = if request.scope.blocked_files.is_empty() {
            ToolState::new(request.scope.root_path.clone())
        } else {
            ToolState::with_blocked_files(
                request.scope.root_path.clone(),
                request.scope.blocked_files.clone(),
            )
        };

        let env = EnvironmentInfo {
            cwd: request.scope.root_path.clone(),
            ..EnvironmentInfo::default()
        };

        let mut system_prompt = system_prompt::build_system_prompt(
            request.role,
            &request.scope,
            &env,
            &[], // file contents loaded lazily via read tool
            None,
        );

        // `/no_think` soft switch is officially Qwen 3 only, but 3.5/3.6
        // finetunes often still honour it. Complementary to server-side flags.
        if provider.disable_thinking == Some(true)
            && matches!(provider.resolved_format(), crate::agent::adapter::PromptFormat::Qwen)
        {
            system_prompt.push_str("\n\n/no_think\n");
        }

        let mut context = ConversationContext::new(system_prompt, tool_defs);
        context.append_user(&request.prompt);

        Self {
            llm,
            context,
            tool_state,
            sender,
            error_tracker: ToolErrorTracker::new(5),
            doom_detector: DoomLoopDetector::default(),
            // 30 turns is enough even for complex refactors when the model
            // stays on task; beyond that it's almost always a tool-call loop.
            max_turns: 30,
            tool_call_counter: 0,
            last_action_at: Instant::now(),
            reasoning_bytes_since_action: 0,
            stall_emitted: false,
        }
    }

    /// Override the maximum number of LLM turns before the loop is forcefully stopped.
    #[allow(dead_code)]
    pub fn set_max_turns(&mut self, max_turns: usize) {
        self.max_turns = max_turns;
    }

    /// Run the orchestration loop until completion, interruption, or error.
    pub async fn run(&mut self) -> anyhow::Result<()> {
        let mut should_yield = false;
        let mut is_complete = false;
        let mut turn_count = 0;
        let mut empty_turn_count = 0;
        let mut stream_timeout_count = 0;
        const MAX_EMPTY_TURNS: usize = 3;
        const MAX_STREAM_TIMEOUTS: usize = 2;

        while !should_yield {
            // Doom loop: warn at 3 repetitions, abort at 5. The reminder
            // is tailored for thinking-in-shell because the generic "try
            // a different approach" wording doesn't land for that case.
            if let Some(count) = self.doom_detector.check() {
                if count >= 5 {
                    self.sender
                        .send(TaskEvent::Interrupted {
                            reason: format!(
                                "Doom loop detected: same tool call pattern repeated {count} times. Stopping."
                            ),
                        })
                        .ok();
                    break;
                }
                if self.doom_detector.last_alarm_is_thinking_in_shell() {
                    self.context.inject_system_reminder(
                        "You are running shell commands whose body is mostly comments. \
                         That's not a real action — it's thinking dressed up as a tool \
                         call. Either call a different tool (read / write / patch), or \
                         run a shell command that actually produces useful output (e.g. \
                         a test invocation, not `python3 -c \"# ...\"`)."
                    );
                } else {
                    self.context.inject_system_reminder(&format!(
                        "You have repeated the same tool call pattern {count} times. \
                         You are stuck in a loop. Try a completely different approach — \
                         for example, use the write tool to rewrite the whole file instead of patching."
                    ));
                }
            }

            let messages = self.context.messages().to_vec();
            let tool_defs = self.context.tool_definitions().to_vec();

            let rx = retry_with_backoff(
                || self.llm.chat_stream(messages.clone(), Some(tool_defs.clone()), 1.0),
                3,
                500,
            )
            .await?;

            let mut turn = self.consume_stream(rx).await?;

            // Stall tracker accumulates across turns until a tool call resets it.
            self.reasoning_bytes_since_action +=
                turn.reasoning.len() + turn.content.len();
            if !self.stall_emitted {
                let elapsed = self.last_action_at.elapsed();
                if elapsed.as_millis() as u64 >= STALL_WALL_MS
                    && self.reasoning_bytes_since_action >= STALL_REASONING_BYTES
                {
                    self.sender
                        .send(TaskEvent::ReasoningStall {
                            elapsed_ms: elapsed.as_millis() as u64,
                            reasoning_bytes: self.reasoning_bytes_since_action,
                        })
                        .ok();
                    self.stall_emitted = true;
                }
            }

            // Remap tool call IDs to call_N. Some servers (OpenAI, llama.cpp)
            // generate 32-char random IDs that some models (Gemma 4) echo
            // back as text when confused by tool-call templates.
            for tool_call in turn.tool_calls.iter_mut() {
                self.tool_call_counter += 1;
                tool_call.id = format!("call_{}", self.tool_call_counter);
            }

            let finish = turn.finish_reason.as_deref();
            let has_tools = !turn.tool_calls.is_empty();
            let has_content = !turn.content.trim().is_empty();

            is_complete = (finish == Some("stop") || finish == Some("end_turn") || finish.is_none())
                && !has_tools;
            should_yield = is_complete;

            // "timeout": no bytes for COTECT_STREAM_IDLE_TIMEOUT seconds.
            // "stream_ended": HTTP stream closed without [DONE] (server crash,
            // KV cache exhaustion, inference error). Both transient — retry.
            if finish == Some("timeout") || finish == Some("stream_ended") {
                stream_timeout_count += 1;
                let kind = if finish == Some("timeout") {
                    "stream idle timeout"
                } else {
                    "stream terminated without completion"
                };
                if stream_timeout_count >= MAX_STREAM_TIMEOUTS {
                    self.sender
                        .send(TaskEvent::Interrupted {
                            reason: format!(
                                "LLM server stopped responding ({kind}, giving up after {stream_timeout_count} retries)."
                            ),
                        })
                        .ok();
                    should_yield = true;
                } else {
                    // Retry the same turn without modifying context — fresh
                    // request with the same messages often succeeds.
                    continue;
                }
            } else {
                stream_timeout_count = 0;
            }

            // Token-limit hit with no tool calls = yield. Continuing would
            // loop endlessly (common with reasoning-heavy models like Gemma 4).
            if finish == Some("length") && !has_tools {
                if has_content {
                    is_complete = true;
                    should_yield = true;
                } else {
                    // No content, no tools — model spent everything on reasoning.
                    empty_turn_count += 1;
                    if empty_turn_count >= MAX_EMPTY_TURNS {
                        self.sender
                            .send(TaskEvent::Interrupted {
                                reason: "Model repeatedly hit token limit without producing output.".into(),
                            })
                            .ok();
                        should_yield = true;
                    } else {
                        self.context.inject_system_reminder(
                            "Your previous response was cut off because it exceeded the token limit. \
                             Be more concise. Produce your answer directly without extensive reasoning."
                        );
                    }
                }
            }

            if !has_tools && !has_content && finish != Some("length") {
                empty_turn_count += 1;
                if empty_turn_count >= MAX_EMPTY_TURNS {
                    self.sender
                        .send(TaskEvent::Interrupted {
                            reason: "Model produced no output for multiple consecutive turns.".into(),
                        })
                        .ok();
                    should_yield = true;
                }
            } else if has_tools || has_content {
                empty_turn_count = 0;
            }

            if !turn.tool_calls.is_empty() {
                // A tool call clears pending stall state.
                self.last_action_at = Instant::now();
                self.reasoning_bytes_since_action = 0;
                self.stall_emitted = false;

                self.context
                    .append_assistant_with_tools(&turn.content, turn.tool_calls.clone());

                for tool_call in &turn.tool_calls {
                    let file_path = tools::extract_file_path(&tool_call.function);

                    self.sender
                        .send(TaskEvent::ToolStart {
                            tool_name: tool_call.function.name.clone(),
                            file_path: file_path.clone(),
                            description: None,
                            arguments: Some(tool_call.function.arguments.clone()),
                        })
                        .ok();

                    let result = tools::execute_tool(tool_call, &self.tool_state).await;

                    let (success, output_preview) = match &result {
                        Ok(output) => (true, Some(truncate_chars(output, 500))),
                        Err(e) => (false, Some(truncate_chars(e, 500))),
                    };

                    self.sender
                        .send(TaskEvent::ToolEnd {
                            tool_name: tool_call.function.name.clone(),
                            file_path: file_path.clone(),
                            success,
                            output: output_preview,
                        })
                        .ok();

                    let tool_result_text = match result {
                        Ok(mut output) => {
                            self.error_tracker.record_success(&tool_call.function.name);
                            // Drop prior __format_error__ round-trips from context.
                            self.context.compact_format_errors();

                            // Nudge on non-zero shell exit so the model keeps iterating
                            // instead of producing a text-only final response.
                            if tool_call.function.name == "shell" {
                                if let Some(code) = extract_shell_exit_code(&output) {
                                    if code != 0 {
                                        output.push_str(
                                            "\n\n[NOTE: The command exited with a non-zero code. \
                                             Analyze the output above, fix the underlying issue, \
                                             and re-run the command.]"
                                        );
                                    }
                                }
                            }

                            output
                        }
                        Err(e) => {
                            self.error_tracker.record_error(&tool_call.function.name);
                            let remaining = self.error_tracker.remaining(&tool_call.function.name);
                            format!(
                                "Error: {e}\n\n<retry attempts_left=\"{remaining}\" max=\"{}\"/>",
                                self.error_tracker.limit
                            )
                        }
                    };

                    let compact_for_context =
                        truncate_tool_result_for_context(&tool_result_text);
                    self.context
                        .append_tool_result(&tool_call.id, &compact_for_context);

                    self.doom_detector
                        .record(&tool_call.function.name, &tool_call.function.arguments);
                }
            } else if has_content {
                self.context.append_assistant(&turn.content);
            }
            // else: empty turn — skip appending. An empty assistant message
            // would leave the next request with a trailing assistant turn,
            // which some servers reject as a "prefill" (e.g. Gemma 4 with
            // enable_thinking: 400 Bad Request). empty_turn_count handles bailing.

            if self.error_tracker.limit_reached() {
                self.sender
                    .send(TaskEvent::Interrupted {
                        reason: "Too many tool errors. Stopping.".into(),
                    })
                    .ok();
                should_yield = true;
            }

            turn_count += 1;
            if turn_count >= self.max_turns {
                self.sender
                    .send(TaskEvent::Interrupted {
                        reason: format!("Reached maximum turn limit ({}).", self.max_turns),
                    })
                    .ok();
                should_yield = true;
            }

            if self.context.estimated_tokens() > self.context.compaction_threshold() {
                self.context.compact();
            }
        }

        if is_complete {
            self.sender.send(TaskEvent::Complete).ok();
        }

        Ok(())
    }

    /// Forwards text/reasoning deltas to the UI sender and accumulates
    /// tool calls. Reasoning length is not capped — see `STALL_*` constants
    /// for the advisory `ReasoningStall` signal.
    async fn consume_stream(
        &self,
        mut rx: mpsc::UnboundedReceiver<LlmStreamEvent>,
    ) -> anyhow::Result<LlmTurnResult> {
        let mut result = LlmTurnResult::default();
        let mut tool_call_builders: BTreeMap<usize, ToolCallBuilder> = BTreeMap::new();

        while let Some(event) = rx.recv().await {
            match event {
                LlmStreamEvent::TextDelta(text) => {
                    result.content.push_str(&text);
                    self.sender
                        .send(TaskEvent::Text {
                            content: text,
                            partial: true,
                        })
                        .ok();
                }
                LlmStreamEvent::ReasoningDelta(text) => {
                    result.reasoning.push_str(&text);
                    self.sender
                        .send(TaskEvent::Reasoning { content: text })
                        .ok();
                }
                LlmStreamEvent::ToolCallDelta {
                    index,
                    id,
                    name,
                    arguments_chunk,
                } => {
                    let builder = tool_call_builders.entry(index).or_default();
                    if let Some(id) = id {
                        builder.id = id;
                    }
                    if let Some(name) = name {
                        builder.name = name;
                    }
                    builder.arguments.push_str(&arguments_chunk);
                }
                LlmStreamEvent::Done { finish_reason } => {
                    result.finish_reason = finish_reason;
                    break;
                }
                LlmStreamEvent::Error(msg) => {
                    return Err(anyhow::anyhow!("LLM stream error: {msg}"));
                }
            }
        }

        // Deduplicate by (name, arguments) — some models (e.g. Gemma 4 26B)
        // emit the same tool call multiple times in a single response.
        let mut seen_calls = std::collections::HashSet::new();
        for (_, builder) in tool_call_builders {
            let dedup_key = (builder.name.clone(), builder.arguments.clone());
            if seen_calls.contains(&dedup_key) {
                continue;
            }
            seen_calls.insert(dedup_key);
            result.tool_calls.push(ToolCall {
                id: builder.id,
                call_type: "function".into(),
                function: FunctionCall {
                    name: builder.name,
                    arguments: builder.arguments,
                },
            });
        }

        const MAX_TOOL_CALLS_PER_TURN: usize = 5;
        if result.tool_calls.len() > MAX_TOOL_CALLS_PER_TURN {
            result.tool_calls.truncate(MAX_TOOL_CALLS_PER_TURN);
        }

        // Discard content when tool_calls are also present — typically
        // hallucinated (model guessed before seeing tool results).
        if !result.tool_calls.is_empty() && !result.content.is_empty() {
            result.content.clear();
        }

        if !result.content.is_empty() {
            self.sender
                .send(TaskEvent::Text {
                    content: result.content.clone(),
                    partial: false,
                })
                .ok();
        }

        Ok(result)
    }
}

#[derive(Debug, Default)]
struct ToolCallBuilder {
    id: String,
    name: String,
    arguments: String,
}

/// Keeps head (file list / test summary intro live here) and tail (shell
/// error messages + `[exit code: N]` marker) with a truncation marker in
/// the middle. Triggered above ~8 000 chars to keep context lean.
fn truncate_tool_result_for_context(result: &str) -> String {
    const MAX_CHARS: usize = 8_000;
    const HEAD_CHARS: usize = 2_000;
    const TAIL_CHARS: usize = 4_500;

    if result.len() <= MAX_CHARS {
        return result.to_string();
    }

    // Operate on char boundaries — don't split a multi-byte sequence.
    let char_count = result.chars().count();
    if char_count <= MAX_CHARS {
        return result.to_string();
    }

    let head: String = result.chars().take(HEAD_CHARS).collect();
    let tail: String = result
        .chars()
        .skip(char_count.saturating_sub(TAIL_CHARS))
        .collect();
    let truncated = char_count - HEAD_CHARS - TAIL_CHARS;

    format!(
        "{head}\n\n[... {truncated} chars truncated to keep context compact — \
         head and tail shown; re-run with narrower output if you need the \
         middle ...]\n\n{tail}"
    )
}

/// Parses `[exit code: N]` or `Command completed with exit code N.` formats.
fn extract_shell_exit_code(output: &str) -> Option<i32> {
    if let Some(idx) = output.rfind("[exit code: ") {
        let after = &output[idx + 12..];
        if let Some(end) = after.find(']') {
            if let Ok(code) = after[..end].trim().parse::<i32>() {
                return Some(code);
            }
        }
    }
    if let Some(idx) = output.find("Command completed with exit code ") {
        let after = &output[idx + 33..];
        let num: String = after.chars().take_while(|c| c.is_ascii_digit() || *c == '-').collect();
        if let Ok(code) = num.parse::<i32>() {
            return Some(code);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_error_tracker_records_errors() {
        let mut tracker = ToolErrorTracker::new(3);
        assert_eq!(tracker.remaining("read"), 3);

        tracker.record_error("read");
        assert_eq!(tracker.remaining("read"), 2);

        tracker.record_error("read");
        assert_eq!(tracker.remaining("read"), 1);

        assert!(!tracker.limit_reached());

        tracker.record_error("read");
        assert_eq!(tracker.remaining("read"), 0);
        assert!(tracker.limit_reached());
    }

    #[test]
    fn test_tool_error_tracker_success_resets() {
        let mut tracker = ToolErrorTracker::new(3);
        tracker.record_error("read");
        tracker.record_error("read");
        assert_eq!(tracker.remaining("read"), 1);

        tracker.record_success("read");
        assert_eq!(tracker.remaining("read"), 3);
    }

    #[test]
    fn test_tool_error_tracker_independent_tools() {
        let mut tracker = ToolErrorTracker::new(3);
        tracker.record_error("read");
        tracker.record_error("read");
        tracker.record_error("write");
        assert_eq!(tracker.remaining("read"), 1);
        assert_eq!(tracker.remaining("write"), 2);
        assert_eq!(tracker.remaining("shell"), 3);
    }

    #[test]
    fn test_truncate_tool_result_passes_short_output_unchanged() {
        let small = "exit code 0\nhello world";
        assert_eq!(truncate_tool_result_for_context(small), small);
    }

    #[test]
    fn test_truncate_tool_result_truncates_middle_of_long_output() {
        // Build a result far larger than the 8 000-char threshold.
        let head = "HEAD_MARKER_OF_INTEREST\n";
        let middle = "x".repeat(30_000);
        let tail = "TAIL_MARKER_EXIT_CODE_0";
        let input = format!("{head}{middle}{tail}");

        let out = truncate_tool_result_for_context(&input);

        assert!(out.contains("HEAD_MARKER_OF_INTEREST"), "head must survive");
        assert!(out.contains("TAIL_MARKER_EXIT_CODE_0"), "tail must survive");
        assert!(out.contains("chars truncated"), "truncation marker must be visible");
        assert!(out.len() < input.len(), "truncated form must be smaller");
        // Should be roughly head + tail + marker — well under 10 KB.
        assert!(out.len() < 8_000, "truncated form must fit under ~8KB");
    }

    #[test]
    fn test_truncate_tool_result_preserves_utf8_boundaries() {
        // Mix of multi-byte chars must not panic when we take/skip chars.
        let mut big = String::new();
        for _ in 0..5_000 {
            big.push_str("αβγδ€✓");
        }
        let out = truncate_tool_result_for_context(&big);
        // Round-trip must be valid UTF-8 (implicit: String::from_utf8 would
        // fail otherwise; since String is UTF-8 by construction, this is a
        // smoke test that we didn't panic).
        assert!(out.chars().count() > 0);
        assert!(out.contains("chars truncated"));
    }

    #[test]
    fn test_tool_error_tracker_zero_limit() {
        let tracker = ToolErrorTracker::new(0);
        // With limit 0, no errors are allowed
        assert!(!tracker.limit_reached()); // No errors recorded yet
        assert_eq!(tracker.remaining("read"), 0); // But remaining is 0
    }

    #[test]
    fn test_tool_error_tracker_zero_limit_immediate_saturation() {
        let mut tracker = ToolErrorTracker::new(0);
        tracker.record_error("read");
        assert!(tracker.limit_reached());
    }

    #[test]
    fn test_tool_error_tracker_many_tools() {
        let mut tracker = ToolErrorTracker::new(3);
        tracker.record_error("read");
        tracker.record_error("write");
        tracker.record_error("patch");
        tracker.record_error("shell");
        tracker.record_error("fetch");
        // None have hit limit of 3
        assert!(!tracker.limit_reached());
        assert_eq!(tracker.remaining("read"), 2);

        // Now push "read" to limit
        tracker.record_error("read");
        tracker.record_error("read");
        assert!(tracker.limit_reached());
    }

    #[test]
    fn test_tool_error_tracker_success_after_limit() {
        let mut tracker = ToolErrorTracker::new(2);
        tracker.record_error("read");
        tracker.record_error("read");
        assert!(tracker.limit_reached());

        // A success on "read" resets it
        tracker.record_success("read");
        assert!(!tracker.limit_reached());
        assert_eq!(tracker.remaining("read"), 2);
    }

    #[test]
    fn test_tool_error_tracker_multiple_tools_limit_check() {
        let mut tracker = ToolErrorTracker::new(2);
        tracker.record_error("read");
        tracker.record_error("write");
        assert!(!tracker.limit_reached()); // Both at 1

        tracker.record_error("write");
        assert!(tracker.limit_reached()); // Write at 2 >= 2
        assert_eq!(tracker.remaining("read"), 1);
        assert_eq!(tracker.remaining("write"), 0);
    }

    #[test]
    fn test_tool_error_tracker_remaining_unknown_tool() {
        let tracker = ToolErrorTracker::new(5);
        // Never-seen tool should have full budget
        assert_eq!(tracker.remaining("unknown_tool"), 5);
    }

    #[test]
    fn test_extract_exit_code_bracket_format() {
        let output = "some output\n\n[exit code: 0]";
        assert_eq!(extract_shell_exit_code(output), Some(0));
    }

    #[test]
    fn test_extract_exit_code_nonzero() {
        let output = "Traceback...\n\n--- stderr ---\nerror\n\n[exit code: 1]";
        assert_eq!(extract_shell_exit_code(output), Some(1));
    }

    #[test]
    fn test_extract_exit_code_high_value() {
        let output = "fail\n\n[exit code: 42]";
        assert_eq!(extract_shell_exit_code(output), Some(42));
    }

    #[test]
    fn test_extract_exit_code_no_output_format() {
        let output = "Command completed with exit code 0. No output.";
        assert_eq!(extract_shell_exit_code(output), Some(0));
    }

    #[test]
    fn test_extract_exit_code_no_output_nonzero() {
        let output = "Command completed with exit code 127. No output.";
        assert_eq!(extract_shell_exit_code(output), Some(127));
    }

    #[test]
    fn test_extract_exit_code_none_for_unknown_format() {
        let output = "just some random text without exit codes";
        assert_eq!(extract_shell_exit_code(output), None);
    }

    #[tokio::test]
    async fn test_consume_stream_text_only() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (task_tx, mut task_rx) = mpsc::unbounded_channel();

        // Simulate LLM sending text deltas
        tokio::spawn(async move {
            tx.send(LlmStreamEvent::TextDelta("Hello ".into())).ok();
            tx.send(LlmStreamEvent::TextDelta("world!".into())).ok();
            tx.send(LlmStreamEvent::Done { finish_reason: Some("stop".into()) }).ok();
        });

        let orch = make_test_orchestrator(task_tx);
        let result = orch.consume_stream(rx).await.unwrap();

        assert_eq!(result.content, "Hello world!");
        assert!(result.tool_calls.is_empty());
        assert_eq!(result.finish_reason.as_deref(), Some("stop"));

        // Check that events were forwarded
        let mut events = vec![];
        while let Ok(e) = task_rx.try_recv() {
            events.push(e);
        }
        // Should have 2 partial text events + 1 final text event
        let text_events: Vec<_> = events.iter().filter(|e| matches!(e, TaskEvent::Text { .. })).collect();
        assert!(text_events.len() >= 2);
    }

    #[tokio::test]
    async fn test_consume_stream_tool_calls() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (task_tx, _task_rx) = mpsc::unbounded_channel();

        tokio::spawn(async move {
            tx.send(LlmStreamEvent::ToolCallDelta {
                index: 0,
                id: Some("call_1".into()),
                name: Some("read".into()),
                arguments_chunk: r#"{"file"#.into(),
            }).ok();
            tx.send(LlmStreamEvent::ToolCallDelta {
                index: 0,
                id: None,
                name: None,
                arguments_chunk: r#"_path":"/tmp/test"}"#.into(),
            }).ok();
            tx.send(LlmStreamEvent::Done { finish_reason: Some("tool_calls".into()) }).ok();
        });

        let orch = make_test_orchestrator(task_tx);
        let result = orch.consume_stream(rx).await.unwrap();

        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].id, "call_1");
        assert_eq!(result.tool_calls[0].function.name, "read");
        assert_eq!(result.tool_calls[0].function.arguments, r#"{"file_path":"/tmp/test"}"#);
    }

    #[tokio::test]
    async fn test_consume_stream_multiple_tool_calls() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (task_tx, _task_rx) = mpsc::unbounded_channel();

        tokio::spawn(async move {
            tx.send(LlmStreamEvent::ToolCallDelta {
                index: 0,
                id: Some("c1".into()),
                name: Some("read".into()),
                arguments_chunk: r#"{"file_path":"a.txt"}"#.into(),
            }).ok();
            tx.send(LlmStreamEvent::ToolCallDelta {
                index: 1,
                id: Some("c2".into()),
                name: Some("shell".into()),
                arguments_chunk: r#"{"command":"ls"}"#.into(),
            }).ok();
            tx.send(LlmStreamEvent::Done { finish_reason: Some("tool_calls".into()) }).ok();
        });

        let orch = make_test_orchestrator(task_tx);
        let result = orch.consume_stream(rx).await.unwrap();

        assert_eq!(result.tool_calls.len(), 2);
        assert_eq!(result.tool_calls[0].function.name, "read");
        assert_eq!(result.tool_calls[1].function.name, "shell");
    }

    #[tokio::test]
    async fn test_consume_stream_reasoning() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (task_tx, mut task_rx) = mpsc::unbounded_channel();

        tokio::spawn(async move {
            tx.send(LlmStreamEvent::ReasoningDelta("I think ".into())).ok();
            tx.send(LlmStreamEvent::ReasoningDelta("this is ".into())).ok();
            tx.send(LlmStreamEvent::ReasoningDelta("important.".into())).ok();
            tx.send(LlmStreamEvent::TextDelta("The answer is 42.".into())).ok();
            tx.send(LlmStreamEvent::Done { finish_reason: Some("stop".into()) }).ok();
        });

        let orch = make_test_orchestrator(task_tx);
        let result = orch.consume_stream(rx).await.unwrap();

        assert_eq!(result.reasoning, "I think this is important.");
        assert_eq!(result.content, "The answer is 42.");

        let mut events = vec![];
        while let Ok(e) = task_rx.try_recv() {
            events.push(e);
        }
        let reasoning_events: Vec<_> = events.iter().filter(|e| matches!(e, TaskEvent::Reasoning { .. })).collect();
        assert_eq!(reasoning_events.len(), 3);
    }

    #[tokio::test]
    async fn test_consume_stream_error() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (task_tx, _task_rx) = mpsc::unbounded_channel();

        tokio::spawn(async move {
            tx.send(LlmStreamEvent::TextDelta("partial".into())).ok();
            tx.send(LlmStreamEvent::Error("connection lost".into())).ok();
        });

        let orch = make_test_orchestrator(task_tx);
        let result = orch.consume_stream(rx).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("connection lost"));
    }

    #[tokio::test]
    async fn test_consume_stream_empty_done() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (task_tx, _task_rx) = mpsc::unbounded_channel();

        tokio::spawn(async move {
            tx.send(LlmStreamEvent::Done { finish_reason: None }).ok();
        });

        let orch = make_test_orchestrator(task_tx);
        let result = orch.consume_stream(rx).await.unwrap();

        assert!(result.content.is_empty());
        assert!(result.tool_calls.is_empty());
        assert!(result.finish_reason.is_none());
    }

    #[tokio::test]
    async fn test_consume_stream_text_and_tools_mixed() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (task_tx, _task_rx) = mpsc::unbounded_channel();

        // Simulates a degenerate model that emits both content and tool calls
        // (e.g., Gemma 4 hallucinating content before tool results arrive).
        // The orchestrator should discard the hallucinated content.
        tokio::spawn(async move {
            tx.send(LlmStreamEvent::TextDelta("Let me read ".into())).ok();
            tx.send(LlmStreamEvent::TextDelta("the file.".into())).ok();
            tx.send(LlmStreamEvent::ToolCallDelta {
                index: 0,
                id: Some("c1".into()),
                name: Some("read".into()),
                arguments_chunk: r#"{"file_path":"test.txt"}"#.into(),
            }).ok();
            tx.send(LlmStreamEvent::Done { finish_reason: Some("tool_calls".into()) }).ok();
        });

        let orch = make_test_orchestrator(task_tx);
        let result = orch.consume_stream(rx).await.unwrap();

        // Content is discarded when tool calls are present
        assert_eq!(result.content, "");
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].function.name, "read");
    }

    #[tokio::test]
    async fn test_consume_stream_deduplicates_identical_tool_calls() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (task_tx, _task_rx) = mpsc::unbounded_channel();

        // Simulates Gemma 4 emitting the same tool call 5 times
        tokio::spawn(async move {
            for i in 0..5 {
                tx.send(LlmStreamEvent::ToolCallDelta {
                    index: i,
                    id: Some(format!("call_{i}")),
                    name: Some("read".into()),
                    arguments_chunk: r#"{"file_path":"/tmp/test.txt"}"#.into(),
                }).ok();
            }
            tx.send(LlmStreamEvent::Done { finish_reason: Some("tool_calls".into()) }).ok();
        });

        let orch = make_test_orchestrator(task_tx);
        let result = orch.consume_stream(rx).await.unwrap();

        // Should be deduped to 1
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].function.name, "read");
    }

    #[tokio::test]
    async fn test_consume_stream_keeps_distinct_tool_calls() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (task_tx, _task_rx) = mpsc::unbounded_channel();

        tokio::spawn(async move {
            tx.send(LlmStreamEvent::ToolCallDelta {
                index: 0,
                id: Some("c1".into()),
                name: Some("read".into()),
                arguments_chunk: r#"{"file_path":"a.txt"}"#.into(),
            }).ok();
            tx.send(LlmStreamEvent::ToolCallDelta {
                index: 1,
                id: Some("c2".into()),
                name: Some("read".into()),
                arguments_chunk: r#"{"file_path":"b.txt"}"#.into(),
            }).ok();
            tx.send(LlmStreamEvent::Done { finish_reason: Some("tool_calls".into()) }).ok();
        });

        let orch = make_test_orchestrator(task_tx);
        let result = orch.consume_stream(rx).await.unwrap();

        // Different arguments — both kept
        assert_eq!(result.tool_calls.len(), 2);
    }

    #[tokio::test]
    async fn test_consume_stream_caps_tool_calls_at_5() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (task_tx, _task_rx) = mpsc::unbounded_channel();

        // 8 distinct tool calls
        tokio::spawn(async move {
            for i in 0..8 {
                tx.send(LlmStreamEvent::ToolCallDelta {
                    index: i,
                    id: Some(format!("c{i}")),
                    name: Some("read".into()),
                    arguments_chunk: format!(r#"{{"file_path":"file_{i}.txt"}}"#),
                }).ok();
            }
            tx.send(LlmStreamEvent::Done { finish_reason: Some("tool_calls".into()) }).ok();
        });

        let orch = make_test_orchestrator(task_tx);
        let result = orch.consume_stream(rx).await.unwrap();

        // Capped at 5
        assert_eq!(result.tool_calls.len(), 5);
    }

    fn make_test_orchestrator(sender: mpsc::UnboundedSender<TaskEvent>) -> Orchestrator {
        let provider = ProviderConfig {
            id: "test".into(),
            name: "Test".into(),
            endpoint: "http://localhost:11434/v1".into(),
            api_key: None,
            model: "test-model".into(),
            format: None,
            disable_thinking: None,
        };
        let request = TaskRequest {
            id: "test-task".into(),
            prompt: "test".into(),
            scope: TaskScope {
                root_path: "/tmp".into(),
                files: vec![],
                directory: None,
                declarations: vec![],
                description: None,
                blocked_files: vec![],
            },
            role: AgentRole::Implement,
            conversation_id: None,
        };
        Orchestrator::new(&provider, &request, sender)
    }

    fn provider_with(format_hint: &str, disable_thinking: Option<bool>) -> ProviderConfig {
        ProviderConfig {
            id: "test".into(),
            name: "Test".into(),
            endpoint: "http://localhost:11434/v1".into(),
            api_key: None,
            model: format_hint.into(),
            format: None,
            disable_thinking,
        }
    }

    fn test_request() -> TaskRequest {
        TaskRequest {
            id: "t".into(),
            prompt: "noop".into(),
            scope: TaskScope {
                root_path: "/tmp".into(),
                files: vec![],
                directory: None,
                declarations: vec![],
                description: None,
                blocked_files: vec![],
            },
            role: AgentRole::Implement,
            conversation_id: None,
        }
    }

    #[test]
    fn test_no_think_suffix_applied_for_qwen_when_opted_in() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let provider = provider_with("qwen3.6-35b-a3b", Some(true));
        let orch = Orchestrator::new(&provider, &test_request(), tx);
        let sys = orch.context.messages()[0].content.clone();
        assert!(
            sys.contains("/no_think"),
            "Qwen + disable_thinking=true must append /no_think; got:\n{sys}"
        );
    }

    #[test]
    fn test_no_think_suffix_absent_when_opt_out_is_default() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let provider = provider_with("qwen3.6-35b-a3b", None);
        let orch = Orchestrator::new(&provider, &test_request(), tx);
        let sys = orch.context.messages()[0].content.clone();
        assert!(!sys.contains("/no_think"));
    }

    #[tokio::test]
    async fn test_stall_event_fires_when_thresholds_crossed() {
        // Construct an orchestrator and manually push it past the byte
        // threshold via the mid-loop accounting we've made testable.
        // We don't drive a real LLM here; we just simulate the state
        // change the orchestrator would observe in the stall path.
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut orch = make_test_orchestrator(tx);

        // Pretend the last action was 61 s ago.
        orch.last_action_at = Instant::now() - std::time::Duration::from_millis(STALL_WALL_MS + 1_000);
        orch.reasoning_bytes_since_action = STALL_REASONING_BYTES + 1;

        // Run the same one-shot logic the loop runs after consume_stream.
        if !orch.stall_emitted {
            let elapsed = orch.last_action_at.elapsed();
            if elapsed.as_millis() as u64 >= STALL_WALL_MS
                && orch.reasoning_bytes_since_action >= STALL_REASONING_BYTES
            {
                orch.sender
                    .send(TaskEvent::ReasoningStall {
                        elapsed_ms: elapsed.as_millis() as u64,
                        reasoning_bytes: orch.reasoning_bytes_since_action,
                    })
                    .ok();
                orch.stall_emitted = true;
            }
        }

        // The frontend should have received exactly one ReasoningStall.
        let mut stall_events = 0;
        while let Ok(ev) = rx.try_recv() {
            if matches!(ev, TaskEvent::ReasoningStall { .. }) {
                stall_events += 1;
            }
        }
        assert_eq!(stall_events, 1);
        assert!(orch.stall_emitted);
    }

    #[tokio::test]
    async fn test_stall_event_is_one_shot_per_stall() {
        // Once `stall_emitted` is set, the same gap should NOT produce
        // another event. The frontend gets a single signal per stall
        // and a tool call resets the latch.
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut orch = make_test_orchestrator(tx);
        orch.last_action_at = Instant::now() - std::time::Duration::from_secs(120);
        orch.reasoning_bytes_since_action = 16 * 1024;
        orch.stall_emitted = true; // already fired

        // Run the same check.
        if !orch.stall_emitted {
            let elapsed = orch.last_action_at.elapsed();
            if elapsed.as_millis() as u64 >= STALL_WALL_MS
                && orch.reasoning_bytes_since_action >= STALL_REASONING_BYTES
            {
                orch.sender
                    .send(TaskEvent::ReasoningStall {
                        elapsed_ms: elapsed.as_millis() as u64,
                        reasoning_bytes: orch.reasoning_bytes_since_action,
                    })
                    .ok();
            }
        }

        let mut stall_events = 0;
        while let Ok(ev) = rx.try_recv() {
            if matches!(ev, TaskEvent::ReasoningStall { .. }) {
                stall_events += 1;
            }
        }
        assert_eq!(stall_events, 0, "should not re-emit while still stalled");
    }

    #[test]
    fn test_no_think_suffix_only_for_qwen_format() {
        let (tx, _rx) = mpsc::unbounded_channel();
        // Gemma has its own thinking mechanism — the Qwen soft switch shouldn't
        // leak into its prompt even if the user toggles disable_thinking.
        let provider = provider_with("unsloth/gemma-4-26B-A4B-it", Some(true));
        let orch = Orchestrator::new(&provider, &test_request(), tx);
        let sys = orch.context.messages()[0].content.clone();
        assert!(!sys.contains("/no_think"));
    }

}
