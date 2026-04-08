//! Plain adapter — a self-explanatory, model-agnostic prompt format.
//!
//! This adapter is designed for open models where we don't know the native
//! template, or where we want to avoid protocol noise (like opaque
//! tool_call_ids) that can confuse smaller models. It uses only plain ASCII
//! text with no special tokens — any capable model can understand the format
//! from context alone.
//!
//! ## Format
//!
//! Turns are separated by `<<<ROLE>>>` markers. Tool calls are JSON blocks
//! wrapped in `<tool_call>...</tool_call>` tags. Tool results are bare
//! content under `<<<TOOL>>>` markers (or wrapped in `<tool_result index="N">`
//! tags when there are multiple parallel results).
//!
//! Tool calls and results are matched by **position** — there are no IDs in
//! the prompt at all. The client tracks the mapping internally.
//!
//! ## Endpoint
//!
//! This adapter targets llama.cpp's `/completion` endpoint (not
//! `/v1/chat/completions`) because we're sending a raw rendered prompt, not
//! structured chat messages.

use serde::Deserialize;
use serde_json::{Value, json};

use super::super::types::{
    ChatMessage, LlmStreamEvent, Role, ToolCall, ToolDefinition,
};
use super::{ModelAdapter, StreamParser};

/// The turn separator marker. Distinctive enough to be rare in content,
/// short enough to not dominate context.
const TURN_MARKER: &str = "<<<";

/// Plain markdown-style adapter.
pub struct PlainAdapter;

impl ModelAdapter for PlainAdapter {
    fn name(&self) -> &'static str {
        "plain"
    }

    fn endpoint_path(&self) -> &'static str {
        "/completion"
    }

    fn endpoint_scope(&self) -> super::EndpointScope {
        super::EndpointScope::ServerRoot
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
            "temperature": temperature,
            "n_predict": max_tokens,
            "stream": true,
            "stop": [TURN_MARKER],
            "cache_prompt": true,
        })
    }

    fn new_stream_parser(&self) -> Box<dyn StreamParser> {
        Box::new(PlainStreamParser::new())
    }
}

// ─── Prompt rendering ───────────────────────────────────────────────────────

/// Render the full conversation into a single prompt string.
pub(crate) fn render_prompt(messages: &[ChatMessage], tools: &[ToolDefinition]) -> String {
    let mut out = String::new();
    let mut pending_tool_results: Vec<&ChatMessage> = Vec::new();
    let has_system = matches!(messages.first().map(|m| &m.role), Some(Role::System));

    // If the conversation has no system turn but has tools, synthesize one
    // so the model gets the tool documentation.
    if !has_system && !tools.is_empty() {
        out.push_str("<<<SYSTEM>>>\n");
        out.push_str("You are a helpful agent.");
        out.push_str(&render_tools_documentation(tools));
        out.push('\n');
    }

    for (i, msg) in messages.iter().enumerate() {
        // Tool results get grouped under a single <<<TOOL>>> header when
        // they come in a consecutive run (parallel calls).
        if matches!(msg.role, Role::Tool) {
            pending_tool_results.push(msg);
            let next_is_tool = messages
                .get(i + 1)
                .map(|m| matches!(m.role, Role::Tool))
                .unwrap_or(false);
            if next_is_tool {
                continue;
            }
            flush_tool_results(&mut out, &pending_tool_results);
            pending_tool_results.clear();
            continue;
        }

        match msg.role {
            Role::System => {
                out.push_str("<<<SYSTEM>>>\n");
                out.push_str(&msg.content);
                if !tools.is_empty() {
                    out.push_str(&render_tools_documentation(tools));
                }
                out.push('\n');
            }
            Role::User => {
                out.push_str("<<<USER>>>\n");
                out.push_str(&msg.content);
                out.push('\n');
            }
            Role::Assistant => {
                out.push_str("<<<ASSISTANT>>>\n");
                if !msg.content.is_empty() {
                    out.push_str(&msg.content);
                    out.push('\n');
                }
                if let Some(calls) = &msg.tool_calls {
                    for call in calls {
                        out.push_str(&render_tool_call(call));
                        out.push('\n');
                    }
                }
            }
            Role::Tool => unreachable!("Tool role handled above"),
        }
    }

    // Generation prompt: let the model continue the assistant turn.
    out.push_str("<<<ASSISTANT>>>\n");
    out
}

/// Render one tool call as a JSON block inside `<tool_call>` tags.
fn render_tool_call(call: &ToolCall) -> String {
    // Normalize the arguments: they arrive as a string, we re-parse and
    // re-emit so the JSON is compact and well-formed.
    let args: Value = serde_json::from_str(&call.function.arguments)
        .unwrap_or(Value::Object(serde_json::Map::new()));
    let body = json!({
        "name": call.function.name,
        "arguments": args,
    });
    format!(
        "<tool_call>\n{}\n</tool_call>",
        serde_json::to_string(&body).unwrap_or_default()
    )
}

fn flush_tool_results(out: &mut String, results: &[&ChatMessage]) {
    if results.is_empty() {
        return;
    }
    out.push_str("<<<TOOL>>>\n");
    if results.len() == 1 {
        out.push_str(&results[0].content);
        out.push('\n');
    } else {
        for (i, msg) in results.iter().enumerate() {
            out.push_str(&format!("<tool_result index=\"{}\">\n", i + 1));
            out.push_str(&msg.content);
            out.push_str("\n</tool_result>\n");
        }
    }
}

/// Render the "Available Tools" documentation for the system prompt.
fn render_tools_documentation(tools: &[ToolDefinition]) -> String {
    if tools.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    out.push_str("\n\n## Available Tools\n\n");
    for tool in tools {
        out.push_str("### ");
        out.push_str(&tool.function.name);
        out.push('\n');
        if !tool.function.description.is_empty() {
            out.push_str(&tool.function.description);
            out.push('\n');
        }
        out.push_str("Parameters:\n");
        out.push_str(&render_parameters(&tool.function.parameters));
        out.push_str("\n\n");
    }
    out.push_str(
        "To call a tool, emit a <tool_call> block with JSON:\n\
         <tool_call>\n\
         {\"name\": \"tool_name\", \"arguments\": {...}}\n\
         </tool_call>\n\
         \n\
         Emit multiple <tool_call> blocks for parallel calls. After tool \
         execution, results arrive in a <<<TOOL>>> turn, then you continue \
         in a new <<<ASSISTANT>>> turn.",
    );
    out
}

/// Render a JSON-schema object as a flat, readable parameter description.
fn render_parameters(params: &Value) -> String {
    let Some(obj) = params.as_object() else {
        return "(none)".to_string();
    };
    let Some(props) = obj.get("properties").and_then(|p| p.as_object()) else {
        return "(none)".to_string();
    };
    if props.is_empty() {
        return "(none)".to_string();
    }
    let required: Vec<&str> = obj
        .get("required")
        .and_then(|r| r.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();

    let mut names: Vec<&String> = props.keys().collect();
    names.sort();

    let mut lines = vec!["{".to_string()];
    let last_idx = names.len() - 1;
    for (i, name) in names.iter().enumerate() {
        let prop = &props[*name];
        let is_required = required.contains(&name.as_str());
        let type_str = extract_type(prop);
        let description = prop
            .get("description")
            .and_then(|d| d.as_str())
            .unwrap_or("");
        let mut parts = vec![format!("\"type\": \"{}\"", type_str)];
        parts.push(format!(
            "\"required\": {}",
            if is_required { "true" } else { "false" }
        ));
        if !description.is_empty() {
            parts.push(format!(
                "\"description\": \"{}\"",
                description.replace('\\', "\\\\").replace('"', "\\\"")
            ));
        }
        lines.push(format!(
            "  \"{}\": {{{}}}{}",
            name,
            parts.join(", "),
            if i == last_idx { "" } else { "," }
        ));
    }
    lines.push("}".to_string());
    lines.join("\n")
}

/// Extract a readable type string from a JSON schema property value.
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
                types[0].to_string()
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
}

// ─── Stream parser ──────────────────────────────────────────────────────────

/// State machine for parsing the model's raw streaming output.
///
/// The model emits plain text interspersed with `<tool_call>...</tool_call>`
/// blocks. We need to:
///   1. Separate text from tool calls
///   2. Buffer tool-call JSON until the closing tag arrives
///   3. Stop at `<<<` (next turn marker) — llama.cpp also enforces this
///      server-side via our `stop` parameter
///   4. Handle partial tags split across chunks
pub(crate) struct PlainStreamParser {
    /// Accumulated buffer of text we haven't emitted yet. May contain a
    /// partial tag at the tail that we're holding until more data arrives.
    buffer: String,
    /// Whether we're currently inside a `<tool_call>` block.
    in_tool_call: bool,
    /// Synthetic index counter for tool calls we extract.
    tool_call_index: usize,
    /// Whether we've already emitted a `Done` event.
    done_emitted: bool,
}

impl PlainStreamParser {
    pub fn new() -> Self {
        Self {
            buffer: String::new(),
            in_tool_call: false,
            tool_call_index: 0,
            done_emitted: false,
        }
    }

    /// Drain as much of `self.buffer` as possible, emitting events.
    fn drain_buffer(&mut self, events: &mut Vec<LlmStreamEvent>) {
        loop {
            if self.in_tool_call {
                // Look for closing tag
                if let Some(end) = self.buffer.find("</tool_call>") {
                    let json_text = self.buffer[..end].trim().to_string();
                    self.buffer.drain(..end + "</tool_call>".len());
                    self.in_tool_call = false;
                    self.emit_tool_call(events, &json_text);
                    continue;
                }
                // Still inside tool call, waiting for closing tag.
                return;
            }

            // Not in tool call. Look for the next interesting marker.
            let open = self.buffer.find("<tool_call>");
            let stop = self.buffer.find(TURN_MARKER);

            match (open, stop) {
                (Some(o), Some(s)) if s < o => {
                    let text = self.buffer[..s].to_string();
                    self.buffer.clear();
                    if !text.is_empty() {
                        events.push(LlmStreamEvent::TextDelta(text));
                    }
                    return;
                }
                (None, Some(s)) => {
                    let text = self.buffer[..s].to_string();
                    self.buffer.clear();
                    if !text.is_empty() {
                        events.push(LlmStreamEvent::TextDelta(text));
                    }
                    return;
                }
                (Some(o), _) => {
                    if o > 0 {
                        let text = self.buffer[..o].to_string();
                        events.push(LlmStreamEvent::TextDelta(text));
                    }
                    self.buffer.drain(..o + "<tool_call>".len());
                    self.in_tool_call = true;
                    continue;
                }
                (None, None) => {
                    let safe = safe_flush_len(&self.buffer);
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
        }
    }

    fn emit_tool_call(&mut self, events: &mut Vec<LlmStreamEvent>, json_text: &str) {
        match serde_json::from_str::<Value>(json_text) {
            Ok(v) => {
                let name = v
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                let arguments_chunk = v
                    .get("arguments")
                    .map(|a| serde_json::to_string(a).unwrap_or_default())
                    .unwrap_or_else(|| "{}".to_string());
                let index = self.tool_call_index;
                self.tool_call_index += 1;
                events.push(LlmStreamEvent::ToolCallDelta {
                    index,
                    id: Some(format!("call_{}", index + 1)),
                    name: Some(name),
                    arguments_chunk,
                });
            }
            Err(e) => {
                events.push(LlmStreamEvent::Error(format!(
                    "Malformed tool_call JSON: {e} (body: {json_text:?})"
                )));
            }
        }
    }
}

/// Compute how many bytes of the buffer can be safely emitted without
/// splitting a partial `<tool_call>` or `<<<` marker at the tail.
fn safe_flush_len(buf: &str) -> usize {
    // Longest marker we might be forming is "<tool_call>" (11 bytes).
    // If any `<` exists in the last 11 bytes, stop at that byte.
    let max_lookback = 11.min(buf.len());
    if max_lookback == 0 {
        return 0;
    }
    let tail_start = buf.len() - max_lookback;
    for i in tail_start..buf.len() {
        if buf.as_bytes()[i] == b'<' {
            return i;
        }
    }
    buf.len()
}

impl StreamParser for PlainStreamParser {
    fn process_sse_data(&mut self, data: &str) -> Vec<LlmStreamEvent> {
        let chunk: CompletionChunk = match serde_json::from_str(data) {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };

        let mut events = Vec::new();

        if !chunk.content.is_empty() {
            self.buffer.push_str(&chunk.content);
            self.drain_buffer(&mut events);
        }

        if chunk.stop {
            // Flush anything remaining in buffer as text (unless we're
            // mid-tool-call, in which case we discard — the model didn't
            // finish the call).
            if !self.in_tool_call && !self.buffer.is_empty() {
                let text = std::mem::take(&mut self.buffer);
                events.push(LlmStreamEvent::TextDelta(text));
            } else if self.in_tool_call {
                events.push(LlmStreamEvent::Error(
                    "Stream ended mid tool_call".to_string(),
                ));
            }
            if !self.done_emitted {
                // Normalize all stop types to "stop" for the orchestrator.
                // llama.cpp sends "word" / "eos" / etc. — all mean "done".
                let finish_reason = Some("stop".to_string());
                events.push(LlmStreamEvent::Done { finish_reason });
                self.done_emitted = true;
            }
        }

        events
    }

    fn finalize(&mut self) -> Vec<LlmStreamEvent> {
        let mut events = Vec::new();
        if !self.in_tool_call && !self.buffer.is_empty() {
            let text = std::mem::take(&mut self.buffer);
            events.push(LlmStreamEvent::TextDelta(text));
        }
        if !self.done_emitted {
            // Stream ended without [DONE] or finish_reason — abnormal termination.
            events.push(LlmStreamEvent::Done {
                finish_reason: Some("stream_ended".to_string()),
            });
            self.done_emitted = true;
        }
        events
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::types::{FunctionCall, FunctionDef};

    fn make_tool(name: &str, desc: &str) -> ToolDefinition {
        ToolDefinition {
            def_type: "function".into(),
            function: FunctionDef {
                name: name.into(),
                description: desc.into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "description": "cmd to run"}
                    },
                    "required": ["command"]
                }),
            },
        }
    }

    fn chunk_json(content: &str) -> String {
        json!({"content": content, "stop": false}).to_string()
    }
    fn stop_chunk() -> String {
        json!({"content": "", "stop": true, "stop_type": "eos"}).to_string()
    }

    #[test]
    fn name_returns_plain() {
        assert_eq!(PlainAdapter.name(), "plain");
    }

    #[test]
    fn endpoint_is_completion() {
        assert_eq!(PlainAdapter.endpoint_path(), "/completion");
    }

    #[test]
    fn build_request_body_has_prompt_and_stops() {
        let body = PlainAdapter.build_request_body(
            "model",
            &[ChatMessage::user("Hi")],
            &[],
            0.2,
            100,
        );
        assert!(body["prompt"].is_string());
        assert!(body["prompt"].as_str().unwrap().contains("<<<USER>>>"));
        assert_eq!(body["stream"], json!(true));
        assert_eq!(body["n_predict"], json!(100));
        assert_eq!(body["stop"][0], json!("<<<"));
    }

    // ─ Rendering tests ──────────────────────────────────────────────────────

    #[test]
    fn renders_system_user_basic() {
        let prompt = render_prompt(
            &[
                ChatMessage::system("You are helpful."),
                ChatMessage::user("Hi"),
            ],
            &[],
        );
        assert!(prompt.contains("<<<SYSTEM>>>\nYou are helpful."));
        assert!(prompt.contains("<<<USER>>>\nHi"));
        assert!(prompt.ends_with("<<<ASSISTANT>>>\n"));
    }

    #[test]
    fn injects_tools_into_system() {
        let prompt = render_prompt(
            &[
                ChatMessage::system("You are a coder."),
                ChatMessage::user("List files"),
            ],
            &[make_tool("shell", "Run a shell command")],
        );
        assert!(prompt.contains("## Available Tools"));
        assert!(prompt.contains("### shell"));
        assert!(prompt.contains("Run a shell command"));
        assert!(prompt.contains("\"command\""));
        assert!(prompt.contains("\"required\": true"));
    }

    #[test]
    fn synthesizes_system_when_missing() {
        let prompt = render_prompt(
            &[ChatMessage::user("Hi")],
            &[make_tool("shell", "Run command")],
        );
        assert!(prompt.starts_with("<<<SYSTEM>>>"));
        assert!(prompt.contains("## Available Tools"));
        assert!(prompt.contains("<<<USER>>>\nHi"));
    }

    #[test]
    fn no_synthesized_system_when_no_tools() {
        let prompt = render_prompt(&[ChatMessage::user("Hi")], &[]);
        assert!(prompt.starts_with("<<<USER>>>"));
        assert!(!prompt.contains("## Available Tools"));
    }

    #[test]
    fn renders_tool_call_and_result() {
        let call = ToolCall {
            id: "call_1".into(),
            call_type: "function".into(),
            function: FunctionCall {
                name: "shell".into(),
                arguments: "{\"command\":\"ls\"}".into(),
            },
        };
        let prompt = render_prompt(
            &[
                ChatMessage::user("List"),
                ChatMessage::assistant_with_tools("", vec![call]),
                ChatMessage::tool_result("call_1", "file1\nfile2"),
            ],
            &[],
        );
        assert!(prompt.contains("<tool_call>"));
        assert!(prompt.contains("\"name\":\"shell\""));
        assert!(prompt.contains("\"command\":\"ls\""));
        assert!(prompt.contains("</tool_call>"));
        assert!(prompt.contains("<<<TOOL>>>\nfile1\nfile2"));
        // Should not contain any ID references in the rendered prompt
        assert!(!prompt.contains("call_1"));
    }

    #[test]
    fn groups_parallel_tool_results() {
        let calls = vec![
            ToolCall {
                id: "call_1".into(),
                call_type: "function".into(),
                function: FunctionCall {
                    name: "shell".into(),
                    arguments: "{\"command\":\"ls\"}".into(),
                },
            },
            ToolCall {
                id: "call_2".into(),
                call_type: "function".into(),
                function: FunctionCall {
                    name: "shell".into(),
                    arguments: "{\"command\":\"pwd\"}".into(),
                },
            },
        ];
        let prompt = render_prompt(
            &[
                ChatMessage::user("Do 2"),
                ChatMessage::assistant_with_tools("", calls),
                ChatMessage::tool_result("call_1", "file1"),
                ChatMessage::tool_result("call_2", "/home"),
            ],
            &[],
        );
        assert!(prompt.contains("tool_result index=\"1\""));
        assert!(prompt.contains("tool_result index=\"2\""));
        assert!(prompt.contains("file1"));
        assert!(prompt.contains("/home"));
        // Only ONE <<<TOOL>>> header for the pair
        assert_eq!(prompt.matches("<<<TOOL>>>").count(), 1);
    }

    #[test]
    fn renders_multi_turn_conversation() {
        let prompt = render_prompt(
            &[
                ChatMessage::system("You are helpful."),
                ChatMessage::user("Hi"),
                ChatMessage::assistant("Hello!"),
                ChatMessage::user("What's 2+2?"),
            ],
            &[],
        );
        assert!(prompt.contains("<<<SYSTEM>>>"));
        assert_eq!(prompt.matches("<<<USER>>>").count(), 2);
        assert_eq!(prompt.matches("<<<ASSISTANT>>>").count(), 2); // one populated + one generation prompt
        assert!(prompt.contains("Hello!"));
    }

    #[test]
    fn render_parameters_nullable_types() {
        let params = json!({
            "type": "object",
            "properties": {
                "path": {"type": ["string", "null"], "description": "optional path"},
                "count": {"type": "integer", "description": "required count"}
            },
            "required": ["count"]
        });
        let out = render_parameters(&params);
        assert!(out.contains("\"type\": \"string\""));
        assert!(out.contains("\"type\": \"integer\""));
        assert!(out.contains("\"required\": false"));
        assert!(out.contains("\"required\": true"));
    }

    #[test]
    fn render_parameters_empty() {
        let params = json!({"type": "object", "properties": {}, "required": []});
        assert_eq!(render_parameters(&params), "(none)");
    }

    // ─ Parser tests ─────────────────────────────────────────────────────────

    #[test]
    fn parser_emits_plain_text() {
        let mut p = PlainStreamParser::new();
        // Feed content that has no tags — all but last-11 bytes scanned
        let events = p.process_sse_data(&chunk_json("Hello world"));
        // "Hello world" has 11 chars, no `<`, so all emitted
        let text: String = events
            .iter()
            .filter_map(|e| {
                if let LlmStreamEvent::TextDelta(t) = e {
                    Some(t.as_str())
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(text, "Hello world");
    }

    #[test]
    fn parser_holds_back_partial_open_tag() {
        let mut p = PlainStreamParser::new();
        let events = p.process_sse_data(&chunk_json("Hello <tool"));
        let text: String = events
            .iter()
            .filter_map(|e| {
                if let LlmStreamEvent::TextDelta(t) = e {
                    Some(t.as_str())
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(text, "Hello ");
        assert_eq!(p.buffer, "<tool");
    }

    #[test]
    fn parser_extracts_complete_tool_call() {
        let mut p = PlainStreamParser::new();
        let chunk = chunk_json(
            "Running now.\n<tool_call>\n{\"name\":\"shell\",\"arguments\":{\"command\":\"ls\"}}\n</tool_call>\nDone.",
        );
        let events = p.process_sse_data(&chunk);
        let tc = events.iter().find_map(|e| match e {
            LlmStreamEvent::ToolCallDelta {
                name,
                arguments_chunk,
                ..
            } => Some((name.clone(), arguments_chunk.clone())),
            _ => None,
        });
        assert!(tc.is_some());
        let (name, args) = tc.unwrap();
        assert_eq!(name.as_deref(), Some("shell"));
        assert!(args.contains("ls"));

        let text: String = events
            .iter()
            .filter_map(|e| {
                if let LlmStreamEvent::TextDelta(t) = e {
                    Some(t.as_str())
                } else {
                    None
                }
            })
            .collect();
        assert!(text.contains("Running now."));
    }

    #[test]
    fn parser_handles_stop_marker() {
        let mut p = PlainStreamParser::new();
        let events = p.process_sse_data(&chunk_json("Answer is 42.\n<<<USER>>>\nignored"));
        let text: String = events
            .iter()
            .filter_map(|e| {
                if let LlmStreamEvent::TextDelta(t) = e {
                    Some(t.as_str())
                } else {
                    None
                }
            })
            .collect();
        assert!(text.contains("Answer is 42."));
        assert!(!text.contains("ignored"));
    }

    #[test]
    fn parser_handles_fragmented_tool_call() {
        let mut p = PlainStreamParser::new();
        let pieces = [
            "<tool",
            "_call>",
            "\n{\"name\":",
            "\"shell\",",
            "\"arguments\":",
            "{\"command\":\"ls\"}}\n",
            "</tool_",
            "call>",
        ];
        let mut all_events = Vec::new();
        for p_str in pieces {
            all_events.extend(p.process_sse_data(&chunk_json(p_str)));
        }
        let tc = all_events.iter().find_map(|e| match e {
            LlmStreamEvent::ToolCallDelta { name, .. } => name.clone(),
            _ => None,
        });
        assert_eq!(tc.as_deref(), Some("shell"));
    }

    #[test]
    fn parser_emits_done_on_stop() {
        let mut p = PlainStreamParser::new();
        p.process_sse_data(&chunk_json("hello"));
        let events = p.process_sse_data(&stop_chunk());
        let done = events
            .iter()
            .any(|e| matches!(e, LlmStreamEvent::Done { .. }));
        assert!(done);
    }

    #[test]
    fn parser_finalize_emits_done_if_needed() {
        let mut p = PlainStreamParser::new();
        let events = p.finalize();
        assert!(
            events
                .iter()
                .any(|e| matches!(e, LlmStreamEvent::Done { .. }))
        );
    }

    #[test]
    fn parser_ignores_malformed_sse_data() {
        let mut p = PlainStreamParser::new();
        let events = p.process_sse_data("not json");
        assert!(events.is_empty());
    }

    #[test]
    fn parser_assigns_sequential_tool_call_indices() {
        let mut p = PlainStreamParser::new();
        let chunk = chunk_json(
            "<tool_call>\n{\"name\":\"a\",\"arguments\":{}}\n</tool_call>\n\
             <tool_call>\n{\"name\":\"b\",\"arguments\":{}}\n</tool_call>",
        );
        let events = p.process_sse_data(&chunk);
        let indices: Vec<usize> = events
            .iter()
            .filter_map(|e| match e {
                LlmStreamEvent::ToolCallDelta { index, .. } => Some(*index),
                _ => None,
            })
            .collect();
        assert_eq!(indices, vec![0, 1]);
    }

    #[test]
    fn parser_malformed_json_emits_error() {
        let mut p = PlainStreamParser::new();
        let chunk = chunk_json("<tool_call>\nnot valid json\n</tool_call>");
        let events = p.process_sse_data(&chunk);
        let has_error = events
            .iter()
            .any(|e| matches!(e, LlmStreamEvent::Error(_)));
        assert!(has_error);
    }

    #[test]
    fn safe_flush_len_basic() {
        assert_eq!(safe_flush_len("hello world"), 11); // no `<`
        assert_eq!(safe_flush_len("hello <tool"), 6); // holds back `<tool`
        assert_eq!(safe_flush_len("hello <<<"), 6); // holds back `<<<`
        assert_eq!(safe_flush_len("hello <"), 6); // holds back partial
        assert_eq!(safe_flush_len(""), 0);
    }
}
