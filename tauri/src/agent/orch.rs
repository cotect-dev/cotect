use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

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
pub struct Orchestrator {
    llm: LlmClient,
    context: ConversationContext,
    tool_state: Arc<ToolState>,
    sender: mpsc::UnboundedSender<TaskEvent>,
    error_tracker: ToolErrorTracker,
    doom_detector: DoomLoopDetector,
    max_turns: usize,
    tool_call_counter: usize,
}

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

        // Build system prompt with scope context
        let env = EnvironmentInfo {
            cwd: request.scope.root_path.clone(),
            ..EnvironmentInfo::default()
        };

        let system_prompt = system_prompt::build_system_prompt(
            request.role,
            &request.scope,
            &env,
            &[], // File contents are loaded lazily by the agent via read tool
            None,
        );

        let mut context = ConversationContext::new(system_prompt, tool_defs);
        context.append_user(&request.prompt);

        Self {
            llm,
            context,
            tool_state,
            sender,
            error_tracker: ToolErrorTracker::new(5),
            doom_detector: DoomLoopDetector::default(),
            max_turns: 100,
            tool_call_counter: 0,
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
        const MAX_EMPTY_TURNS: usize = 3;

        while !should_yield {
            // 1. Doom loop check — warn at 3 repetitions, abort at 5
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
                self.context.inject_system_reminder(&format!(
                    "You have repeated the same tool call pattern {count} times. \
                     You are stuck in a loop. Try a completely different approach — \
                     for example, use the write tool to rewrite the whole file instead of patching."
                ));
            }

            // 2. Call LLM with retry
            let messages = self.context.messages().to_vec();
            let tool_defs = self.context.tool_definitions().to_vec();

            let rx = retry_with_backoff(
                || self.llm.chat_stream(messages.clone(), Some(tool_defs.clone()), 1.0),
                3,
                500,
            )
            .await?;

            // 3. Consume stream, forwarding deltas to frontend
            let mut turn = self.consume_stream(rx).await?;

            // 3b. Remap tool call IDs to simple sequential format (call_N).
            // Some servers (OpenAI, llama.cpp) generate 32-char random alphanumeric
            // IDs that some models (Gemma 4) echo back as text when confused by
            // tool-call templates. Short, predictable IDs reduce this confusion.
            for tool_call in turn.tool_calls.iter_mut() {
                self.tool_call_counter += 1;
                tool_call.id = format!("call_{}", self.tool_call_counter);
            }

            // 4. Determine completion
            let finish = turn.finish_reason.as_deref();
            let has_tools = !turn.tool_calls.is_empty();
            let has_content = !turn.content.trim().is_empty();

            // "stop", "end_turn", or stream ended cleanly (None) with no tool calls = done
            is_complete = (finish == Some("stop") || finish == Some("end_turn")
                || (finish.is_none() && !has_tools))
                && !has_tools;
            should_yield = is_complete;

            // Stream-level timeout: the server stopped sending bytes mid-stream.
            // Don't retry — the inference server is stalled.
            if finish == Some("timeout") {
                self.sender
                    .send(TaskEvent::Interrupted {
                        reason: "LLM server stopped responding (stream idle timeout).".into(),
                    })
                    .ok();
                should_yield = true;
            }

            // If the model hit its token limit with no tool calls, treat it as
            // a yield — the model ran out of generation budget. Continuing would
            // just loop endlessly (common with reasoning-heavy models like Gemma 4).
            if finish == Some("length") && !has_tools {
                if has_content {
                    // Got partial content — treat as complete, user can see what was generated
                    is_complete = true;
                    should_yield = true;
                } else {
                    // No content, no tools — the model spent everything on reasoning.
                    // Inject a nudge and allow one more try, but track empty turns.
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

            // Track consecutive empty turns (no content, no tools) for any finish reason
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

            // 5. Execute tool calls sequentially
            if !turn.tool_calls.is_empty() {
                // Add assistant message with tool calls to context
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

                    // Build tool result message with error budget info
                    let tool_result_text = match result {
                        Ok(output) => {
                            self.error_tracker.record_success(&tool_call.function.name);
                            // After a successful tool call, compact any prior __format_error__
                            // round-trips out of context to keep conversation clean.
                            self.context.compact_format_errors();
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

                    self.context
                        .append_tool_result(&tool_call.id, &tool_result_text);

                    self.doom_detector
                        .record(&tool_call.function.name, &tool_call.function.arguments);
                }
            } else if has_content {
                // Text-only turn — add assistant text to context
                self.context.append_assistant(&turn.content, &turn.reasoning);
            }
            // else: empty turn (no content, no tools) — skip appending.
            // Appending an empty assistant message would cause the next request to
            // have a trailing assistant message, which some servers reject as a
            // "prefill" (e.g. Gemma 4 with enable_thinking: 400 Bad Request).
            // The empty_turn_count tracker above already handles bailing out.

            // 7. Error budget check
            if self.error_tracker.limit_reached() {
                self.sender
                    .send(TaskEvent::Interrupted {
                        reason: "Too many tool errors. Stopping.".into(),
                    })
                    .ok();
                should_yield = true;
            }

            // 8. Turn limit check
            turn_count += 1;
            if turn_count >= self.max_turns {
                self.sender
                    .send(TaskEvent::Interrupted {
                        reason: format!("Reached maximum turn limit ({}).", self.max_turns),
                    })
                    .ok();
                should_yield = true;
            }

            // 9. Context compaction check
            if self.context.estimated_tokens() > self.context.compaction_threshold() {
                self.context.compact();
            }
        }

        if is_complete {
            self.sender.send(TaskEvent::Complete).ok();
        }

        Ok(())
    }

    /// Consume the LLM stream, forwarding text/reasoning to the UI sender
    /// and accumulating tool calls. Returns the full turn result.
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

        // Finalize tool calls from builders (BTreeMap iterates in order)
        // Deduplicate by (name, arguments) to handle models that emit the same
        // tool call multiple times in a single response (e.g., Gemma 4 26B)
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

        // Cap tool calls per turn to prevent runaway models
        const MAX_TOOL_CALLS_PER_TURN: usize = 5;
        if result.tool_calls.len() > MAX_TOOL_CALLS_PER_TURN {
            result.tool_calls.truncate(MAX_TOOL_CALLS_PER_TURN);
        }

        // If the model emitted both content and tool_calls, discard the content
        // — it's likely hallucinated (the model guessed the answer before seeing
        // tool results). This is common with Gemma 4 and similar models.
        if !result.tool_calls.is_empty() && !result.content.is_empty() {
            result.content.clear();
        }

        // Send final text if any accumulated
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
    fn test_tool_call_builder_default() {
        let builder = ToolCallBuilder::default();
        assert!(builder.id.is_empty());
        assert!(builder.name.is_empty());
        assert!(builder.arguments.is_empty());
    }

    // ─── Error tracker edge cases ───────────────────────────────────────

    #[test]
    fn test_tool_error_tracker_zero_limit() {
        let tracker = ToolErrorTracker::new(0);
        // With limit 0, no errors are allowed
        assert!(tracker.limit_reached() == false); // No errors recorded yet
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

    // ─── consume_stream tests ───────────────────────────────────────────

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

    // ─── Dedup and cap tests ─────────────────────────────────────────────

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

    // ─── Helper ─────────────────────────────────────────────────────────

    fn make_test_orchestrator(sender: mpsc::UnboundedSender<TaskEvent>) -> Orchestrator {
        let provider = ProviderConfig {
            id: "test".into(),
            name: "Test".into(),
            endpoint: "http://localhost:11434/v1".into(),
            api_key: None,
            model: "test-model".into(),
            format: None,
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
}
