//! Qwen adapter — enhanced parser for Qwen's native output.
//!
//! Uses the standard `/v1/chat/completions` OpenAI-compatible endpoint (works
//! with any server: llama.cpp, vLLM, Ollama, etc.) but adds Qwen-specific
//! response parsing:
//!
//! - **Thinking-token stripping**: Qwen 3/3.5 emits `<think>...</think>` blocks
//!   in the `content` field (even through OpenAI-compat APIs). These need to be
//!   separated into `ReasoningDelta` events.
//!
//! - **Raw tool-call token filtering**: Some servers leak raw Qwen tool-call
//!   tokens (`<tool_call>{"name":...}</tool_call>`) into the `content` field
//!   alongside structured `tool_calls` in the response. We filter these out of
//!   text content.
//!
//! - **Native tool-call fallback**: When the server doesn't provide structured
//!   `tool_calls`, we parse Qwen's Hermes-style `<tool_call>\n{"name":"func",
//!   "arguments":{...}}\n</tool_call>` syntax from the text content.
//!
//! - **Format error recovery**: When a tool call can't be parsed (e.g., malformed
//!   JSON), we emit a `__format_error__` sentinel that the tool executor rejects
//!   with a helpful error message, prompting the model to retry with correct JSON.

use serde_json::Value;

use super::super::types::{ChatMessage, LlmStreamEvent, ToolDefinition};
use super::{
    ModelAdapter, StreamChunk, StreamParser,
    build_openai_request_body, emit_format_error, safe_emit_len, safe_emit_len_multi,
    strip_paired_blocks, strip_tag_pairs,
};


pub struct QwenAdapter;

impl ModelAdapter for QwenAdapter {
    fn name(&self) -> &'static str {
        "qwen"
    }

    fn endpoint_path(&self) -> &'static str {
        "/chat/completions"
    }

    fn build_request_body(
        &self,
        model: &str,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
        temperature: f32,
        max_tokens: u32,
    ) -> Value {
        build_openai_request_body(model, messages, tools, temperature, max_tokens)
    }

    fn new_stream_parser(&self) -> Box<dyn StreamParser> {
        Box::new(QwenStreamParser::new())
    }
}


/// Stream parser for Qwen 3/3.5 responses via OpenAI-compat API.
///
/// Wraps the standard OpenAI SSE format but adds:
/// 1. Thinking-token stripping from `content` field (`<think>...</think>`)
/// 2. Raw tool-call token filtering from `content`
/// 3. Fallback native tool-call parsing when server doesn't provide structured calls
pub(crate) struct QwenStreamParser {
    /// Buffer for text content (may contain partial Qwen tokens).
    text_buffer: String,
    /// Accumulated raw text for fallback tool-call parsing.
    /// Preserves raw Qwen tokens that were stripped from text_buffer.
    accumulated_text: String,
    /// Whether we've emitted Done.
    done_emitted: bool,
    /// Whether we're inside a `<think>` block.
    in_thinking: bool,
    /// Whether we've received any structured tool_calls from the server.
    has_structured_tool_calls: bool,
    /// Tool call index counter for fallback parsing.
    fallback_tool_index: usize,
}

impl QwenStreamParser {
    pub fn new() -> Self {
        Self {
            text_buffer: String::new(),
            accumulated_text: String::new(),
            done_emitted: false,
            in_thinking: false,
            has_structured_tool_calls: false,
            fallback_tool_index: 0,
        }
    }
}

impl StreamParser for QwenStreamParser {
    fn process_sse_data(&mut self, data: &str) -> Vec<LlmStreamEvent> {
        let mut events = Vec::new();

        if data == "[DONE]" {
            if !self.done_emitted {
                events.push(LlmStreamEvent::Done {
                    finish_reason: None,
                });
                self.done_emitted = true;
            }
            return events;
        }

        let chunk = match serde_json::from_str::<StreamChunk>(data) {
            Ok(c) => c,
            Err(_) => return events,
        };

        for choice in &chunk.choices {
            // Process reasoning content (standard OpenAI field — used by some
            // servers that natively support Qwen's thinking mode)
            if let Some(reasoning) = &choice.delta.reasoning_content {
                if !reasoning.is_empty() {
                    events.push(LlmStreamEvent::ReasoningDelta(reasoning.clone()));
                }
            }

            // Process text content — filter Qwen tokens
            if let Some(text) = &choice.delta.content {
                if !text.is_empty() {
                    self.text_buffer.push_str(text);
                    self.drain_text_buffer(&mut events);
                }
            }

            // Process structured tool calls (from server)
            if let Some(tool_calls) = &choice.delta.tool_calls {
                self.has_structured_tool_calls = true;
                for tc in tool_calls {
                    let func = tc.function.as_ref();
                    events.push(LlmStreamEvent::ToolCallDelta {
                        index: tc.index,
                        id: tc.id.clone(),
                        name: func.and_then(|f| f.name.clone()),
                        arguments_chunk: func
                            .and_then(|f| f.arguments.clone())
                            .unwrap_or_default(),
                    });
                }
            }

            // Process finish reason
            if let Some(reason) = &choice.finish_reason {
                // Before emitting Done, flush buffer and check for fallback
                // tool call parsing if no structured calls were received
                self.flush_remaining(&mut events);

                events.push(LlmStreamEvent::Done {
                    finish_reason: Some(reason.clone()),
                });
                self.done_emitted = true;
            }
        }

        events
    }

    fn finalize(&mut self) -> Vec<LlmStreamEvent> {
        let mut events = Vec::new();
        self.flush_remaining(&mut events);
        if !self.done_emitted {
            self.done_emitted = true;
            // Stream ended without [DONE] or finish_reason — this is an
            // abnormal termination (server crashed, KV cache exhausted, etc.).
            // Report as "stream_ended" so the orchestrator can distinguish
            // this from a genuine model completion and retry the turn.
            events.push(LlmStreamEvent::Done {
                finish_reason: Some("stream_ended".to_string()),
            });
        }
        events
    }
}

impl QwenStreamParser {
    /// Process text buffer: strip thinking tokens and filter raw tool-call tokens.
    fn drain_text_buffer(&mut self, events: &mut Vec<LlmStreamEvent>) {
        loop {
            if self.in_thinking {
                // Look for end of thinking block
                if let Some(pos) = self.text_buffer.find("</think>") {
                    let reasoning = self.text_buffer[..pos].to_string();
                    self.text_buffer.drain(..pos + "</think>".len());
                    self.in_thinking = false;
                    if !reasoning.is_empty() {
                        events.push(LlmStreamEvent::ReasoningDelta(reasoning));
                    }
                    // Skip any trailing newlines after </think>
                    let trimmed = self.text_buffer.trim_start_matches('\n');
                    let skip = self.text_buffer.len() - trimmed.len();
                    if skip > 0 {
                        self.text_buffer.drain(..skip);
                    }
                    continue;
                }
                // Partial — emit safe reasoning content
                let safe = safe_emit_len(&self.text_buffer, "</think>");
                if safe > 0 {
                    let reasoning: String = self.text_buffer.drain(..safe).collect();
                    events.push(LlmStreamEvent::ReasoningDelta(reasoning));
                }
                return;
            }

            // Check for thinking block start
            if let Some(pos) = self.text_buffer.find("<think>") {
                if pos > 0 {
                    let text: String = self.text_buffer.drain(..pos).collect();
                    let clean = strip_raw_tool_tokens(&text);
                    if !clean.is_empty() {
                        events.push(LlmStreamEvent::TextDelta(clean));
                    }
                }
                self.text_buffer.drain(.."<think>".len());
                self.in_thinking = true;
                // Skip leading newline after <think>
                if self.text_buffer.starts_with('\n') {
                    self.text_buffer.drain(..1);
                }
                continue;
            }

            // Check for raw tool-call tokens that should be filtered from text
            // (these appear when the server leaks Qwen's native format into content)
            if let Some(pos) = self.text_buffer.find("<tool_call>") {
                // Emit clean text before the token
                if pos > 0 {
                    let text: String = self.text_buffer.drain(..pos).collect();
                    if !text.is_empty() {
                        events.push(LlmStreamEvent::TextDelta(text));
                    }
                }
                // Check if we have the closing tag too
                if let Some(end) = self.text_buffer.find("</tool_call>") {
                    // Complete raw tool-call token — strip from text output
                    // but save to accumulated_text for fallback parsing
                    let raw_tc: String = self.text_buffer.drain(..end + "</tool_call>".len()).collect();
                    self.accumulated_text.push_str(&raw_tc);
                    continue;
                }
                // Partial — keep in buffer, wait for more data
                return;
            }

            // Also filter <tool_response>...</tool_response> tokens
            if let Some(pos) = self.text_buffer.find("<tool_response>") {
                if pos > 0 {
                    let text: String = self.text_buffer.drain(..pos).collect();
                    if !text.is_empty() {
                        events.push(LlmStreamEvent::TextDelta(text));
                    }
                }
                if let Some(end) = self.text_buffer.find("</tool_response>") {
                    self.text_buffer.drain(..end + "</tool_response>".len());
                    continue;
                }
                return;
            }

            // No markers found — emit text safely
            let safe = safe_emit_len_multi(
                &self.text_buffer,
                &[
                    "<think>",
                    "</think>",
                    "<tool_call>",
                    "</tool_call>",
                    "<tool_response>",
                    "</tool_response>",
                ],
            );
            if safe == 0 {
                return;
            }
            let text: String = self.text_buffer.drain(..safe).collect();
            if !text.is_empty() {
                events.push(LlmStreamEvent::TextDelta(text));
            }
            return;
        }
    }

    /// Flush remaining buffer content at end of stream.
    /// If no structured tool calls were received, attempt fallback parsing.
    fn flush_remaining(&mut self, events: &mut Vec<LlmStreamEvent>) {
        // First, check accumulated_text (raw tool tokens stripped during streaming)
        if !self.has_structured_tool_calls && !self.accumulated_text.is_empty() {
            let accumulated = std::mem::take(&mut self.accumulated_text);
            self.parse_all_tool_calls(&accumulated, events);
        }

        if self.text_buffer.is_empty() {
            return;
        }

        let raw_buf = std::mem::take(&mut self.text_buffer);
        let text = strip_thinking(&raw_buf);

        // Check for fallback tool parsing BEFORE stripping tool tokens,
        // so we can still extract tool calls from the raw text
        if !self.has_structured_tool_calls && contains_tool_call_pattern(&text) {
            self.parse_all_tool_calls(&text, events);
            return;
        }

        let text = strip_raw_tool_tokens(&text);
        if !text.is_empty() {
            events.push(LlmStreamEvent::TextDelta(text));
        }
    }

    /// Parse all `<tool_call>...</tool_call>` blocks from text.
    /// Qwen can emit multiple tool calls in a single response.
    fn parse_all_tool_calls(&mut self, text: &str, events: &mut Vec<LlmStreamEvent>) {
        let mut remaining = text;
        let mut found_any = false;

        while let Some(start) = remaining.find("<tool_call>") {
            let after = &remaining[start + "<tool_call>".len()..];
            let (tc_content, rest) = if let Some(end) = after.find("</tool_call>") {
                (&after[..end], &after[end + "</tool_call>".len()..])
            } else {
                // No closing tag — try parsing the rest
                (after.trim(), "")
            };

            let tc_content = tc_content.trim();
            if !tc_content.is_empty() {
                found_any = true;
                self.emit_single_tool_call(tc_content, events);
            }

            remaining = rest;
        }

        // If no <tool_call> tags found, try bare JSON parsing
        if !found_any {
            let trimmed = text.trim();
            if trimmed.starts_with('{') && trimmed.contains("\"name\"") {
                self.emit_single_tool_call(trimmed, events);
            } else if !trimmed.is_empty() {
                // Not a tool call — emit as text
                let clean = strip_raw_tool_tokens(trimmed);
                if !clean.is_empty() {
                    events.push(LlmStreamEvent::TextDelta(clean));
                }
            }
        }
    }

    /// Try to parse and emit a single tool call from content.
    fn emit_single_tool_call(&mut self, content: &str, events: &mut Vec<LlmStreamEvent>) {
        let idx = self.fallback_tool_index;
        self.fallback_tool_index += 1;

        match parse_qwen_tool_call(content) {
            Ok((name, args_json)) => {
                events.push(LlmStreamEvent::ToolCallDelta {
                    index: idx,
                    id: Some(format!("call_{}", idx + 1)),
                    name: Some(name),
                    arguments_chunk: args_json,
                });
            }
            Err(parse_err) => {
                events.push(emit_format_error(idx, content, &parse_err));
            }
        }
    }
}


/// Parse a tool call from Qwen's output. Qwen uses Hermes-style tool calls:
///
/// ```text
/// <tool_call>
/// {"name": "function_name", "arguments": {"arg1": "value1"}}
/// </tool_call>
/// ```
///
/// The JSON object has two fields:
/// - `name`: the function name (string)
/// - `arguments`: the function arguments (object)
///
/// Returns `(tool_name, arguments_as_json_string)` or an error.
fn parse_qwen_tool_call(input: &str) -> Result<(String, String), String> {
    let input = input.trim();

    if input.is_empty() {
        return Err("Empty tool call content".to_string());
    }

    // Qwen's native format is always JSON:
    // {"name": "func_name", "arguments": {"key": "value"}}
    if let Ok(obj) = serde_json::from_str::<serde_json::Map<String, Value>>(input) {
        if let (Some(Value::String(name)), Some(args)) =
            (obj.get("name"), obj.get("arguments"))
        {
            let args_json = serde_json::to_string(args).unwrap_or_else(|_| "{}".to_string());
            return Ok((name.clone(), args_json));
        }
        // Has JSON but not in expected shape
        return Err(format!(
            "JSON object missing 'name' (string) or 'arguments' field. Got keys: {:?}",
            obj.keys().collect::<Vec<_>>()
        ));
    }

    // Try to salvage partial/malformed JSON — find the first '{' and attempt parse
    if let Some(brace_pos) = input.find('{') {
        let json_part = &input[brace_pos..];
        // Try to find matching closing brace
        if let Some(json_str) = extract_balanced_json(json_part) {
            if let Ok(obj) = serde_json::from_str::<serde_json::Map<String, Value>>(&json_str) {
                if let (Some(Value::String(name)), Some(args)) =
                    (obj.get("name"), obj.get("arguments"))
                {
                    let args_json =
                        serde_json::to_string(args).unwrap_or_else(|_| "{}".to_string());
                    return Ok((name.clone(), args_json));
                }
            }
        }
    }

    Err(format!(
        "Could not parse tool call JSON. Expected format: \
         {{\"name\": \"function_name\", \"arguments\": {{...}}}}. Got: {}",
        if input.len() > 200 {
            format!("{}...", &input[..200])
        } else {
            input.to_string()
        }
    ))
}

/// Extract a balanced JSON object string starting from the first '{'.
fn extract_balanced_json(input: &str) -> Option<String> {
    let mut depth = 0;
    let mut in_string = false;
    let mut escape_next = false;

    for (i, c) in input.char_indices() {
        if escape_next {
            escape_next = false;
            continue;
        }
        if c == '\\' && in_string {
            escape_next = true;
            continue;
        }
        if c == '"' {
            in_string = !in_string;
            continue;
        }
        if in_string {
            continue;
        }
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(input[..=i].to_string());
                }
            }
            _ => {}
        }
    }
    None
}


/// Strip `<think>...</think>` blocks from text.
fn strip_thinking(text: &str) -> String {
    strip_paired_blocks(text, "<think>", "</think>", true)
}

/// Strip raw Qwen tool-call tokens from text.
/// Removes `<tool_call>...</tool_call>` and `<tool_response>...</tool_response>`.
fn strip_raw_tool_tokens(text: &str) -> String {
    strip_tag_pairs(text, &[
        ("<tool_call>", "</tool_call>"),
        ("<tool_response>", "</tool_response>"),
    ])
}

/// Check if text contains a tool-call pattern that needs fallback parsing.
fn contains_tool_call_pattern(text: &str) -> bool {
    text.contains("<tool_call>")
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::types::FunctionDef;

    fn tool_def(name: &str) -> ToolDefinition {
        ToolDefinition {
            def_type: "function".into(),
            function: FunctionDef {
                name: name.into(),
                description: "desc".into(),
                parameters: serde_json::json!({}),
            },
        }
    }


    #[test]
    fn parse_hermes_style_tool_call() {
        let (name, args) = parse_qwen_tool_call(
            r#"{"name": "read", "arguments": {"file_path": "/tmp/test.txt"}}"#,
        )
        .unwrap();
        assert_eq!(name, "read");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(parsed["file_path"], "/tmp/test.txt");
    }

    #[test]
    fn parse_multi_arg_tool_call() {
        let (name, args) = parse_qwen_tool_call(
            r#"{"name": "patch", "arguments": {"file_path": "/tmp/foo.txt", "new_string": "goodbye", "old_string": "hello"}}"#,
        )
        .unwrap();
        assert_eq!(name, "patch");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(parsed["file_path"], "/tmp/foo.txt");
        assert_eq!(parsed["new_string"], "goodbye");
        assert_eq!(parsed["old_string"], "hello");
    }

    #[test]
    fn parse_nested_json_args() {
        let (name, args) = parse_qwen_tool_call(
            r#"{"name": "tool", "arguments": {"config": {"key": "value", "nested": true}}}"#,
        )
        .unwrap();
        assert_eq!(name, "tool");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert!(parsed["config"].is_object());
    }

    #[test]
    fn parse_empty_content_is_error() {
        let result = parse_qwen_tool_call("");
        assert!(result.is_err());
    }

    #[test]
    fn parse_invalid_json_is_error() {
        let result = parse_qwen_tool_call("not json at all");
        assert!(result.is_err());
    }

    #[test]
    fn parse_missing_name_field_is_error() {
        let result = parse_qwen_tool_call(r#"{"arguments": {"key": "val"}}"#);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("missing"));
    }

    #[test]
    fn parse_salvage_json_with_prefix() {
        // Sometimes models emit text before the JSON
        let (name, args) =
            parse_qwen_tool_call(r#"Sure, let me call: {"name": "shell", "arguments": {"command": "ls"}}"#)
                .unwrap();
        assert_eq!(name, "shell");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(parsed["command"], "ls");
    }


    #[test]
    fn strip_thinking_block() {
        let input = "<think>\nI should read the file.\n</think>\nThe answer is 42.";
        assert_eq!(strip_thinking(input), "The answer is 42.");
    }

    #[test]
    fn strip_multiple_thinking_blocks() {
        let input = "<think>think1</think>\ntext1<think>think2</think>\ntext2";
        assert_eq!(strip_thinking(input), "text1text2");
    }

    #[test]
    fn strip_thinking_preserves_plain_text() {
        assert_eq!(strip_thinking("Hello world"), "Hello world");
    }

    #[test]
    fn strip_thinking_handles_empty_block() {
        let input = "<think></think>\nHello";
        assert_eq!(strip_thinking(input), "Hello");
    }


    #[test]
    fn strip_raw_tool_call_tokens() {
        let input =
            r#"text before<tool_call>{"name":"shell","arguments":{"cmd":"ls"}}</tool_call>text after"#;
        assert_eq!(strip_raw_tool_tokens(input), "text beforetext after");
    }

    #[test]
    fn strip_raw_tool_response_tokens() {
        let input = "before<tool_response>result here</tool_response>after";
        assert_eq!(strip_raw_tool_tokens(input), "beforeafter");
    }

    #[test]
    fn strip_nothing_from_clean_text() {
        assert_eq!(strip_raw_tool_tokens("plain text"), "plain text");
    }


    #[test]
    fn parse_openai_text_delta() {
        let mut parser = QwenStreamParser::new();
        let events = parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}"#,
        );
        assert!(events.iter().any(|e| matches!(e, LlmStreamEvent::TextDelta(t) if t == "Hello")));
    }

    #[test]
    fn parse_openai_reasoning_delta() {
        let mut parser = QwenStreamParser::new();
        let events = parser.process_sse_data(
            r#"{"choices":[{"delta":{"reasoning_content":"thinking..."},"finish_reason":null}]}"#,
        );
        assert!(events
            .iter()
            .any(|e| matches!(e, LlmStreamEvent::ReasoningDelta(t) if t == "thinking...")));
    }

    #[test]
    fn parse_openai_tool_call_delta() {
        let mut parser = QwenStreamParser::new();
        let events = parser.process_sse_data(
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"shell","arguments":"{\"command\":\"ls\"}"}}]},"finish_reason":null}]}"#,
        );
        assert!(events.iter().any(|e| matches!(
            e,
            LlmStreamEvent::ToolCallDelta { name: Some(n), .. } if n == "shell"
        )));
        assert!(parser.has_structured_tool_calls);
    }

    #[test]
    fn parse_openai_done() {
        let mut parser = QwenStreamParser::new();
        let events = parser.process_sse_data(
            r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        );
        assert!(events.iter().any(|e| matches!(e, LlmStreamEvent::Done { .. })));
    }

    #[test]
    fn parse_done_marker() {
        let mut parser = QwenStreamParser::new();
        let events = parser.process_sse_data("[DONE]");
        assert!(events.iter().any(|e| matches!(e, LlmStreamEvent::Done { .. })));
    }

    #[test]
    fn filter_thinking_from_content() {
        let mut parser = QwenStreamParser::new();
        let events = parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"<think>\nI think...\n</think>\nThe answer"},"finish_reason":null}]}"#,
        );
        assert!(events
            .iter()
            .any(|e| matches!(e, LlmStreamEvent::ReasoningDelta(t) if t.contains("think"))));
        assert!(events
            .iter()
            .any(|e| matches!(e, LlmStreamEvent::TextDelta(t) if t.contains("answer"))));
        // Should NOT have raw thinking tokens in text
        assert!(!events
            .iter()
            .any(|e| matches!(e, LlmStreamEvent::TextDelta(t) if t.contains("<think>"))));
    }

    #[test]
    fn filter_raw_tool_tokens_from_content() {
        let mut parser = QwenStreamParser::new();
        // Simulate server leaking raw tool tokens into content
        let e1 = parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"<tool_call>\n{\"name\":\"shell\",\"arguments\":{\"cmd\":\"ls\"}}\n</tool_call>"},"finish_reason":null}]}"#,
        );
        // Should filter out the raw tokens
        assert!(!e1
            .iter()
            .any(|e| matches!(e, LlmStreamEvent::TextDelta(t) if t.contains("shell"))));
    }

    #[test]
    fn fallback_parse_when_no_structured_calls() {
        let mut parser = QwenStreamParser::new();
        // Model emits a tool call as text (no structured tool_calls from server)
        let _e1 = parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"<tool_call>\n{\"name\": \"shell\", \"arguments\": {\"command\": \"ls\"}}\n</tool_call>"},"finish_reason":null}]}"#,
        );
        // Now finish without structured tool_calls
        let e2 = parser.process_sse_data(
            r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        );
        // Should have fallback-parsed the tool call
        assert!(e2.iter().any(|e| matches!(
            e,
            LlmStreamEvent::ToolCallDelta { name: Some(n), .. } if n == "shell"
        )));
    }

    #[test]
    fn fallback_parse_multiple_tool_calls() {
        let mut parser = QwenStreamParser::new();
        let _e1 = parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"<tool_call>\n{\"name\": \"read\", \"arguments\": {\"file_path\": \"/a.txt\"}}\n</tool_call>\n<tool_call>\n{\"name\": \"read\", \"arguments\": {\"file_path\": \"/b.txt\"}}\n</tool_call>"},"finish_reason":null}]}"#,
        );
        let e2 = parser.process_sse_data(
            r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        );
        let tool_calls: Vec<_> = e2
            .iter()
            .filter(|e| matches!(e, LlmStreamEvent::ToolCallDelta { .. }))
            .collect();
        assert_eq!(tool_calls.len(), 2);
    }

    #[test]
    fn no_fallback_when_structured_calls_present() {
        let mut parser = QwenStreamParser::new();
        // Server provides structured tool_calls AND leaks raw tokens in content
        let e1 = parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"<tool_call>\n{\"name\":\"shell\",\"arguments\":{\"command\":\"ls\"}}\n</tool_call>","tool_calls":[{"index":0,"id":"id_1","function":{"name":"shell","arguments":"{\"command\":\"ls\"}"}}]},"finish_reason":null}]}"#,
        );
        // Should have the structured call
        assert!(e1.iter().any(|e| matches!(
            e,
            LlmStreamEvent::ToolCallDelta { name: Some(n), .. } if n == "shell"
        )));
        // Finish
        let e2 = parser.process_sse_data(
            r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        );
        // Should NOT have a duplicate fallback call
        assert!(!e2.iter().any(|e| matches!(e, LlmStreamEvent::ToolCallDelta { .. })));
    }


    #[test]
    fn streaming_think_across_chunks() {
        let mut parser = QwenStreamParser::new();

        // Chunk 1: start of thinking
        let e1 = parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"<think>\nLet me think"},"finish_reason":null}]}"#,
        );
        assert!(e1.iter().any(|e| matches!(e, LlmStreamEvent::ReasoningDelta(t) if t.contains("think"))));
        assert!(!e1.iter().any(|e| matches!(e, LlmStreamEvent::TextDelta(_))));

        // Chunk 2: end of thinking + text
        let e2 = parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":" about it.\n</think>\nHere is the answer."},"finish_reason":null}]}"#,
        );
        assert!(e2.iter().any(|e| matches!(e, LlmStreamEvent::ReasoningDelta(t) if t.contains("about it"))));
        assert!(e2.iter().any(|e| matches!(e, LlmStreamEvent::TextDelta(t) if t.contains("answer"))));
    }


    #[test]
    fn safe_emit_partial_tag() {
        assert_eq!(safe_emit_len("hello <th", "<think>"), 6);
        assert_eq!(safe_emit_len("hello <think", "<think>"), 6);
        assert_eq!(safe_emit_len("hello", "<think>"), 5);
    }

    #[test]
    fn safe_emit_multi() {
        assert_eq!(
            safe_emit_len_multi("text <t", &["<think>", "<tool_call>"]),
            5
        );
    }


    #[test]
    fn extract_balanced_simple() {
        let input = r#"{"name": "test"}"#;
        assert_eq!(extract_balanced_json(input).unwrap(), input);
    }

    #[test]
    fn extract_balanced_nested() {
        let input = r#"{"name": "test", "args": {"key": "val"}}"#;
        assert_eq!(extract_balanced_json(input).unwrap(), input);
    }

    #[test]
    fn extract_balanced_with_prefix() {
        let input = r#"{"name": "test"} extra stuff"#;
        assert_eq!(extract_balanced_json(input).unwrap(), r#"{"name": "test"}"#);
    }

    #[test]
    fn extract_balanced_with_escaped_quotes() {
        let input = r#"{"name": "te\"st"}"#;
        assert_eq!(extract_balanced_json(input).unwrap(), input);
    }


    #[test]
    fn build_request_matches_openai_format() {
        let adapter = QwenAdapter;
        let messages = vec![ChatMessage {
            role: crate::agent::types::Role::User,
            content: "hi".to_string(),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }];
        let tools = vec![tool_def("shell")];
        let body = adapter.build_request_body("model", &messages, &tools, 0.5, 8192);

        assert!(body.get("model").is_some());
        assert!(body.get("messages").is_some());
        assert!(body.get("tools").is_some());
        assert_eq!(body["stream"], true);
        assert_eq!(body["max_tokens"], 8192);
    }

    #[test]
    fn endpoint_is_chat_completions() {
        let adapter = QwenAdapter;
        assert_eq!(adapter.endpoint_path(), "/chat/completions");
    }
}
