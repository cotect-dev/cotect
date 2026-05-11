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
    build_openai_request_body, emit_format_error, safe_emit_len, safe_emit_len_multi,
    strip_paired_blocks, strip_tag_pairs, ModelAdapter, StreamChunk, StreamParser,
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

/// Wraps the standard OpenAI SSE format but adds: `<think>...</think>`
/// stripping from `content`, raw tool-call token filtering, and fallback
/// native tool-call parsing when the server doesn't provide structured calls.
pub(crate) struct QwenStreamParser {
    text_buffer: String,
    /// Raw Qwen tokens stripped from text_buffer, kept for fallback parsing.
    accumulated_text: String,
    /// Some servers route tool calls into `reasoning_content` or `<think>`
    /// blocks; we scan this for `<tool_call>` at finalize.
    reasoning_accumulated: String,
    done_emitted: bool,
    in_thinking: bool,
    has_structured_tool_calls: bool,
    fallback_tool_index: usize,
    /// Some Qwen fine-tunes emit Llama-3 style XML tool calls raw, without
    /// the `<tool_call>` wrapper. Once we spot a marker (`<function=`,
    /// `<parameter=`, `</parameter>`, `</function>`) we drain the rest of
    /// the stream into accumulated_text for flush_remaining to parse.
    xml_pseudo_active: bool,
}

impl QwenStreamParser {
    pub fn new() -> Self {
        Self {
            text_buffer: String::new(),
            accumulated_text: String::new(),
            reasoning_accumulated: String::new(),
            done_emitted: false,
            in_thinking: false,
            has_structured_tool_calls: false,
            fallback_tool_index: 0,
            xml_pseudo_active: false,
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
            if let Some(reasoning) = &choice.delta.reasoning_content {
                if !reasoning.is_empty() {
                    self.reasoning_accumulated.push_str(reasoning);
                    events.push(LlmStreamEvent::ReasoningDelta(reasoning.clone()));
                }
            }

            if let Some(text) = &choice.delta.content {
                if !text.is_empty() {
                    self.text_buffer.push_str(text);
                    self.drain_text_buffer(&mut events);
                }
            }

            if let Some(tool_calls) = &choice.delta.tool_calls {
                self.has_structured_tool_calls = true;
                for tc in tool_calls {
                    let func = tc.function.as_ref();
                    events.push(LlmStreamEvent::ToolCallDelta {
                        index: tc.index,
                        id: tc.id.clone(),
                        name: func.and_then(|f| f.name.clone()),
                        arguments_chunk: func.and_then(|f| f.arguments.clone()).unwrap_or_default(),
                    });
                }
            }

            if let Some(reason) = &choice.finish_reason {
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
            // Abnormal termination (server crash, KV exhaustion). Distinct
            // from a genuine completion so the orchestrator retries.
            events.push(LlmStreamEvent::Done {
                finish_reason: Some("stream_ended".to_string()),
            });
        }
        events
    }
}

impl QwenStreamParser {
    /// Strip thinking tokens and filter raw tool-call tokens.
    fn drain_text_buffer(&mut self, events: &mut Vec<LlmStreamEvent>) {
        loop {
            if self.in_thinking {
                if let Some(pos) = self.text_buffer.find("</think>") {
                    let reasoning = self.text_buffer[..pos].to_string();
                    self.text_buffer.drain(..pos + "</think>".len());
                    self.in_thinking = false;
                    if !reasoning.is_empty() {
                        self.reasoning_accumulated.push_str(&reasoning);
                        events.push(LlmStreamEvent::ReasoningDelta(reasoning));
                    }
                    let trimmed = self.text_buffer.trim_start_matches('\n');
                    let skip = self.text_buffer.len() - trimmed.len();
                    if skip > 0 {
                        self.text_buffer.drain(..skip);
                    }
                    continue;
                }
                let safe = safe_emit_len(&self.text_buffer, "</think>");
                if safe > 0 {
                    let reasoning: String = self.text_buffer.drain(..safe).collect();
                    self.reasoning_accumulated.push_str(&reasoning);
                    events.push(LlmStreamEvent::ReasoningDelta(reasoning));
                }
                return;
            }

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
                if self.text_buffer.starts_with('\n') {
                    self.text_buffer.drain(..1);
                }
                continue;
            }

            // Filter raw tool-call tokens leaking into text (some servers
            // dump Qwen's native format alongside structured tool_calls).
            if let Some(pos) = self.text_buffer.find("<tool_call>") {
                if pos > 0 {
                    let text: String = self.text_buffer.drain(..pos).collect();
                    if !text.is_empty() {
                        events.push(LlmStreamEvent::TextDelta(text));
                    }
                }
                if let Some(end) = self.text_buffer.find("</tool_call>") {
                    // Save the raw token to accumulated_text for fallback parsing.
                    let raw_tc: String = self
                        .text_buffer
                        .drain(..end + "</tool_call>".len())
                        .collect();
                    self.accumulated_text.push_str(&raw_tc);
                    continue;
                }
                return;
            }

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

            // Llama-3/Claude-style XML pseudo-tool-call without the
            // `<tool_call>` wrapper — drain the rest into accumulated_text
            // for the fallback parser at flush time.
            if self.xml_pseudo_active {
                let raw: String = self.text_buffer.drain(..).collect();
                self.accumulated_text.push_str(&raw);
                return;
            }
            if let Some(pos) = find_xml_pseudo_marker(&self.text_buffer) {
                if pos > 0 {
                    let text: String = self.text_buffer.drain(..pos).collect();
                    if !text.is_empty() {
                        events.push(LlmStreamEvent::TextDelta(text));
                    }
                }
                self.xml_pseudo_active = true;
                let raw: String = self.text_buffer.drain(..).collect();
                self.accumulated_text.push_str(&raw);
                return;
            }

            let safe = safe_emit_len_multi(
                &self.text_buffer,
                &[
                    "<think>",
                    "</think>",
                    "<tool_call>",
                    "</tool_call>",
                    "<tool_response>",
                    "</tool_response>",
                    "<function=",
                    "</function>",
                    "<parameter=",
                    "</parameter>",
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

    /// Fallback parses tool calls across three channels: raw-token accumulator,
    /// text buffer, and reasoning content (some servers route tool calls into
    /// `reasoning_content` or `<think>` blocks instead of structured calls).
    fn flush_remaining(&mut self, events: &mut Vec<LlmStreamEvent>) {
        if !self.has_structured_tool_calls && !self.accumulated_text.is_empty() {
            let accumulated = std::mem::take(&mut self.accumulated_text);
            self.parse_all_tool_calls(&accumulated, events);
        }

        if !self.has_structured_tool_calls
            && contains_tool_call_pattern(&self.reasoning_accumulated)
        {
            let reasoning = std::mem::take(&mut self.reasoning_accumulated);
            self.parse_all_tool_calls(&reasoning, events);
        }

        if self.text_buffer.is_empty() {
            return;
        }

        let raw_buf = std::mem::take(&mut self.text_buffer);
        let text = strip_thinking(&raw_buf);

        // Try tool parsing BEFORE stripping tokens so they remain extractable.
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
                (after.trim(), "")
            };

            let tc_content = tc_content.trim();
            if !tc_content.is_empty() {
                found_any = true;
                self.emit_single_tool_call(tc_content, events);
            }

            remaining = rest;
        }

        if !found_any {
            let trimmed = text.trim();
            if trimmed.starts_with('{') && trimmed.contains("\"name\"") {
                self.emit_single_tool_call(trimmed, events);
            } else if let Some(start) = trimmed.find("<function=") {
                // Llama-3 / Claude-style XML emitted without <tool_call> wrapper.
                self.emit_single_tool_call(&trimmed[start..], events);
            } else if has_xml_param_fragment(trimmed) {
                // Parameter/closing fragments without a <function=NAME> opener —
                // surface a format error so the model retries instead of
                // silently believing the call ran.
                let idx = self.fallback_tool_index;
                self.fallback_tool_index += 1;
                events.push(emit_format_error(
                    idx,
                    trimmed,
                    "Detected stray XML tool-call fragments \
                     (<parameter=...>, </parameter>, or </function>) without \
                     a matching <function=NAME> opening tag. The call was \
                     not executed. Emit tool calls inside <tool_call>...\
                     </tool_call> using JSON: \
                     {\"name\": \"tool_name\", \"arguments\": {...}}",
                ));
            } else if !trimmed.is_empty() {
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

/// Parses Qwen's Hermes-style tool call: `{"name": "...", "arguments": {...}}`
/// inside `<tool_call>...</tool_call>`. Returns `(name, arguments_json)`.
fn parse_qwen_tool_call(input: &str) -> Result<(String, String), String> {
    let input = input.trim();

    if input.is_empty() {
        return Err("Empty tool call content".to_string());
    }

    if let Ok(obj) = serde_json::from_str::<serde_json::Map<String, Value>>(input) {
        if let (Some(Value::String(name)), Some(args)) = (obj.get("name"), obj.get("arguments")) {
            let args_json = serde_json::to_string(args).unwrap_or_else(|_| "{}".to_string());
            return Ok((name.clone(), args_json));
        }
        return Err(format!(
            "JSON object missing 'name' (string) or 'arguments' field. Got keys: {:?}",
            obj.keys().collect::<Vec<_>>()
        ));
    }

    // Llama-3 / Claude-style XML form that some Qwen fine-tunes emit:
    //   <function=NAME><parameter=KEY>VALUE</parameter>...</function>
    if let Some((name, args_json)) = parse_xml_function_call(input) {
        return Ok((name, args_json));
    }

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

/// Parse `<function=NAME><parameter=KEY>VALUE</parameter>...</function>`
/// (Llama-3.x / Claude-style function-call XML that some Qwen fine-tunes emit).
///
/// Returns `(name, args_as_json_string)` or `None` if the input doesn't match.
fn parse_xml_function_call(input: &str) -> Option<(String, String)> {
    let start = input.find("<function=")?;
    let rest = &input[start + "<function=".len()..];
    let name_end = rest.find('>')?;
    let name = rest[..name_end].trim().to_string();
    if name.is_empty() {
        return None;
    }
    let body_start = name_end + 1;
    // Body runs from after `<function=NAME>` up to `</function>` (or end of input).
    let body = match rest[body_start..].find("</function>") {
        Some(end) => &rest[body_start..body_start + end],
        None => &rest[body_start..],
    };

    let mut args = serde_json::Map::new();
    let mut cursor = body;
    while let Some(p_start) = cursor.find("<parameter=") {
        let after = &cursor[p_start + "<parameter=".len()..];
        let key_end = match after.find('>') {
            Some(i) => i,
            None => break,
        };
        let key = after[..key_end].trim().to_string();
        let value_start = key_end + 1;
        let (value, next) = match after[value_start..].find("</parameter>") {
            Some(v_end) => (
                &after[value_start..value_start + v_end],
                &after[value_start + v_end + "</parameter>".len()..],
            ),
            None => (&after[value_start..], ""),
        };
        // Llama-3 style often wraps values in leading/trailing newlines.
        let value = value.trim_matches(|c: char| c == '\n' || c == '\r');
        // Preserve types when the value parses as JSON; otherwise treat as string.
        let v = serde_json::from_str::<Value>(value)
            .unwrap_or_else(|_| Value::String(value.to_string()));
        if !key.is_empty() {
            args.insert(key, v);
        }
        cursor = next;
    }

    if args.is_empty() && !body.contains("<parameter=") {
        // Matched `<function=NAME>` with no parameters — valid no-arg call.
        return Some((name, "{}".to_string()));
    }

    let args_json = serde_json::to_string(&Value::Object(args)).ok()?;
    Some((name, args_json))
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

fn strip_thinking(text: &str) -> String {
    strip_paired_blocks(text, "<think>", "</think>", true)
}

/// Removes `<tool_call>...</tool_call>` and `<tool_response>...</tool_response>`.
fn strip_raw_tool_tokens(text: &str) -> String {
    strip_tag_pairs(
        text,
        &[
            ("<tool_call>", "</tool_call>"),
            ("<tool_response>", "</tool_response>"),
        ],
    )
}

/// First byte offset of any XML pseudo-tool-call marker, or None.
fn find_xml_pseudo_marker(text: &str) -> Option<usize> {
    ["<function=", "<parameter=", "</parameter>", "</function>"]
        .iter()
        .filter_map(|m| text.find(m))
        .min()
}

/// XML pseudo-tool-call fragments without a matching `<function=NAME>`
/// opener — partial/malformed emissions that should yield a format error
/// rather than be silently treated as prose.
fn has_xml_param_fragment(text: &str) -> bool {
    if text.contains("<function=") {
        return false;
    }
    text.contains("<parameter=") || text.contains("</parameter>") || text.contains("</function>")
}

/// Detects three shapes that need fallback parsing:
/// 1. `<tool_call>...</tool_call>` (Hermes/Qwen native).
/// 2. `<function=NAME>...</function>` (Llama-3/Claude raw, no wrapper).
/// 3. Dangling `<parameter=...>` etc. (malformed — surface a format error).
fn contains_tool_call_pattern(text: &str) -> bool {
    text.contains("<tool_call>")
        || text.contains("<function=")
        || text.contains("<parameter=")
        || text.contains("</parameter>")
        || text.contains("</function>")
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let (name, args) = parse_qwen_tool_call(
            r#"Sure, let me call: {"name": "shell", "arguments": {"command": "ls"}}"#,
        )
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
        let input = r#"text before<tool_call>{"name":"shell","arguments":{"cmd":"ls"}}</tool_call>text after"#;
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
        assert!(events
            .iter()
            .any(|e| matches!(e, LlmStreamEvent::TextDelta(t) if t == "Hello")));
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
        let events =
            parser.process_sse_data(r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#);
        assert!(events
            .iter()
            .any(|e| matches!(e, LlmStreamEvent::Done { .. })));
    }

    #[test]
    fn parse_done_marker() {
        let mut parser = QwenStreamParser::new();
        let events = parser.process_sse_data("[DONE]");
        assert!(events
            .iter()
            .any(|e| matches!(e, LlmStreamEvent::Done { .. })));
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
        let e2 = parser.process_sse_data(r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#);
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
        let e2 = parser.process_sse_data(r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#);
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
        let e2 = parser.process_sse_data(r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#);
        // Should NOT have a duplicate fallback call
        assert!(!e2
            .iter()
            .any(|e| matches!(e, LlmStreamEvent::ToolCallDelta { .. })));
    }

    #[test]
    fn streaming_think_across_chunks() {
        let mut parser = QwenStreamParser::new();

        // Chunk 1: start of thinking
        let e1 = parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"<think>\nLet me think"},"finish_reason":null}]}"#,
        );
        assert!(e1
            .iter()
            .any(|e| matches!(e, LlmStreamEvent::ReasoningDelta(t) if t.contains("think"))));
        assert!(!e1.iter().any(|e| matches!(e, LlmStreamEvent::TextDelta(_))));

        // Chunk 2: end of thinking + text
        let e2 = parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":" about it.\n</think>\nHere is the answer."},"finish_reason":null}]}"#,
        );
        assert!(e2
            .iter()
            .any(|e| matches!(e, LlmStreamEvent::ReasoningDelta(t) if t.contains("about it"))));
        assert!(e2
            .iter()
            .any(|e| matches!(e, LlmStreamEvent::TextDelta(t) if t.contains("answer"))));
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

    // XML-function tool-call format (Llama-3/Claude style emitted by some Qwen fine-tunes).

    #[test]
    fn parse_xml_function_single_param() {
        let (name, args) = parse_qwen_tool_call(
            "<function=read>\n<parameter=file_path>\n/tmp/foo.py\n</parameter>\n</function>",
        )
        .unwrap();
        assert_eq!(name, "read");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(parsed["file_path"], "/tmp/foo.py");
    }

    #[test]
    fn parse_xml_function_multi_param() {
        let (name, args) = parse_qwen_tool_call(
            "<function=patch><parameter=file_path>/a.txt</parameter>\
             <parameter=old_string>hello</parameter>\
             <parameter=new_string>world</parameter></function>",
        )
        .unwrap();
        assert_eq!(name, "patch");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(parsed["file_path"], "/a.txt");
        assert_eq!(parsed["old_string"], "hello");
        assert_eq!(parsed["new_string"], "world");
    }

    #[test]
    fn parse_xml_function_preserves_json_typed_values() {
        let (name, args) = parse_qwen_tool_call(
            "<function=ping><parameter=count>3</parameter><parameter=verbose>true</parameter></function>",
        )
        .unwrap();
        assert_eq!(name, "ping");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(parsed["count"], 3);
        assert_eq!(parsed["verbose"], true);
    }

    #[test]
    fn parse_xml_function_no_args() {
        let (name, args) = parse_qwen_tool_call("<function=status></function>").unwrap();
        assert_eq!(name, "status");
        assert_eq!(args, "{}");
    }

    #[test]
    fn fallback_parses_bare_xml_function_call_without_tool_call_wrapper() {
        // Some Qwen fine-tunes emit Llama-style XML tool calls directly into
        // the content stream, never wrapping them in <tool_call>...</tool_call>.
        // We treat a parseable <function=...>...</function> block as a real
        // tool call so the model still makes progress.
        let mut parser = QwenStreamParser::new();
        parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"Sure, I'll write the file.\n<function=write>\n<parameter=file_path>\n/tmp/foo.py\n</parameter>\n<parameter=content>\nprint('hi')\n</parameter>\n</function>"},"finish_reason":null}]}"#,
        );
        let e = parser.process_sse_data(r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#);
        let calls: Vec<_> = e
            .iter()
            .filter_map(|ev| match ev {
                LlmStreamEvent::ToolCallDelta {
                    name: Some(n),
                    arguments_chunk,
                    ..
                } => Some((n.clone(), arguments_chunk.clone())),
                _ => None,
            })
            .collect();
        assert_eq!(
            calls.len(),
            1,
            "expected exactly one tool call, got {calls:?}"
        );
        assert_eq!(calls[0].0, "write");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&calls[0].1).unwrap();
        assert_eq!(parsed["file_path"], "/tmp/foo.py");
        assert_eq!(parsed["content"], "print('hi')");
    }

    #[test]
    fn fallback_emits_format_error_for_dangling_xml_fragments() {
        // Reproduces the failure mode observed in xhard_refactor_04: the
        // model emitted <parameter=...> blocks and a closing </function>
        // without ever opening <function=NAME>. The pre-fix behaviour was
        // to silently drop the fragments as plain text, leaving the model
        // to believe its tool call had executed.
        let mut parser = QwenStreamParser::new();
        parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"</parameter>\n<parameter=file_path>\n/tmp/x.py\n</parameter>\n<parameter=content>\nbody\n</parameter>\n</function>"},"finish_reason":null}]}"#,
        );
        let e = parser.process_sse_data(r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#);
        let format_errors: Vec<_> = e
            .iter()
            .filter_map(|ev| match ev {
                LlmStreamEvent::ToolCallDelta {
                    name: Some(n),
                    arguments_chunk,
                    ..
                } if n == "__format_error__" => Some(arguments_chunk.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(
            format_errors.len(),
            1,
            "expected one format error, got events: {e:?}"
        );
        assert!(format_errors[0].contains("stray XML tool-call fragments"));
    }

    #[test]
    fn fallback_parses_xml_function_inside_tool_call() {
        let mut parser = QwenStreamParser::new();
        parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"<tool_call>\n<function=read>\n<parameter=file_path>\n/tmp/x.py\n</parameter>\n</function>\n</tool_call>"},"finish_reason":null}]}"#,
        );
        let e = parser.process_sse_data(r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#);
        let calls: Vec<_> = e
            .iter()
            .filter_map(|ev| match ev {
                LlmStreamEvent::ToolCallDelta {
                    name: Some(n),
                    arguments_chunk,
                    ..
                } => Some((n.clone(), arguments_chunk.clone())),
                _ => None,
            })
            .collect();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "read");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&calls[0].1).unwrap();
        assert_eq!(parsed["file_path"], "/tmp/x.py");
    }

    // Tool calls emitted via the reasoning channel (some servers route them
    // into `reasoning_content` or wrap them in `<think>` blocks).

    #[test]
    fn fallback_parses_tool_calls_from_reasoning_content_field() {
        let mut parser = QwenStreamParser::new();
        parser.process_sse_data(
            r#"{"choices":[{"delta":{"reasoning_content":"planning step...\n<tool_call>\n<function=read>\n<parameter=file_path>\n/tmp/y.py\n</parameter>\n</function>\n</tool_call>"},"finish_reason":null}]}"#,
        );
        let e = parser.process_sse_data(r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#);
        assert!(e.iter().any(|ev| matches!(
            ev,
            LlmStreamEvent::ToolCallDelta { name: Some(n), .. } if n == "read"
        )));
    }

    #[test]
    fn fallback_parses_tool_calls_from_think_block() {
        let mut parser = QwenStreamParser::new();
        parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"<think>\nthinking...\n<tool_call>\n{\"name\": \"shell\", \"arguments\": {\"command\": \"ls\"}}\n</tool_call>\n</think>"},"finish_reason":null}]}"#,
        );
        let e = parser.process_sse_data(r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#);
        assert!(e.iter().any(|ev| matches!(
            ev,
            LlmStreamEvent::ToolCallDelta { name: Some(n), .. } if n == "shell"
        )));
    }

    #[test]
    fn reasoning_fallback_skipped_when_structured_calls_present() {
        let mut parser = QwenStreamParser::new();
        // Reasoning contains a tool-call-like text, but server also emits a
        // structured tool_calls field — we must not double-fire.
        parser.process_sse_data(
            r#"{"choices":[{"delta":{"reasoning_content":"<tool_call>\n<function=read>\n<parameter=file_path>\n/a\n</parameter>\n</function>\n</tool_call>","tool_calls":[{"index":0,"id":"id_1","function":{"name":"read","arguments":"{\"file_path\":\"/a\"}"}}]},"finish_reason":null}]}"#,
        );
        let e = parser.process_sse_data(r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#);
        let calls: Vec<_> = e
            .iter()
            .filter(|ev| matches!(ev, LlmStreamEvent::ToolCallDelta { .. }))
            .collect();
        // The structured one was emitted on the first chunk; no extra fallback on flush.
        assert_eq!(calls.len(), 0);
    }
}
