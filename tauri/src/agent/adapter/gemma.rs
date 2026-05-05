//! Gemma 4 adapter — enhanced parser for Gemma's native output.
//!
//! Uses the standard `/v1/chat/completions` OpenAI-compatible endpoint (works
//! with any server: llama.cpp, mlx_vlm, vLLM, etc.) but adds Gemma-specific
//! response parsing:
//!
//! - **Thinking-token stripping**: Gemma 4 emits `<|channel>thought\n...<channel|>`
//!   blocks even through OpenAI-compat APIs. These leak into the `content` field
//!   and need to be separated into `ReasoningDelta` events.
//!
//! - **Raw tool-call token filtering**: Some servers (notably mlx_vlm) leak raw
//!   Gemma tool-call tokens (`<|tool_call>call:NAME{...}<tool_call|>`) into the
//!   `content` field alongside structured `tool_calls` in the response. We filter
//!   these out of text content.
//!
//! - **Native tool-call fallback**: When the server doesn't provide structured
//!   `tool_calls`, we parse Gemma's native `call:NAME{key: "value"}` syntax from
//!   the text content, including Gemma's `<|"|>` pipe-quote string delimiters.
//!
//! - **Format error recovery**: When a tool call can't be parsed (e.g., unquoted
//!   string values), we emit a `__format_error__` sentinel that the tool executor
//!   rejects with a helpful error message, prompting the model to retry with
//!   correct JSON.

use serde_json::Value;

use super::super::types::{ChatMessage, LlmStreamEvent, ToolDefinition};
use super::{
    ModelAdapter, StreamChunk, StreamParser,
    build_openai_request_body, emit_format_error, safe_emit_len, safe_emit_len_multi,
    strip_paired_blocks, strip_tag_pairs,
};


pub struct GemmaAdapter;

impl ModelAdapter for GemmaAdapter {
    fn name(&self) -> &'static str {
        "gemma"
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
        Box::new(GemmaStreamParser::new())
    }
}


/// Wraps the standard OpenAI SSE format with Gemma-4-specific stripping
/// of thinking tokens, raw tool-call tokens, and fallback parsing of
/// `call:NAME{...}` syntax when the server lacks structured tool_calls.
pub(crate) struct GemmaStreamParser {
    text_buffer: String,
    /// Raw Gemma tokens stripped from text_buffer, kept for fallback parsing.
    accumulated_text: String,
    done_emitted: bool,
    /// Inside a `<|channel>thought` block.
    in_thinking: bool,
    has_structured_tool_calls: bool,
    fallback_tool_index: usize,
}

impl GemmaStreamParser {
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

impl StreamParser for GemmaStreamParser {
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
                        arguments_chunk: func
                            .and_then(|f| f.arguments.clone())
                            .unwrap_or_default(),
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
            // Abnormal termination — distinguish from genuine completion so
            // the orchestrator retries.
            events.push(LlmStreamEvent::Done {
                finish_reason: Some("stream_ended".to_string()),
            });
        }
        events
    }
}

impl GemmaStreamParser {
    /// Strip thinking tokens and filter raw tool-call tokens.
    fn drain_text_buffer(&mut self, events: &mut Vec<LlmStreamEvent>) {
        loop {
            if self.in_thinking {
                if let Some(pos) = self.text_buffer.find("<channel|>") {
                    let reasoning = self.text_buffer[..pos].to_string();
                    self.text_buffer.drain(..pos + "<channel|>".len());
                    self.in_thinking = false;
                    if !reasoning.is_empty() {
                        events.push(LlmStreamEvent::ReasoningDelta(reasoning));
                    }
                    continue;
                }
                let safe = safe_emit_len(&self.text_buffer, "<channel|>");
                if safe > 0 {
                    let reasoning: String = self.text_buffer.drain(..safe).collect();
                    events.push(LlmStreamEvent::ReasoningDelta(reasoning));
                }
                return;
            }

            let think_marker = self.text_buffer.find("<|channel>thought\n")
                .map(|pos| (pos, "<|channel>thought\n".len()))
                .or_else(|| {
                    self.text_buffer.find("<|channel>thought ").map(|pos| (pos, "<|channel>thought ".len()))
                });
            if let Some((pos, marker_len)) = think_marker {
                if pos > 0 {
                    let text: String = self.text_buffer.drain(..pos).collect();
                    let clean = strip_raw_tool_tokens(&text);
                    if !clean.is_empty() {
                        events.push(LlmStreamEvent::TextDelta(clean));
                    }
                }
                self.text_buffer.drain(..marker_len);
                self.in_thinking = true;
                continue;
            }

            // Filter raw tool-call tokens leaking into text.
            if let Some(pos) = self.text_buffer.find("<|tool_call>") {
                if pos > 0 {
                    let text: String = self.text_buffer.drain(..pos).collect();
                    if !text.is_empty() {
                        events.push(LlmStreamEvent::TextDelta(text));
                    }
                }
                if let Some(end) = self.text_buffer.find("<tool_call|>") {
                    // Save the raw token to accumulated_text for fallback parsing.
                    let raw: String = self.text_buffer.drain(..end + "<tool_call|>".len()).collect();
                    self.accumulated_text.push_str(&raw);
                    continue;
                }
                return;
            }

            if let Some(pos) = self.text_buffer.find("<|tool_response>") {
                if pos > 0 {
                    let text: String = self.text_buffer.drain(..pos).collect();
                    if !text.is_empty() {
                        events.push(LlmStreamEvent::TextDelta(text));
                    }
                }
                if let Some(end) = self.text_buffer.find("<tool_response|>") {
                    self.text_buffer.drain(..end + "<tool_response|>".len());
                    continue;
                }
                return;
            }

            let safe = safe_emit_len_multi(
                &self.text_buffer,
                &[
                    "<|channel>thought\n",
                    "<|channel>thought ",
                    "<|tool_call>",
                    "<|tool_response>",
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

    /// Fallback parses tool calls from the text buffer or accumulated raw
    /// tokens when the server didn't provide structured tool_calls.
    fn flush_remaining(&mut self, events: &mut Vec<LlmStreamEvent>) {
        if !self.accumulated_text.is_empty() && !self.has_structured_tool_calls {
            let acc = std::mem::take(&mut self.accumulated_text);
            if contains_tool_call_pattern(&acc) {
                self.parse_all_tool_calls(&acc, events);
            }
        }

        if self.text_buffer.is_empty() {
            return;
        }

        let raw = std::mem::take(&mut self.text_buffer);
        let text = strip_thinking(&raw);

        // Try parsing BEFORE stripping tool tokens so call:NAME{args} survives.
        if !self.has_structured_tool_calls && contains_tool_call_pattern(&text) {
            self.parse_all_tool_calls(&text, events);
            return;
        }

        let text = strip_raw_tool_tokens(&text);
        if !text.is_empty() {
            events.push(LlmStreamEvent::TextDelta(text));
        }
    }

    /// Parse all tool calls from raw text content (fallback when server
    /// doesn't provide structured tool_calls).
    /// Gemma can emit multiple `<|tool_call>...<tool_call|>` blocks or
    /// multiple `call:NAME{args}` patterns in a single response.
    fn parse_all_tool_calls(&mut self, text: &str, events: &mut Vec<LlmStreamEvent>) {
        let mut remaining = text;
        let mut found_any = false;

        // First, try to extract all <|tool_call>...<tool_call|> blocks
        while let Some(start) = remaining.find("<|tool_call>") {
            let after = &remaining[start + "<|tool_call>".len()..];
            let (tc_content, rest) = if let Some(end) = after.find("<tool_call|>") {
                (&after[..end], &after[end + "<tool_call|>".len()..])
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

        if found_any {
            return;
        }

        // No <|tool_call> tags found — try bare call:NAME{args} patterns
        remaining = text;
        while let Some(call_pos) = remaining.find("call:") {
            let call_text = &remaining[call_pos..];
            // Find the end of this call — look for the closing brace
            if let Some(brace_start) = call_text.find('{') {
                let after_brace = &call_text[brace_start + 1..];
                let mut depth = 1i32;
                let mut in_string = false;
                let mut escape_next = false;
                let mut end_pos = after_brace.len();
                for (i, c) in after_brace.char_indices() {
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
                    }
                    if !in_string {
                        if c == '{' { depth += 1; }
                        else if c == '}' {
                            depth -= 1;
                            if depth == 0 {
                                end_pos = i + 1;
                                break;
                            }
                        }
                    }
                }
                let tc_content = &call_text[..brace_start + 1 + end_pos];
                found_any = true;
                self.emit_single_tool_call(tc_content.trim(), events);
                remaining = &remaining[call_pos + brace_start + 1 + end_pos..];
            } else {
                // No brace found — try the whole rest
                found_any = true;
                self.emit_single_tool_call(call_text.trim(), events);
                break;
            }
        }

        if !found_any {
            // Not a tool call, just emit as text
            let text = text.trim();
            if !text.is_empty() {
                events.push(LlmStreamEvent::TextDelta(text.to_string()));
            }
        }
    }

    /// Try to parse and emit a single tool call from content.
    fn emit_single_tool_call(&mut self, content: &str, events: &mut Vec<LlmStreamEvent>) {
        let idx = self.fallback_tool_index;
        self.fallback_tool_index += 1;

        match parse_gemma_tool_call(content) {
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


/// Parse a tool call from the model's output. Tries multiple strategies:
///
/// 1. Standard JSON: `{"name":"read","arguments":{"file_path":"/tmp/x.txt"}}`
/// 2. Gemma's native format: `call:read{file_path: "/tmp/x.txt"}`
///
/// For strategy 2, all string values MUST be quoted (double, single, or
/// Gemma's `<|"|>` pipe-quote token).
/// Returns `(tool_name, arguments_as_json_string)` or an error.
fn parse_gemma_tool_call(input: &str) -> Result<(String, String), String> {
    let input = input.trim();

    if input.is_empty() {
        return Err("Empty tool call content".to_string());
    }

    // Strategy 1: Try standard JSON
    if input.starts_with('{') {
        if let Ok(obj) = serde_json::from_str::<serde_json::Map<String, Value>>(input) {
            if let (Some(Value::String(name)), Some(args)) =
                (obj.get("name"), obj.get("arguments"))
            {
                let args_json = serde_json::to_string(args).unwrap_or_else(|_| "{}".to_string());
                return Ok((name.clone(), args_json));
            }
        }
    }

    // Strategy 2: Gemma's native `call:NAME{key: "value"}` format
    let after_prefix = if let Some(rest) = input.strip_prefix("call:") {
        rest
    } else {
        input
    };

    let brace_pos = after_prefix
        .find('{')
        .ok_or_else(|| format!("No opening brace found in: {input}"))?;
    let name = after_prefix[..brace_pos].trim().to_string();

    if name.is_empty() {
        return Err(format!("Empty tool name in: {input}"));
    }

    let args_str = &after_prefix[brace_pos + 1..];
    let args_str = args_str.strip_suffix('}').unwrap_or(args_str);

    let args = parse_native_args(args_str)?;
    let json_str = serde_json::to_string(&args).unwrap_or_else(|_| "{}".to_string());

    Ok((name, json_str))
}

/// Parse Gemma's native key-value arguments: `key: "value", key2: 'value2'`
fn parse_native_args(input: &str) -> Result<serde_json::Map<String, Value>, String> {
    let mut map = serde_json::Map::new();
    let mut chars = input.chars().peekable();

    loop {
        skip_ws(&mut chars);
        if chars.peek().is_none() {
            break;
        }

        let key = parse_bare_key(&mut chars);
        if key.is_empty() {
            break;
        }

        skip_ws(&mut chars);
        if chars.peek() == Some(&':') {
            chars.next();
        }
        skip_ws(&mut chars);

        let value = parse_value_strict(&mut chars, &key)?;
        map.insert(key, value);

        skip_ws(&mut chars);
        if chars.peek() == Some(&',') {
            chars.next();
        }
    }

    Ok(map)
}

fn skip_ws(chars: &mut std::iter::Peekable<std::str::Chars>) {
    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
        } else {
            break;
        }
    }
}

fn parse_bare_key(chars: &mut std::iter::Peekable<std::str::Chars>) -> String {
    let mut key = String::new();
    while let Some(&c) = chars.peek() {
        if c.is_alphanumeric() || c == '_' {
            key.push(c);
            chars.next();
        } else {
            break;
        }
    }
    key
}

/// The Gemma special string-quote token.
const GEMMA_QUOTE: &str = "<|\"|>";

/// Parse a value strictly — strings must be quoted.
fn parse_value_strict(
    chars: &mut std::iter::Peekable<std::str::Chars>,
    key: &str,
) -> Result<Value, String> {
    // Check for Gemma's native <|"|> quote token
    if chars.peek() == Some(&'<') {
        let peeked: String = chars.clone().take(5).collect();
        if peeked == GEMMA_QUOTE {
            for _ in 0..5 {
                chars.next();
            }
            return Ok(Value::String(parse_gemma_quoted_string(chars)));
        }
    }

    match chars.peek() {
        Some(&'"') | Some(&'\'') => {
            let quote = chars.next().unwrap();
            Ok(Value::String(parse_quoted_string(chars, quote)))
        }
        Some(&'{') => {
            chars.next();
            let inner = parse_native_args(&collect_until_matching_brace(chars))?;
            Ok(Value::Object(inner))
        }
        Some(&'[') => {
            chars.next();
            parse_array(chars)
        }
        Some(&_) => {
            let mut s = String::new();
            while let Some(&ch) = chars.peek() {
                if ch == ',' || ch == '}' || ch == ']' {
                    break;
                }
                s.push(ch);
                chars.next();
            }
            let s = s.trim().to_string();

            if s == "true" {
                Ok(Value::Bool(true))
            } else if s == "false" {
                Ok(Value::Bool(false))
            } else if s == "null" {
                Ok(Value::Null)
            } else if let Ok(n) = s.parse::<i64>() {
                Ok(Value::Number(n.into()))
            } else if let Ok(n) = s.parse::<f64>() {
                if let Some(n) = serde_json::Number::from_f64(n) {
                    Ok(Value::Number(n))
                } else {
                    Err(format!(
                        "Value for \"{key}\" is not valid JSON. Got: {s}. \
                         String values MUST be wrapped in double quotes."
                    ))
                }
            } else {
                Err(format!(
                    "Value for \"{key}\" is not valid JSON. Got: {s}. \
                     String values MUST be wrapped in double quotes."
                ))
            }
        }
        None => Err(format!("Missing value for key \"{key}\"")),
    }
}

/// Parse a string delimited by Gemma's `<|"|>` token.
fn parse_gemma_quoted_string(chars: &mut std::iter::Peekable<std::str::Chars>) -> String {
    let mut s = String::new();
    loop {
        if chars.peek() == Some(&'<') {
            let peeked: String = chars.clone().take(5).collect();
            if peeked == GEMMA_QUOTE {
                for _ in 0..5 {
                    chars.next();
                }
                break;
            }
        }
        match chars.next() {
            Some('\\') => match chars.next() {
                Some('n') => s.push('\n'),
                Some('r') => s.push('\r'),
                Some('t') => s.push('\t'),
                Some('\\') => s.push('\\'),
                Some('"') => s.push('"'),
                Some(other) => {
                    s.push('\\');
                    s.push(other);
                }
                None => break,
            },
            Some(c) => s.push(c),
            None => break,
        }
    }
    s
}

fn parse_quoted_string(
    chars: &mut std::iter::Peekable<std::str::Chars>,
    quote: char,
) -> String {
    let mut s = String::new();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => s.push('\n'),
                Some('r') => s.push('\r'),
                Some('t') => s.push('\t'),
                Some('\\') => s.push('\\'),
                Some('"') => s.push('"'),
                Some('\'') => s.push('\''),
                Some(other) => {
                    s.push('\\');
                    s.push(other);
                }
                None => break,
            }
        } else if c == quote {
            break;
        } else {
            s.push(c);
        }
    }
    s
}

fn collect_until_matching_brace(chars: &mut std::iter::Peekable<std::str::Chars>) -> String {
    let mut s = String::new();
    let mut depth = 1i32;
    let mut in_string = false;
    let mut escape_next = false;
    for c in chars.by_ref() {
        if escape_next {
            escape_next = false;
            s.push(c);
            continue;
        }
        if c == '\\' && in_string {
            escape_next = true;
            s.push(c);
            continue;
        }
        if c == '"' {
            in_string = !in_string;
        }
        if !in_string {
            if c == '{' { depth += 1; }
            else if c == '}' {
                depth -= 1;
                if depth == 0 { break; }
            }
        }
        s.push(c);
    }
    s
}

fn parse_array(chars: &mut std::iter::Peekable<std::str::Chars>) -> Result<Value, String> {
    let mut arr = Vec::new();
    loop {
        skip_ws(chars);
        if chars.peek() == Some(&']') {
            chars.next();
            break;
        }
        if chars.peek().is_none() {
            break;
        }
        arr.push(parse_value_strict(chars, "array_element")?);
        skip_ws(chars);
        if chars.peek() == Some(&',') {
            chars.next();
        }
    }
    Ok(Value::Array(arr))
}


/// Strip `<|channel>thought\n...<channel|>` blocks from text.
fn strip_thinking(text: &str) -> String {
    // Gemma uses two variants of the thinking open tag (newline and space).
    // Apply each in sequence — they don't overlap so order doesn't matter.
    let result = strip_paired_blocks(text, "<|channel>thought\n", "<channel|>", false);
    strip_paired_blocks(&result, "<|channel>thought ", "<channel|>", false)
}

/// Strip raw Gemma tool-call tokens from text.
/// Removes `<|tool_call>...<tool_call|>` and `<|tool_response>...<tool_response|>`.
fn strip_raw_tool_tokens(text: &str) -> String {
    strip_tag_pairs(text, &[
        ("<|tool_call>", "<tool_call|>"),
        ("<|tool_response>", "<tool_response|>"),
    ])
}

/// Check if text contains a tool-call pattern that needs fallback parsing.
fn contains_tool_call_pattern(text: &str) -> bool {
    text.contains("<|tool_call>") || text.contains("call:")
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_tool_call() {
        let (name, args) =
            parse_gemma_tool_call("call:read{file_path: \"/tmp/test.txt\"}").unwrap();
        assert_eq!(name, "read");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(parsed["file_path"], "/tmp/test.txt");
    }

    #[test]
    fn parse_multi_arg_tool_call() {
        let (name, args) = parse_gemma_tool_call(
            "call:patch{file_path: \"/tmp/foo.txt\", new_string: \"goodbye\", old_string: \"hello\"}",
        )
        .unwrap();
        assert_eq!(name, "patch");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(parsed["file_path"], "/tmp/foo.txt");
        assert_eq!(parsed["new_string"], "goodbye");
        assert_eq!(parsed["old_string"], "hello");
    }

    #[test]
    fn parse_single_quoted_values() {
        let (name, args) =
            parse_gemma_tool_call("call:shell{command: 'echo \"hello\"'}").unwrap();
        assert_eq!(name, "shell");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(parsed["command"], "echo \"hello\"");
    }

    #[test]
    fn parse_escaped_newlines() {
        let (name, args) =
            parse_gemma_tool_call("call:patch{old_string: \"line1\\nline2\", new_string: \"line1\\nline3\"}")
                .unwrap();
        assert_eq!(name, "patch");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(parsed["old_string"], "line1\nline2");
        assert_eq!(parsed["new_string"], "line1\nline3");
    }

    #[test]
    fn parse_no_spaces() {
        let (name, args) =
            parse_gemma_tool_call("call:shell{command:\"ls -la\"}").unwrap();
        assert_eq!(name, "shell");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(parsed["command"], "ls -la");
    }

    #[test]
    fn parse_without_call_prefix() {
        let (name, args) =
            parse_gemma_tool_call("shell{command: \"ls\"}").unwrap();
        assert_eq!(name, "shell");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(parsed["command"], "ls");
    }

    #[test]
    fn parse_bare_unquoted_value_is_rejected() {
        let result =
            parse_gemma_tool_call(r#"call:write{content: 1\n2\n3, file_path: "/tmp/f.txt"}"#);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not valid JSON"));
    }

    #[test]
    fn parse_bare_boolean_value() {
        let (name, args) =
            parse_gemma_tool_call(r#"call:tool{flag: true, name: "test"}"#).unwrap();
        assert_eq!(name, "tool");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(parsed["flag"], true);
        assert_eq!(parsed["name"], "test");
    }

    #[test]
    fn parse_bare_integer_value() {
        let (name, args) =
            parse_gemma_tool_call("call:read{file_path: \"/tmp/f.txt\", start_line: 10}").unwrap();
        assert_eq!(name, "read");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(parsed["start_line"], 10);
    }

    #[test]
    fn parse_standard_json_tool_call() {
        let (name, args) = parse_gemma_tool_call(
            r#"{"name": "shell", "arguments": {"command": "ls -la"}}"#
        ).unwrap();
        assert_eq!(name, "shell");
        let parsed: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(parsed["command"], "ls -la");
    }


    #[test]
    fn parse_gemma_pipe_quote_simple() {
        let input = r#"call:shell{command:<|"|>uname -s<|"|>}"#;
        let (name, args) = parse_gemma_tool_call(input).unwrap();
        assert_eq!(name, "shell");
        let args: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(args.get("command").unwrap().as_str().unwrap(), "uname -s");
    }

    #[test]
    fn parse_gemma_pipe_quote_multi_args() {
        let input = r#"call:shell{command:<|"|>echo hello<|"|>,description:<|"|>Say hello<|"|>}"#;
        let (name, args) = parse_gemma_tool_call(input).unwrap();
        assert_eq!(name, "shell");
        let args: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(args.get("command").unwrap().as_str().unwrap(), "echo hello");
        assert_eq!(args.get("description").unwrap().as_str().unwrap(), "Say hello");
    }

    #[test]
    fn parse_gemma_pipe_quote_with_specials() {
        let input = "call:shell{command:<|\"|>echo \"hello world\" | grep hello<|\"|>}";
        let (name, args) = parse_gemma_tool_call(input).unwrap();
        assert_eq!(name, "shell");
        let args: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(
            args.get("command").unwrap().as_str().unwrap(),
            "echo \"hello world\" | grep hello"
        );
    }

    #[test]
    fn parse_gemma_pipe_quote_mixed_with_regular() {
        let input = "call:patch{file_path:<|\"|>/tmp/foo.txt<|\"|>,old_string:\"hello\",new_string:<|\"|>world<|\"|>}";
        let (name, args) = parse_gemma_tool_call(input).unwrap();
        assert_eq!(name, "patch");
        let args: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(args.get("file_path").unwrap().as_str().unwrap(), "/tmp/foo.txt");
        assert_eq!(args.get("old_string").unwrap().as_str().unwrap(), "hello");
        assert_eq!(args.get("new_string").unwrap().as_str().unwrap(), "world");
    }


    #[test]
    fn strip_thinking_block() {
        let input = "<|channel>thought\nI should read the file.\n<channel|>The answer is 42.";
        assert_eq!(strip_thinking(input), "The answer is 42.");
    }

    #[test]
    fn strip_multiple_thinking_blocks() {
        let input = "<|channel>thought\nthink1<channel|>text1<|channel>thought\nthink2<channel|>text2";
        assert_eq!(strip_thinking(input), "text1text2");
    }

    #[test]
    fn strip_thinking_preserves_plain_text() {
        assert_eq!(strip_thinking("Hello world"), "Hello world");
    }


    #[test]
    fn strip_raw_tool_call_tokens() {
        let input = "text before<|tool_call>call:shell{cmd: \"ls\"}<tool_call|>text after";
        assert_eq!(strip_raw_tool_tokens(input), "text beforetext after");
    }

    #[test]
    fn strip_raw_tool_response_tokens() {
        let input = "before<|tool_response>result here<tool_response|>after";
        assert_eq!(strip_raw_tool_tokens(input), "beforeafter");
    }

    #[test]
    fn strip_nothing_from_clean_text() {
        assert_eq!(strip_raw_tool_tokens("plain text"), "plain text");
    }


    #[test]
    fn parse_openai_text_delta() {
        let mut parser = GemmaStreamParser::new();
        let events = parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}"#,
        );
        assert!(events.iter().any(|e| matches!(e, LlmStreamEvent::TextDelta(t) if t == "Hello")));
    }

    #[test]
    fn parse_openai_reasoning_delta() {
        let mut parser = GemmaStreamParser::new();
        let events = parser.process_sse_data(
            r#"{"choices":[{"delta":{"reasoning_content":"thinking..."},"finish_reason":null}]}"#,
        );
        assert!(events.iter().any(|e| matches!(e, LlmStreamEvent::ReasoningDelta(t) if t == "thinking...")));
    }

    #[test]
    fn parse_openai_tool_call_delta() {
        let mut parser = GemmaStreamParser::new();
        let events = parser.process_sse_data(
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"shell","arguments":"{\"command\":\"ls\"}"}}]},"finish_reason":null}]}"#,
        );
        assert!(events.iter().any(|e| matches!(
            e, LlmStreamEvent::ToolCallDelta { name: Some(n), .. } if n == "shell"
        )));
        assert!(parser.has_structured_tool_calls);
    }

    #[test]
    fn parse_openai_done() {
        let mut parser = GemmaStreamParser::new();
        let events = parser.process_sse_data(
            r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        );
        assert!(events.iter().any(|e| matches!(e, LlmStreamEvent::Done { .. })));
    }

    #[test]
    fn parse_done_marker() {
        let mut parser = GemmaStreamParser::new();
        let events = parser.process_sse_data("[DONE]");
        assert!(events.iter().any(|e| matches!(e, LlmStreamEvent::Done { .. })));
    }

    #[test]
    fn filter_thinking_from_content() {
        let mut parser = GemmaStreamParser::new();
        let events = parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"<|channel>thought\nI think...<channel|>The answer"},"finish_reason":null}]}"#,
        );
        assert!(events.iter().any(|e| matches!(e, LlmStreamEvent::ReasoningDelta(t) if t.contains("think"))));
        assert!(events.iter().any(|e| matches!(e, LlmStreamEvent::TextDelta(t) if t.contains("answer"))));
        // Should NOT have raw thinking tokens in text
        assert!(!events.iter().any(|e| matches!(e, LlmStreamEvent::TextDelta(t) if t.contains("<|channel>"))));
    }

    #[test]
    fn filter_raw_tool_tokens_from_content() {
        let mut parser = GemmaStreamParser::new();
        // Simulate mlx_vlm leaking raw tool tokens into content
        let e1 = parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"<|tool_call>call:shell{cmd:\"ls\"}<tool_call|>"},"finish_reason":null}]}"#,
        );
        // Should filter out the raw tokens
        assert!(!e1.iter().any(|e| matches!(e, LlmStreamEvent::TextDelta(t) if t.contains("call:shell"))));
    }

    #[test]
    fn fallback_parse_when_no_structured_calls() {
        let mut parser = GemmaStreamParser::new();
        // Model emits a tool call as text (no structured tool_calls from server)
        let _e1 = parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"<|tool_call>call:shell{command: \"ls\"}<tool_call|>"},"finish_reason":null}]}"#,
        );
        // Now finish without structured tool_calls
        let e2 = parser.process_sse_data(
            r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        );
        // Should have fallback-parsed the tool call
        assert!(e2.iter().any(|e| matches!(
            e, LlmStreamEvent::ToolCallDelta { name: Some(n), .. } if n == "shell"
        )));
    }

    #[test]
    fn fallback_parse_multiple_tool_calls_tagged() {
        let mut parser = GemmaStreamParser::new();
        // Model emits two tool calls as raw tokens (no structured tool_calls)
        let _e1 = parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"<|tool_call>call:read{file_path: \"/a.txt\"}<tool_call|><|tool_call>call:read{file_path: \"/b.txt\"}<tool_call|>"},"finish_reason":null}]}"#,
        );
        let e2 = parser.process_sse_data(
            r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        );
        let tool_calls: Vec<_> = e2
            .iter()
            .filter(|e| matches!(e, LlmStreamEvent::ToolCallDelta { .. }))
            .collect();
        assert_eq!(tool_calls.len(), 2, "Should parse both tool calls from tagged blocks");
    }

    #[test]
    fn fallback_parse_multiple_bare_tool_calls() {
        let mut parser = GemmaStreamParser::new();
        // Simulate model emitting bare call: patterns in text buffer (not accumulated via tags)
        parser.text_buffer = "call:read{file_path: \"/a.txt\"}\ncall:read{file_path: \"/b.txt\"}".into();
        let mut events = Vec::new();
        parser.flush_remaining(&mut events);
        let tool_calls: Vec<_> = events
            .iter()
            .filter(|e| matches!(e, LlmStreamEvent::ToolCallDelta { .. }))
            .collect();
        assert_eq!(tool_calls.len(), 2, "Should parse both bare call: patterns");
    }

    #[test]
    fn no_fallback_when_structured_calls_present() {
        let mut parser = GemmaStreamParser::new();
        // Server provides structured tool_calls AND leaks raw tokens in content
        let e1 = parser.process_sse_data(
            r#"{"choices":[{"delta":{"content":"<|tool_call>call:shell{command:\"ls\"}<tool_call|>","tool_calls":[{"index":0,"id":"id_1","function":{"name":"shell","arguments":"{\"command\":\"ls\"}"}}]},"finish_reason":null}]}"#,
        );
        // Should have the structured call
        assert!(e1.iter().any(|e| matches!(
            e, LlmStreamEvent::ToolCallDelta { name: Some(n), .. } if n == "shell"
        )));
        // Finish
        let e2 = parser.process_sse_data(
            r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        );
        // Should NOT have a duplicate fallback call
        assert!(!e2.iter().any(|e| matches!(e, LlmStreamEvent::ToolCallDelta { .. })));
    }


    #[test]
    fn safe_emit_partial_tag() {
        assert_eq!(safe_emit_len("hello <|", "<|channel>thought\n"), 6);
        assert_eq!(safe_emit_len("hello <|chan", "<|channel>thought\n"), 6);
        assert_eq!(safe_emit_len("hello", "<|channel>thought\n"), 5);
    }

    #[test]
    fn safe_emit_multi() {
        assert_eq!(
            safe_emit_len_multi("text <|", &["<|channel>thought\n", "<|tool_call>"]),
            5
        );
    }


}
