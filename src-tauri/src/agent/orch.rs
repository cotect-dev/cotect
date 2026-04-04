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
    sender: mpsc::Sender<TaskEvent>,
    error_tracker: ToolErrorTracker,
    doom_detector: DoomLoopDetector,
    max_turns: usize,
}

impl Orchestrator {
    pub fn new(
        provider: &ProviderConfig,
        request: &TaskRequest,
        sender: mpsc::Sender<TaskEvent>,
    ) -> Self {
        let llm = LlmClient::new(provider);
        let tool_defs = tools::definitions_for_role(request.role);
        let tool_state = ToolState::new(request.scope.root_path.clone());

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
        }
    }

    /// Run the orchestration loop until completion, interruption, or error.
    pub async fn run(&mut self) -> anyhow::Result<()> {
        let mut should_yield = false;
        let mut is_complete = false;
        let mut turn_count = 0;

        while !should_yield {
            // 1. Doom loop check
            if let Some(count) = self.doom_detector.check() {
                self.context.inject_system_reminder(&format!(
                    "You have repeated the same tool call pattern {count} times. \
                     You are stuck in a loop. Try a completely different approach."
                ));
            }

            // 2. Call LLM with retry
            let messages = self.context.messages().to_vec();
            let tool_defs = self.context.tool_definitions().to_vec();

            let rx = retry_with_backoff(
                || self.llm.chat_stream(messages.clone(), Some(tool_defs.clone()), 0.5),
                3,
                500,
            )
            .await?;

            // 3. Consume stream, forwarding deltas to frontend
            let turn = self.consume_stream(rx).await?;

            // 4. Determine completion
            is_complete = turn.finish_reason.as_deref() == Some("stop") && turn.tool_calls.is_empty();
            should_yield = is_complete;

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
                        })
                        .await
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
                        .await
                        .ok();

                    // Build tool result message with error budget info
                    let tool_result_text = match result {
                        Ok(output) => {
                            self.error_tracker.record_success(&tool_call.function.name);
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
            } else {
                // No tool calls — add assistant text to context
                self.context.append_assistant(&turn.content, &turn.reasoning);
            }

            // 7. Error budget check
            if self.error_tracker.limit_reached() {
                self.sender
                    .send(TaskEvent::Interrupted {
                        reason: "Too many tool errors. Stopping.".into(),
                    })
                    .await
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
                    .await
                    .ok();
                should_yield = true;
            }

            // 9. Context compaction check
            if self.context.estimated_tokens() > self.context.compaction_threshold() {
                self.context.compact();
            }
        }

        if is_complete {
            self.sender.send(TaskEvent::Complete).await.ok();
        }

        Ok(())
    }

    /// Consume the LLM stream, forwarding text/reasoning to the UI sender
    /// and accumulating tool calls. Returns the full turn result.
    async fn consume_stream(
        &self,
        mut rx: mpsc::Receiver<LlmStreamEvent>,
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
                        .await
                        .ok();
                }
                LlmStreamEvent::ReasoningDelta(text) => {
                    result.reasoning.push_str(&text);
                    self.sender
                        .send(TaskEvent::Reasoning { content: text })
                        .await
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
        for (_, builder) in tool_call_builders {
            result.tool_calls.push(ToolCall {
                id: builder.id,
                call_type: "function".into(),
                function: FunctionCall {
                    name: builder.name,
                    arguments: builder.arguments,
                },
            });
        }

        // Send final text if any accumulated
        if !result.content.is_empty() {
            self.sender
                .send(TaskEvent::Text {
                    content: result.content.clone(),
                    partial: false,
                })
                .await
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
}
