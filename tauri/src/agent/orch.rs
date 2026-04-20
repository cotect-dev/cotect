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
    /// Total text + reasoning bytes emitted across turns since the last
    /// successfully-executed tool call. Used to catch the multi-turn
    /// reasoning spiral — per-turn cutoffs (in `consume_stream`) don't
    /// prevent a model from splitting 30 KB of reasoning across three turns
    /// of 10 KB each. The cumulative ceiling is checked in the outer run
    /// loop after each turn.
    bytes_since_last_tool: usize,
    /// Set of tool names that have been invoked (successfully or not) in
    /// this session. Lets the streaming-cutoff reminder be scenario-aware:
    /// if the model has 15 KB of reasoning but hasn't called `write` yet
    /// in a scenario that plainly needs one, the reminder explicitly
    /// suggests it.
    tools_invoked: std::collections::HashSet<String>,
    /// Last shell exit code we observed, if any. Non-zero means the model
    /// should be acting on the error; if the model is instead streaming
    /// reasoning, the cutoff reminder points at the error.
    last_shell_exit_code: Option<i32>,
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
            // 30 turns is enough for even complex refactors when the model
            // stays on task; beyond that it's almost always a spiral. Bumped
            // down from 100 after eval runs showed ≥30-turn scenarios were
            // uniformly pathological (streaming-tail, doom-loop, or both).
            max_turns: 30,
            tool_call_counter: 0,
            bytes_since_last_tool: 0,
            tools_invoked: std::collections::HashSet::new(),
            last_shell_exit_code: None,
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
        let mut streaming_cutoff_count = 0;
        const MAX_EMPTY_TURNS: usize = 3;
        const MAX_STREAM_TIMEOUTS: usize = 2;
        /// How many times the streaming-tail cutoff can fire before we give
        /// up. Two is the sweet spot: one warning, then abort. Higher values
        /// burn per-scenario budget on a model that clearly isn't going to
        /// commit to a tool call.
        const MAX_STREAMING_CUTOFFS: usize = 2;
        /// Cumulative bytes of text+reasoning allowed across *multiple turns*
        /// between tool calls. Catches the spiral where the model splits its
        /// reasoning across turns of just under the per-turn cap, slipping
        /// past the `consume_stream` cutoff. 14 KB ≈ 3 500 tokens — enough
        /// for a genuinely multi-step plan, well short of runaway.
        const MAX_CUMULATIVE_BYTES_BETWEEN_TOOLS: usize = 14_000;

        while !should_yield {
            // 1. Doom loop check — warn at 3 repetitions, abort at 5.
            //    The detector covers four failure modes (exact duplicate calls,
            //    repeating patterns, near-identical calls, thinking-in-shell);
            //    we tailor the reminder when the alarm is specifically the
            //    thinking-in-shell mode because the generic "try a different
            //    approach" wording doesn't actually land for that case.
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
            is_complete = (finish == Some("stop") || finish == Some("end_turn") || finish.is_none())
                && !has_tools;
            should_yield = is_complete;

            // Stream-level problems: idle timeout or abnormal stream termination.
            // "timeout"      — no bytes arrived for COTECT_STREAM_IDLE_TIMEOUT seconds.
            // "stream_ended" — HTTP stream closed without [DONE] marker (server crash,
            //                  KV cache exhaustion, inference error, etc.).
            // Both are transient — retry a few times before giving up.
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
                    // Don't append anything to context — just retry the same turn.
                    // The server may have stalled during reasoning; a fresh request
                    // with the same messages often succeeds.
                    continue;
                }
            } else {
                // Any successful response resets the stream timeout counter.
                stream_timeout_count = 0;
            }

            // Streaming-tail cutoff — fires in either of two cases:
            //   1. `consume_stream` aborted a single stream after >10 KB of
            //      text/reasoning without any tool-call delta (per-turn).
            //   2. The cumulative text+reasoning across turns since the last
            //      tool call exceeded `MAX_CUMULATIVE_BYTES_BETWEEN_TOOLS`.
            //      We detect (2) at end-of-turn below by accumulating bytes;
            //      when it trips we retroactively mark this turn as a cutoff
            //      and fall through to the same handling path.
            let cumulative_cutoff = !has_tools
                && self.bytes_since_last_tool + turn.content.len() + turn.reasoning.len()
                    > MAX_CUMULATIVE_BYTES_BETWEEN_TOOLS;
            let is_cutoff = finish == Some("streaming_tail_cutoff") || cumulative_cutoff;
            if is_cutoff {
                streaming_cutoff_count += 1;
                if streaming_cutoff_count >= MAX_STREAMING_CUTOFFS {
                    let reason = if cumulative_cutoff {
                        format!(
                            "Model streamed {} KB of reasoning across turns without \
                             calling a tool ({streaming_cutoff_count} cutoffs in a row). Stopping.",
                            (self.bytes_since_last_tool + turn.content.len() + turn.reasoning.len()) / 1024,
                        )
                    } else {
                        format!(
                            "Model kept streaming reasoning without calling tools \
                             ({streaming_cutoff_count} cutoffs in a row). Stopping."
                        )
                    };
                    self.sender.send(TaskEvent::Interrupted { reason }).ok();
                    should_yield = true;
                } else {
                    let reminder = self.build_cutoff_reminder(cumulative_cutoff);
                    self.context.inject_system_reminder(&reminder);
                    // Reset the cumulative counter so the next turn gets a
                    // clean budget — otherwise the reminder itself + any
                    // follow-up stream would immediately re-trip.
                    self.bytes_since_last_tool = 0;
                    continue;
                }
            } else if has_tools {
                // Any turn that actually produced tools resets the cutoff streak.
                streaming_cutoff_count = 0;
            }

            // Accumulate bytes toward the cumulative cutoff for the next
            // iteration (only counts turns that didn't produce tools).
            if !has_tools {
                self.bytes_since_last_tool += turn.content.len() + turn.reasoning.len();
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
                        Ok(mut output) => {
                            self.error_tracker.record_success(&tool_call.function.name);
                            // After a successful tool call, compact any prior __format_error__
                            // round-trips out of context to keep conversation clean.
                            self.context.compact_format_errors();

                            // When a shell command exits with a non-zero code, append a
                            // nudge so the model knows it should keep iterating instead
                            // of giving up and producing a final text-only response.
                            if tool_call.function.name == "shell" {
                                if let Some(code) = extract_shell_exit_code(&output) {
                                    self.last_shell_exit_code = Some(code);
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
                    // Record tool usage (for scenario-aware reminders) and
                    // reset the cross-turn reasoning counter — the model
                    // just committed to an action, so the budget refreshes.
                    self.tools_invoked.insert(tool_call.function.name.clone());
                    self.bytes_since_last_tool = 0;
                }
            } else if has_content {
                // Text-only turn — add assistant text to context
                self.context.append_assistant(&turn.content);
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

    /// Build a streaming-cutoff reminder tailored to what we've observed
    /// so far:
    ///
    /// * If the model hasn't used `write` yet, hint that writing might be
    ///   the missing step — catches the failure mode where the scenario
    ///   requires the model to author a file (tests, a new module) and
    ///   it's spending the whole budget reasoning about what to write.
    /// * If the last shell command returned a non-zero exit, point at that
    ///   error — the model is streaming instead of reacting to it.
    /// * Otherwise, the generic "commit to an action" nudge.
    fn build_cutoff_reminder(&self, cumulative: bool) -> String {
        let mut msg = String::with_capacity(640);
        if cumulative {
            msg.push_str(
                "Your reasoning has accumulated past the cumulative budget without \
                 calling a tool. Commit to the next concrete action RIGHT NOW — no \
                 more planning prose."
            );
        } else {
            msg.push_str(
                "Your previous response was cut off because you emitted more than \
                 10 KB of reasoning without calling a tool. Commit to the next \
                 concrete action now. Keep narration to one or two sentences before \
                 the tool call."
            );
        }

        // Scenario-aware hint #1: the model never used `write` — and the
        // scenario probably needs it. Many testing-category scenarios fail
        // this way ("read the source, run the test runner, never author the
        // test file").
        if !self.tools_invoked.contains("write") {
            msg.push_str(
                "\n\nYou have not called `write` in this session. If the task \
                 requires creating a new file (tests, helper module, seed data), \
                 that's almost certainly your next action — call `write` now."
            );
        }

        // Scenario-aware hint #2: a shell command just failed and the
        // model is reasoning rather than reacting.
        if let Some(code) = self.last_shell_exit_code {
            if code != 0 {
                msg.push_str(&format!(
                    "\n\nThe last shell command exited with code {code}. Read the \
                     error message in its output and take a direct corrective \
                     action — do not re-derive what failed through prose."
                ));
            }
        }

        msg
    }

    /// Consume the LLM stream, forwarding text/reasoning to the UI sender
    /// and accumulating tool calls. Returns the full turn result.
    ///
    /// Streaming-tail cutoff: if the model emits more than
    /// `STREAMING_TAIL_BYTE_CUTOFF` bytes of text/reasoning in this turn
    /// without producing any `ToolCallDelta`, the stream is terminated early
    /// with `finish_reason = "streaming_tail_cutoff"`. The outer loop treats
    /// this as a soft interrupt: it injects a system reminder nudging the
    /// model to commit to an action and starts a new turn. Prevents the
    /// "reasoning spiral" failure mode where a model generates 50+ KB of
    /// deliberation between tool calls and burns the per-scenario timeout.
    async fn consume_stream(
        &self,
        mut rx: mpsc::UnboundedReceiver<LlmStreamEvent>,
    ) -> anyhow::Result<LlmTurnResult> {
        /// Maximum bytes of combined text+reasoning allowed in a turn before
        /// the model has emitted any tool-call chunk. 10 KB ≈ 2500 tokens at
        /// ~4 chars/token — enough for rich reasoning, short of a spiral.
        const STREAMING_TAIL_BYTE_CUTOFF: usize = 10_000;

        let mut result = LlmTurnResult::default();
        let mut tool_call_builders: BTreeMap<usize, ToolCallBuilder> = BTreeMap::new();
        let mut bytes_without_tool: usize = 0;
        let mut any_tool_delta = false;
        let mut cutoff_fired = false;

        while let Some(event) = rx.recv().await {
            match event {
                LlmStreamEvent::TextDelta(text) => {
                    result.content.push_str(&text);
                    if !any_tool_delta {
                        bytes_without_tool += text.len();
                    }
                    self.sender
                        .send(TaskEvent::Text {
                            content: text,
                            partial: true,
                        })
                        .ok();
                }
                LlmStreamEvent::ReasoningDelta(text) => {
                    result.reasoning.push_str(&text);
                    if !any_tool_delta {
                        bytes_without_tool += text.len();
                    }
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
                    any_tool_delta = true;
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

            // Streaming-tail cutoff check — abort early if the model is
            // clearly spiralling on reasoning. Dropping `rx` closes the
            // stream on the LLM-client side.
            if !any_tool_delta && bytes_without_tool > STREAMING_TAIL_BYTE_CUTOFF {
                result.finish_reason = Some("streaming_tail_cutoff".into());
                cutoff_fired = true;
                break;
            }
        }

        if cutoff_fired {
            drop(rx);
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

/// Compact a tool result for the conversation context. Keeps the head
/// (commands usually print the important info up front: file list, test
/// summary intro, etc.) and the tail (where shell commands print error
/// messages and the `[exit code: N]` marker). Drops the middle with an
/// explicit truncation marker so the model knows what's happening.
///
/// Triggered above ~8 000 chars — a single `xxd` dump or
/// large-file `cat` can easily dump 50 KB, bloating every subsequent
/// turn's prompt and both slowing inference and encouraging re-derivation.
fn truncate_tool_result_for_context(result: &str) -> String {
    /// Threshold above which we truncate. ~2 000 tokens at ~4 chars/token.
    const MAX_CHARS: usize = 8_000;
    /// How much of the head to keep — the opening of most outputs is the
    /// most meaningful part.
    const HEAD_CHARS: usize = 2_000;
    /// How much of the tail to keep — shell error messages + exit codes
    /// live here.
    const TAIL_CHARS: usize = 4_500;

    if result.len() <= MAX_CHARS {
        return result.to_string();
    }

    // Operate on char boundaries so we don't split a multi-byte sequence.
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

/// Extract the exit code from a shell tool result string.
/// The shell tool embeds the exit code as `[exit code: N]` or
/// `Command completed with exit code N. No output.`.
fn extract_shell_exit_code(output: &str) -> Option<i32> {
    // Try `[exit code: N]` first (most common format)
    if let Some(idx) = output.rfind("[exit code: ") {
        let after = &output[idx + 12..];
        if let Some(end) = after.find(']') {
            if let Ok(code) = after[..end].trim().parse::<i32>() {
                return Some(code);
            }
        }
    }
    // Fallback: `Command completed with exit code N.`
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
    fn test_tool_call_builder_default() {
        let builder = ToolCallBuilder::default();
        assert!(builder.id.is_empty());
        assert!(builder.name.is_empty());
        assert!(builder.arguments.is_empty());
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

    #[test]
    fn test_cutoff_reminder_suggests_write_when_absent() {
        // Baseline: no tools used yet. Reminder should point to `write`
        // since many scenarios that trigger this failure need file creation.
        let (tx, _rx) = mpsc::unbounded_channel::<TaskEvent>();
        let orch = make_test_orchestrator(tx);
        let msg = orch.build_cutoff_reminder(false);
        assert!(msg.contains("not called `write`"), "got: {msg}");
        assert!(msg.contains("call `write` now"), "got: {msg}");
    }

    #[test]
    fn test_cutoff_reminder_omits_write_hint_after_write() {
        let (tx, _rx) = mpsc::unbounded_channel::<TaskEvent>();
        let mut orch = make_test_orchestrator(tx);
        orch.tools_invoked.insert("write".into());
        let msg = orch.build_cutoff_reminder(false);
        assert!(!msg.contains("not called `write`"), "write hint must drop once write was used: {msg}");
    }

    #[test]
    fn test_cutoff_reminder_surfaces_last_nonzero_exit_code() {
        let (tx, _rx) = mpsc::unbounded_channel::<TaskEvent>();
        let mut orch = make_test_orchestrator(tx);
        orch.last_shell_exit_code = Some(1);
        let msg = orch.build_cutoff_reminder(false);
        assert!(msg.contains("exited with code 1"), "got: {msg}");
        assert!(msg.contains("corrective action"), "got: {msg}");
    }

    #[test]
    fn test_cutoff_reminder_ignores_zero_exit_code() {
        let (tx, _rx) = mpsc::unbounded_channel::<TaskEvent>();
        let mut orch = make_test_orchestrator(tx);
        orch.last_shell_exit_code = Some(0);
        let msg = orch.build_cutoff_reminder(false);
        assert!(!msg.contains("exited with code"), "zero exit should not surface: {msg}");
    }

    #[test]
    fn test_cutoff_reminder_cumulative_vs_per_turn_wording_differs() {
        let (tx, _rx) = mpsc::unbounded_channel::<TaskEvent>();
        let orch = make_test_orchestrator(tx);
        let per_turn = orch.build_cutoff_reminder(false);
        let cumulative = orch.build_cutoff_reminder(true);
        assert!(per_turn.contains("10 KB"), "per-turn reminder: {per_turn}");
        assert!(cumulative.contains("cumulative budget"), "cumulative reminder: {cumulative}");
    }

    #[test]
    fn test_fresh_orchestrator_has_zero_accumulated_bytes() {
        // Guard: the cumulative counter must start at 0 so a single
        // slightly-chatty turn doesn't immediately trip the cutoff.
        let (tx, _rx) = mpsc::unbounded_channel::<TaskEvent>();
        let orch = make_test_orchestrator(tx);
        assert_eq!(orch.bytes_since_last_tool, 0);
        assert!(orch.tools_invoked.is_empty());
        assert!(orch.last_shell_exit_code.is_none());
    }
}
