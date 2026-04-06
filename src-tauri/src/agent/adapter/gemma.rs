//! Gemma 4 adapter — uses Gemma's native turn tokens with simplified
//! tool-call handling.
//!
//! Gemma 4 is heavily instruction-tuned to its own chat template. It
//! recognises `<|turn>`, `<turn|>`, `<|tool_call>`, `<tool_call|>`,
//! `<|tool_response>`, `<tool_response|>`, and `<|channel>` / `<channel|>`
//! tokens from training.
//!
//! ## Compromise Design
//!
//! We keep Gemma's native special tokens for turn/tool boundaries (the model
//! expects them) but replace the exotic pseudo-JSON argument syntax that the
//! server-side template normally renders. Tool **definitions** go into the
//! system prompt as human-readable markdown + JSON schema. Tool **results** are
//! wrapped in `<|tool_response>...<tool_response|>` tags.
//!
//! The model outputs tool calls in its trained format:
//! ```text
//! <|tool_call>call:shell{command: "ls -la"}<tool_call|>
//! ```
//! We parse this native syntax on the client side rather than forcing the model
//! to output standard JSON (it ignores JSON instructions due to strong training
//! priors).
//!
//! ## Endpoint
//!
//! Uses llama.cpp's `/completion` endpoint (raw prompt, no server-side
//! templating).

use serde::Deserialize;
use serde_json::{Value, json};

use super::super::types::{
    ChatMessage, LlmStreamEvent, Role, ToolCall, ToolDefinition,
};
use super::{EndpointScope, ModelAdapter, StreamParser};

// ─── Adapter ────────────────────────────────────────────────────────────────

pub struct GemmaAdapter;

impl ModelAdapter for GemmaAdapter {
    fn name(&self) -> &'static str {
        "gemma"
    }

    fn endpoint_path(&self) -> &'static str {
        "/completion"
    }

    fn endpoint_scope(&self) -> EndpointScope {
        EndpointScope::ServerRoot
    }

    fn build_request_body(
        &self,
        _model: &str,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
        temperature: f32,
        max_tokens: u32,
    ) -> Value {
        let prompt = render_prompt(messages, tools);
        json!({
            "prompt": prompt,
            "n_predict": max_tokens,
            "temperature": temperature,
            "stream": true,
            "stop": ["<tool_call|>", "<turn|>"],
            // cache_prompt lets the server reuse prefix KV cache across turns
            "cache_prompt": true,
        })
    }

    fn new_stream_parser(&self) -> Box<dyn StreamParser> {
        Box::new(GemmaStreamParser::new())
    }
}

// ─── Prompt rendering ───────────────────────────────────────────────────────

fn render_prompt(messages: &[ChatMessage], tools: &[ToolDefinition]) -> String {
    let mut out = String::with_capacity(4096);

    // System message: always present, includes tools
    out.push_str("<bos><|turn>system\n<|think|>");
    render_system_content(&mut out, messages, tools);
    out.push_str("<turn|>\n");

    // Conversation turns
    let mut pending_tool_results: Vec<(&str, &str)> = Vec::new(); // (call_id, content)

    for msg in messages {
        match msg.role {
            Role::System => {} // Already handled above
            Role::User => {
                // If there are pending tool results, flush them first
                if !pending_tool_results.is_empty() {
                    flush_tool_results(&mut out, &pending_tool_results);
                    pending_tool_results.clear();
                }
                out.push_str("<|turn>user\n");
                out.push_str(&msg.content);
                out.push_str("<turn|>\n");
            }
            Role::Assistant => {
                out.push_str("<|turn>model\n");
                // If assistant has tool calls, render them
                if let Some(ref tool_calls) = msg.tool_calls {
                    for tc in tool_calls {
                        out.push_str("<|tool_call>");
                        // Render in Gemma's native format
                        render_tool_call_native(&mut out, tc);
                        out.push_str("<tool_call|>");
                    }
                }
                if !msg.content.is_empty() {
                    out.push_str(&msg.content);
                }
                out.push_str("<turn|>\n");
            }
            Role::Tool => {
                pending_tool_results
                    .push((msg.tool_call_id.as_deref().unwrap_or(""), &msg.content));
            }
        }
    }

    // Flush any remaining tool results
    if !pending_tool_results.is_empty() {
        flush_tool_results(&mut out, &pending_tool_results);
        pending_tool_results.clear();
    }

    // Open the model turn for generation
    out.push_str("<|turn>model\n");
    out
}

/// Render the system message content, merging any explicit system messages
/// from the conversation with tool definitions.
fn render_system_content(
    out: &mut String,
    messages: &[ChatMessage],
    tools: &[ToolDefinition],
) {
    // Collect system messages
    for msg in messages {
        if msg.role == Role::System {
            out.push_str(&msg.content);
            out.push('\n');
        }
    }

    // Append tool definitions
    if !tools.is_empty() {
        out.push_str("\n## Available Tools\n\n");

        for tool in tools {
            out.push_str("### ");
            out.push_str(&tool.function.name);
            out.push('\n');
            if !tool.function.description.is_empty() {
                out.push_str(&tool.function.description);
                out.push('\n');
            }
            out.push_str("Parameters: ");
            render_params_compact(out, &tool.function.parameters);
            out.push_str("\n\n");
        }

        out.push_str("\n## Tool Call Format\n\n");
        out.push_str("To call a tool, output valid JSON between <|tool_call> and <tool_call|> tags.\n\n");

        // Build a concrete worked example using the first tool
        let example_tool = &tools[0];
        let mut example_args = String::from("{");
        if let Some(props) = example_tool.function.parameters.get("properties").and_then(|p| p.as_object()) {
            for (i, (key, schema)) in props.iter().enumerate() {
                if i > 0 { example_args.push_str(", "); }
                let example_val = match schema.get("type").and_then(|t| t.as_str()) {
                    Some("integer") => "42".to_string(),
                    Some("boolean") => "true".to_string(),
                    _ => format!("\"example_{key}\""),
                };
                example_args.push_str(&format!("\"{key}\": {example_val}"));
            }
        }
        example_args.push('}');

        out.push_str("Example:\n");
        out.push_str("<|tool_call>\n");
        out.push_str(&format!(
            "{{\"name\": \"{}\", \"arguments\": {}}}\n",
            example_tool.function.name, example_args
        ));
        out.push_str("<tool_call|>\n\n");

        out.push_str("Rules:\n");
        out.push_str("- The JSON MUST have \"name\" (string) and \"arguments\" (object) fields.\n");
        out.push_str("- ALL string values MUST be wrapped in double quotes: \"like this\".\n");
        out.push_str("- Multi-line strings use \\n for newlines: \"line1\\nline2\\nline3\".\n");
        out.push_str("- Do NOT use the call:name{} syntax. Use standard JSON only.\n");
        out.push_str("- Escape special characters in strings: \\\" for quotes, \\\\ for backslash.\n");
        out.push_str("- Do NOT invent tools. Only call tools listed above.\n");
        out.push_str("- After calling a tool, STOP and wait for the result. Do NOT guess the output.\n\n");
        out.push_str("Tool results will be provided in <|tool_response>...<tool_response|> blocks.\n");
    }
}

/// Render a tool call in Gemma's native pseudo-syntax.
/// Format: `call:NAME{key: "value", key2: "value2"}`
fn render_tool_call_native(out: &mut String, tc: &ToolCall) {
    out.push_str("call:");
    out.push_str(&tc.function.name);
    // Parse arguments JSON and render in native format
    if let Ok(args) = serde_json::from_str::<serde_json::Map<String, Value>>(&tc.function.arguments)
    {
        out.push('{');
        let mut sorted_keys: Vec<&String> = args.keys().collect();
        sorted_keys.sort();
        for (i, key) in sorted_keys.iter().enumerate() {
            if i > 0 {
                out.push_str(", ");
            }
            out.push_str(key);
            out.push_str(": ");
            render_native_value(out, &args[*key]);
        }
        out.push('}');
    } else {
        // Fallback: just dump the raw arguments string
        out.push('{');
        out.push_str(&tc.function.arguments);
        out.push('}');
    }
}

/// Render a JSON value in Gemma's native format.
fn render_native_value(out: &mut String, value: &Value) {
    match value {
        Value::String(s) => {
            out.push('"');
            for ch in s.chars() {
                match ch {
                    '"' => out.push_str("\\\""),
                    '\\' => out.push_str("\\\\"),
                    '\n' => out.push_str("\\n"),
                    '\r' => out.push_str("\\r"),
                    '\t' => out.push_str("\\t"),
                    c => out.push(c),
                }
            }
            out.push('"');
        }
        Value::Number(n) => out.push_str(&n.to_string()),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Null => out.push_str("null"),
        Value::Array(arr) => {
            out.push('[');
            for (i, v) in arr.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                render_native_value(out, v);
            }
            out.push(']');
        }
        Value::Object(obj) => {
            out.push('{');
            let mut sorted: Vec<(&String, &Value)> = obj.iter().collect();
            sorted.sort_by_key(|(k, _)| *k);
            for (i, (k, v)) in sorted.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                out.push_str(k);
                out.push_str(": ");
                render_native_value(out, v);
            }
            out.push('}');
        }
    }
}

/// Render tool results wrapped in Gemma's native tool_response tags.
fn flush_tool_results(out: &mut String, results: &[(&str, &str)]) {
    out.push_str("<|turn>user\n");
    for (_, content) in results {
        out.push_str("<|tool_response>");
        out.push_str(content);
        out.push_str("<tool_response|>");
    }
    out.push_str("<turn|>\n");
}

/// Compact JSON-like parameter rendering for tool definitions.
fn render_params_compact(out: &mut String, schema: &Value) {
    let props = match schema.get("properties").and_then(|p| p.as_object()) {
        Some(p) => p,
        None => {
            out.push_str("(none)");
            return;
        }
    };
    let required: Vec<&str> = schema
        .get("required")
        .and_then(|r| r.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();

    out.push('{');
    let mut sorted_keys: Vec<&String> = props.keys().collect();
    sorted_keys.sort();
    for (i, key) in sorted_keys.iter().enumerate() {
        if i > 0 {
            out.push_str(", ");
        }
        let prop = &props[*key];
        let type_str = extract_type(prop);
        let is_required = required.contains(&key.as_str());
        out.push_str(key);
        out.push_str(": ");
        out.push_str(&type_str);
        if !is_required {
            out.push_str(" (optional)");
        }
    }
    out.push('}');
}

fn extract_type(prop: &Value) -> String {
    match prop.get("type") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(arr)) => {
            let types: Vec<&str> = arr
                .iter()
                .filter_map(|v| v.as_str())
                .filter(|s| *s != "null")
                .collect();
            if types.len() == 1 {
                format!("{} (optional)", types[0])
            } else if types.is_empty() {
                "any".to_string()
            } else {
                types.join("|")
            }
        }
        _ => "any".to_string(),
    }
}

// ─── SSE response types (llama.cpp /completion) ─────────────────────────────

#[derive(Deserialize, Default)]
struct CompletionChunk {
    #[serde(default)]
    content: String,
    #[serde(default)]
    stop: bool,
    #[serde(default)]
    #[allow(dead_code)]
    stop_type: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    stopping_word: Option<String>,
}

// ─── Stream parser ──────────────────────────────────────────────────────────

/// Stream parser for Gemma 4's native output format.
///
/// The model produces:
/// - `<|channel>thought\n...<channel|>` — reasoning (strip or emit as reasoning)
/// - `<|tool_call>call:NAME{args}<tool_call|>` — tool calls (server stops here)
/// - Plain text — assistant response content
///
/// When the server stops at `<tool_call|>`, the final chunk has
/// `stop_type: "word"` and `stopping_word: "<tool_call|>"`. We use this to
/// know that the preceding content was a tool call.
pub(crate) struct GemmaStreamParser {
    /// Accumulated raw content from all chunks.
    buffer: String,
    /// Whether we've emitted Done.
    done_emitted: bool,
    /// Whether we're inside a `<|channel>thought` block (reasoning).
    in_thinking: bool,
    /// Whether we've already emitted the tool call for this turn.
    tool_call_emitted: bool,
    /// Counter for tool call indices.
    tool_call_index: usize,
}

impl GemmaStreamParser {
    pub fn new() -> Self {
        Self {
            buffer: String::new(),
            done_emitted: false,
            in_thinking: false,
            tool_call_emitted: false,
            tool_call_index: 0,
        }
    }
}

impl StreamParser for GemmaStreamParser {
    fn process_sse_data(&mut self, data: &str) -> Vec<LlmStreamEvent> {
        let chunk: CompletionChunk = match serde_json::from_str(data) {
            Ok(c) => c,
            Err(_) => return vec![],
        };

        let mut events = Vec::new();

        if !chunk.content.is_empty() {
            self.buffer.push_str(&chunk.content);
            // Process buffer for thinking blocks and text
            self.drain_buffer(&mut events);
        }

        if chunk.stop {
            // Check if we stopped at a tool call boundary
            if chunk.stopping_word.as_deref() == Some("<tool_call|>") {
                // The buffer should contain the tool call content
                self.emit_pending_tool_call(&mut events);
            }

            if !self.done_emitted {
                self.done_emitted = true;
                let finish = if chunk.stopping_word.as_deref() == Some("<tool_call|>") {
                    Some("tool_calls".to_string())
                } else {
                    // llama.cpp sends stop_type: "word" when stopped by a stop
                    // token, "eos" at end-of-sequence. Both mean the model is
                    // done with this turn. Normalize to "stop" for the orch.
                    Some("stop".to_string())
                };
                events.push(LlmStreamEvent::Done {
                    finish_reason: finish,
                });
            }
        }

        events
    }

    fn finalize(&mut self) -> Vec<LlmStreamEvent> {
        let mut events = Vec::new();
        // Flush any remaining text
        let remaining = std::mem::take(&mut self.buffer);
        let text = strip_thinking(&remaining);
        if !text.is_empty() {
            events.push(LlmStreamEvent::TextDelta(text));
        }
        if !self.done_emitted {
            self.done_emitted = true;
            events.push(LlmStreamEvent::Done {
                finish_reason: Some("stop".to_string()),
            });
        }
        events
    }
}

impl GemmaStreamParser {
    /// Process buffer contents, extracting thinking blocks and text.
    fn drain_buffer(&mut self, events: &mut Vec<LlmStreamEvent>) {
        // We process in a simple streaming fashion:
        // - `<|channel>thought\n` opens a thinking block
        // - `<channel|>` closes it
        // - `<|tool_call>` opens a tool call (keep in buffer for final parse)
        // - Everything else is text content

        loop {
            if self.in_thinking {
                // Look for end of thinking block
                if let Some(pos) = self.buffer.find("<channel|>") {
                    let reasoning = self.buffer[..pos].to_string();
                    self.buffer.drain(..pos + "<channel|>".len());
                    self.in_thinking = false;
                    if !reasoning.is_empty() {
                        events.push(LlmStreamEvent::ReasoningDelta(reasoning));
                    }
                    continue;
                }
                // Might be partial — check if we can safely emit some reasoning
                let safe = safe_emit_len(&self.buffer, "<channel|>");
                if safe > 0 {
                    let reasoning: String = self.buffer.drain(..safe).collect();
                    events.push(LlmStreamEvent::ReasoningDelta(reasoning));
                }
                return;
            }

            // Check for thinking block start — accept both \n and space after "thought"
            let think_marker = if let Some(pos) = self.buffer.find("<|channel>thought\n") {
                Some((pos, "<|channel>thought\n".len()))
            } else if let Some(pos) = self.buffer.find("<|channel>thought ") {
                Some((pos, "<|channel>thought ".len()))
            } else {
                None
            };
            if let Some((pos, marker_len)) = think_marker {
                // Emit any text before the thinking block
                if pos > 0 {
                    let text: String = self.buffer.drain(..pos).collect();
                    if !text.is_empty() {
                        events.push(LlmStreamEvent::TextDelta(text));
                    }
                }
                self.buffer.drain(..marker_len);
                self.in_thinking = true;
                continue;
            }

            // Check for tool call start — keep it in buffer, don't emit as text
            if let Some(pos) = self.buffer.find("<|tool_call>") {
                // Emit text before tool call marker
                if pos > 0 {
                    let text: String = self.buffer.drain(..pos).collect();
                    if !text.is_empty() {
                        events.push(LlmStreamEvent::TextDelta(text));
                    }
                }
                // Keep the rest (including <|tool_call>) in buffer for final parse
                return;
            }

            // No markers found. Emit text safely (keeping potential partial tags
            // in the buffer).
            let safe = safe_emit_len_multi(
                &self.buffer,
                &["<|channel>thought\n", "<|channel>thought ", "<|tool_call>"],
            );
            if safe == 0 {
                return;
            }
            let text: String = self.buffer.drain(..safe).collect();
            if !text.is_empty() {
                events.push(LlmStreamEvent::TextDelta(text));
            }
            return;
        }
    }

    /// Parse and emit a tool call from the buffer.
    /// Called when we know the server stopped at `<tool_call|>`.
    fn emit_pending_tool_call(&mut self, events: &mut Vec<LlmStreamEvent>) {
        if self.tool_call_emitted {
            return;
        }

        // Strip thinking blocks first
        let raw = strip_thinking(&self.buffer);

        // Find and parse the tool call
        let tc_start = raw
            .find("<|tool_call>")
            .map(|start| start + "<|tool_call>".len())
            .unwrap_or(0);
        let tc_content = raw[tc_start..].trim();

        let idx = self.tool_call_index;
        self.tool_call_index += 1;
        self.tool_call_emitted = true;

        match parse_gemma_tool_call(tc_content) {
            Ok((name, args_json)) => {
                events.push(LlmStreamEvent::ToolCallDelta {
                    index: idx,
                    id: Some(format!("call_{}", idx + 1)),
                    name: Some(name),
                    arguments_chunk: args_json,
                });
            }
            Err(parse_err) => {
                // Emit a sentinel tool call that the executor will reject with a
                // helpful error message explaining the required JSON format.
                let raw_preview = if tc_content.len() > 200 {
                    format!("{}...", &tc_content[..200])
                } else {
                    tc_content.to_string()
                };
                events.push(LlmStreamEvent::ToolCallDelta {
                    index: idx,
                    id: Some(format!("call_{}", idx + 1)),
                    name: Some("__format_error__".to_string()),
                    arguments_chunk: serde_json::json!({
                        "raw": raw_preview,
                        "error": parse_err,
                    })
                    .to_string(),
                });
            }
        }

        self.buffer.clear();
    }
}

// ─── Gemma native tool call parser ──────────────────────────────────────────

/// Parse a tool call from the model's output. Tries multiple strategies:
///
/// 1. Standard JSON: `{"name":"read","arguments":{"file_path":"/tmp/x.txt"}}`
/// 2. Gemma's native format: `call:read{file_path: "/tmp/x.txt"}`
///
/// For strategy 2, all string values MUST be quoted (double or single).
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

    // Extract content between matching braces
    let args_str = &after_prefix[brace_pos + 1..];
    let args_str = if args_str.ends_with('}') {
        &args_str[..args_str.len() - 1]
    } else {
        args_str
    };

    // Parse key-value pairs — all values MUST be quoted
    let args = parse_native_args(args_str)?;
    let json_str = serde_json::to_string(&args).unwrap_or_else(|_| "{}".to_string());

    Ok((name, json_str))
}

/// Parse Gemma's native key-value arguments: `key: "value", key2: 'value2'`
/// into a JSON object. Returns an error if any value is unquoted (except
/// JSON primitives: true, false, null, numbers).
fn parse_native_args(input: &str) -> Result<serde_json::Map<String, Value>, String> {
    let mut map = serde_json::Map::new();
    let mut chars = input.chars().peekable();

    loop {
        // Skip whitespace
        skip_ws(&mut chars);

        if chars.peek().is_none() {
            break;
        }

        // Parse key (bare identifier)
        let key = parse_bare_key(&mut chars);
        if key.is_empty() {
            break;
        }

        // Skip `: ` separator
        skip_ws(&mut chars);
        if chars.peek() == Some(&':') {
            chars.next();
        }
        skip_ws(&mut chars);

        // Parse value — strict: strings must be quoted
        let value = parse_value_strict(&mut chars, &key)?;
        map.insert(key, value);

        // Skip comma/whitespace
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

/// The Gemma special string-quote token. The model emits this instead of `"`
/// when producing tool calls in its native format.
const GEMMA_QUOTE: &str = "<|\"|>";

/// Parse a value strictly — strings must be quoted with `"`, `'`, or Gemma's
/// native `<|"|>` token. Only JSON primitives (true, false, null, numbers)
/// are allowed unquoted. Returns an error if the model produced an unquoted
/// string value.
fn parse_value_strict(
    chars: &mut std::iter::Peekable<std::str::Chars>,
    key: &str,
) -> Result<Value, String> {
    // Check for Gemma's native <|"|> quote token first.
    // We peek ahead to see if the remaining chars start with <|"|>.
    if chars.peek() == Some(&'<') {
        // Speculatively collect up to 5 chars to check for <|"|>
        let peeked: String = chars.clone().take(5).collect();
        if peeked == GEMMA_QUOTE {
            // Consume the 5-char <|"|> opening delimiter
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
            chars.next(); // consume '{'
            let inner = parse_native_args(&collect_until_matching_brace(chars))?;
            Ok(Value::Object(inner))
        }
        Some(&'[') => {
            chars.next(); // consume '['
            parse_array(chars)
        }
        // Bare tokens: only allow JSON primitives (true, false, null, numbers)
        Some(&_c) => {
            // Collect the bare token
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
/// Reads chars until the next `<|"|>` closing delimiter.
fn parse_gemma_quoted_string(chars: &mut std::iter::Peekable<std::str::Chars>) -> String {
    let mut s = String::new();
    loop {
        // Check if we've hit the closing <|"|>
        if chars.peek() == Some(&'<') {
            let peeked: String = chars.clone().take(5).collect();
            if peeked == GEMMA_QUOTE {
                // Consume the closing delimiter
                for _ in 0..5 {
                    chars.next();
                }
                break;
            }
        }
        match chars.next() {
            Some('\\') => {
                // Handle escape sequences
                match chars.next() {
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
                }
            }
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
    let mut depth = 1;
    while let Some(c) = chars.next() {
        if c == '{' {
            depth += 1;
        } else if c == '}' {
            depth -= 1;
            if depth == 0 {
                break;
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

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Strip `<|channel>thought\n...<channel|>` blocks from text.
/// Also handles `<|channel>thought ...<channel|>` (space instead of newline).
fn strip_thinking(text: &str) -> String {
    let mut result = String::new();
    let mut remaining = text;
    loop {
        let pos_nl = remaining.find("<|channel>thought\n");
        let pos_sp = remaining.find("<|channel>thought ");
        let start = match (pos_nl, pos_sp) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (Some(a), None) | (None, Some(a)) => Some(a),
            (None, None) => None,
        };
        let Some(start) = start else { break };
        result.push_str(&remaining[..start]);
        // Skip past the `<|channel>thought` + delimiter char
        let after = start + "<|channel>thought".len() + 1;
        remaining = &remaining[after..];
        if let Some(end) = remaining.find("<channel|>") {
            remaining = &remaining[end + "<channel|>".len()..];
        } else {
            // Unclosed thinking block — discard the rest
            return result;
        }
    }
    result.push_str(remaining);
    result
}

/// How much of `buffer` can we safely emit without splitting a potential tag?
fn safe_emit_len(buffer: &str, tag: &str) -> usize {
    let len = buffer.len();
    if len == 0 {
        return 0;
    }
    // Check if any suffix of buffer could be a prefix of the tag
    for i in (1..=tag.len().min(len)).rev() {
        if buffer.ends_with(&tag[..i]) {
            return len - i;
        }
    }
    len
}

/// Safe emit length checking multiple potential tags.
fn safe_emit_len_multi(buffer: &str, tags: &[&str]) -> usize {
    let mut min = buffer.len();
    for tag in tags {
        min = min.min(safe_emit_len(buffer, tag));
    }
    min
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::types::{FunctionCall, FunctionDef};

    // Helper to make ChatMessage construction less verbose in tests
    fn user_msg(content: &str) -> ChatMessage {
        ChatMessage {
            role: Role::User,
            content: content.to_string(),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    fn system_msg(content: &str) -> ChatMessage {
        ChatMessage {
            role: Role::System,
            content: content.to_string(),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    fn assistant_msg(content: &str, tool_calls: Option<Vec<ToolCall>>) -> ChatMessage {
        ChatMessage {
            role: Role::Assistant,
            content: content.to_string(),
            tool_calls,
            tool_call_id: None,
            name: None,
        }
    }

    fn tool_msg(content: &str, call_id: &str) -> ChatMessage {
        ChatMessage {
            role: Role::Tool,
            content: content.to_string(),
            tool_calls: None,
            tool_call_id: Some(call_id.to_string()),
            name: None,
        }
    }

    // ── Tool call parsing ───────────────────────────────────────────────

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
        // Strict mode: bare unquoted string values are rejected
        let result =
            parse_gemma_tool_call(r#"call:write{content: 1\n2\n3, file_path: "/tmp/f.txt"}"#);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not valid JSON"));
    }

    #[test]
    fn parse_bare_boolean_value() {
        // Bare booleans (true, false) and null are allowed as JSON primitives
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

    // ── Thinking block stripping ────────────────────────────────────────

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

    // ── Prompt rendering ────────────────────────────────────────────────

    #[test]
    fn render_simple_user_message() {
        let messages = vec![user_msg("Hello")];
        let prompt = render_prompt(&messages, &[]);
        assert!(prompt.starts_with("<bos><|turn>system\n<|think|>"));
        assert!(prompt.contains("<|turn>user\nHello<turn|>"));
        assert!(prompt.ends_with("<|turn>model\n"));
    }

    #[test]
    fn render_with_system_message() {
        let messages = vec![system_msg("Be helpful."), user_msg("Hi")];
        let prompt = render_prompt(&messages, &[]);
        assert!(prompt.contains("<bos><|turn>system\n<|think|>Be helpful.\n"));
    }

    #[test]
    fn render_with_tools() {
        let tools = vec![ToolDefinition {
            def_type: "function".to_string(),
            function: FunctionDef {
                name: "shell".to_string(),
                description: "Run a command.".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "description": "The command"}
                    },
                    "required": ["command"]
                }),
            },
        }];
        let messages = vec![user_msg("Help")];
        let prompt = render_prompt(&messages, &tools);
        assert!(prompt.contains("### shell"));
        assert!(prompt.contains("Run a command."));
        assert!(prompt.contains("command: string"));
    }

    #[test]
    fn render_tool_call_and_result() {
        let messages = vec![
            user_msg("Read foo.txt"),
            assistant_msg("", Some(vec![ToolCall {
                id: "call_1".to_string(),
                call_type: "function".to_string(),
                function: FunctionCall {
                    name: "read".to_string(),
                    arguments: r#"{"file_path":"/tmp/foo.txt"}"#.to_string(),
                },
            }])),
            tool_msg("hello world", "call_1"),
        ];
        let prompt = render_prompt(&messages, &[]);
        assert!(prompt.contains("<|tool_call>call:read{file_path: \""));
        assert!(prompt.contains("<tool_call|>"));
        assert!(prompt.contains("<|tool_response>hello world<tool_response|>"));
    }

    // ── Stream parser ───────────────────────────────────────────────────

    #[test]
    fn parse_stream_text_only() {
        let mut parser = GemmaStreamParser::new();
        let events = parser.process_sse_data(
            r#"{"content":"Hello","stop":false}"#,
        );
        assert!(events.iter().any(|e| matches!(e, LlmStreamEvent::TextDelta(t) if t == "Hello")));
    }

    #[test]
    fn parse_stream_thinking_then_text() {
        let mut parser = GemmaStreamParser::new();
        let e1 = parser.process_sse_data(
            r#"{"content":"<|channel>thought\nI think...<channel|>The answer is 42.","stop":false}"#,
        );
        assert!(e1.iter().any(|e| matches!(e, LlmStreamEvent::ReasoningDelta(t) if t.contains("I think"))));
        assert!(e1.iter().any(|e| matches!(e, LlmStreamEvent::TextDelta(t) if t.contains("42"))));
    }

    #[test]
    fn parse_stream_tool_call_stop() {
        let mut parser = GemmaStreamParser::new();
        let e1 = parser.process_sse_data(
            r#"{"content":"<|channel>thought\nLet me read it.\n<channel|><|tool_call>call:read{file_path: \"/tmp/test.txt\"}","stop":false}"#,
        );
        assert!(!e1.iter().any(|e| matches!(e, LlmStreamEvent::ToolCallDelta { .. })));

        let e2 = parser.process_sse_data(
            r#"{"content":"","stop":true,"stop_type":"word","stopping_word":"<tool_call|>"}"#,
        );
        assert!(e2.iter().any(|e| matches!(e, LlmStreamEvent::ToolCallDelta { name: Some(n), .. } if n == "read")));
        assert!(e2.iter().any(|e| matches!(e, LlmStreamEvent::Done { .. })));
    }

    #[test]
    fn parse_stream_normal_stop() {
        let mut parser = GemmaStreamParser::new();
        let events = parser.process_sse_data(
            r#"{"content":"Done!","stop":true,"stop_type":"eos"}"#,
        );
        assert!(events.iter().any(|e| matches!(e, LlmStreamEvent::TextDelta(t) if t.contains("Done"))));
        assert!(events.iter().any(|e| matches!(e, LlmStreamEvent::Done { finish_reason: Some(r) } if r == "stop")));
    }

    #[test]
    fn parse_stream_incremental_thinking() {
        let mut parser = GemmaStreamParser::new();
        let e1 = parser.process_sse_data(
            r#"{"content":"<|channel>thought\nPart 1","stop":false}"#,
        );
        assert!(e1.iter().any(|e| matches!(e, LlmStreamEvent::ReasoningDelta(..))));

        let e2 = parser.process_sse_data(
            r#"{"content":" Part 2<channel|>Answer","stop":false}"#,
        );
        assert!(e2.iter().any(|e| matches!(e, LlmStreamEvent::TextDelta(t) if t.contains("Answer"))));
    }

    // ── Safe emit ───────────────────────────────────────────────────────

    #[test]
    fn safe_emit_partial_tag() {
        assert_eq!(safe_emit_len("hello <|", "<|channel>thought\n"), 6);
        assert_eq!(safe_emit_len("hello <|chan", "<|channel>thought\n"), 6);
        assert_eq!(safe_emit_len("hello <|channel>thought", "<|channel>thought\n"), 6);
        assert_eq!(safe_emit_len("hello", "<|channel>thought\n"), 5);
    }

    #[test]
    fn safe_emit_multi() {
        assert_eq!(
            safe_emit_len_multi("text <|", &["<|channel>thought\n", "<|tool_call>"]),
            5
        );
        // Full thinking tag prefix should be held back
        assert_eq!(
            safe_emit_len_multi("abc<|channel>thought", &["<|channel>thought\n"]),
            3
        );
    }

    // ── Gemma <|"|> quote token parsing ─────────────────────────────────

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
        // Content between <|"|> delimiters is literal — quotes are not escaped
        assert_eq!(
            args.get("command").unwrap().as_str().unwrap(),
            "echo \"hello world\" | grep hello"
        );
    }

    #[test]
    fn parse_gemma_pipe_quote_mixed_with_regular() {
        // Model might mix <|"|> and regular quotes in the same call
        let input = "call:patch{file_path:<|\"|>/tmp/foo.txt<|\"|>,old_string:\"hello\",new_string:<|\"|>world<|\"|>}";
        let (name, args) = parse_gemma_tool_call(input).unwrap();
        assert_eq!(name, "patch");
        let args: serde_json::Map<String, Value> = serde_json::from_str(&args).unwrap();
        assert_eq!(args.get("file_path").unwrap().as_str().unwrap(), "/tmp/foo.txt");
        assert_eq!(args.get("old_string").unwrap().as_str().unwrap(), "hello");
        assert_eq!(args.get("new_string").unwrap().as_str().unwrap(), "world");
    }

    #[test]
    fn parse_stream_tool_call_with_pipe_quotes() {
        let mut parser = GemmaStreamParser::new();
        let _e1 = parser.process_sse_data(
            r#"{"content":"<|channel>thought\nLet me run it.\n<channel|><|tool_call>call:shell{command:<|\"|>ls -la<|\"|>}","stop":false}"#,
        );
        let e2 = parser.process_sse_data(
            r#"{"content":"","stop":true,"stop_type":"word","stopping_word":"<tool_call|>"}"#,
        );
        let tc = e2.iter().find(|e| matches!(e, LlmStreamEvent::ToolCallDelta { .. }));
        assert!(tc.is_some());
        if let Some(LlmStreamEvent::ToolCallDelta { name, arguments_chunk, .. }) = tc {
            assert_eq!(name.as_deref(), Some("shell"));
            let args: serde_json::Map<String, Value> = serde_json::from_str(arguments_chunk).unwrap();
            assert_eq!(args.get("command").unwrap().as_str().unwrap(), "ls -la");
        }
    }
}
