//! OpenAI-compatible adapter.
//!
//! This adapter preserves the legacy behavior of [`super::LlmClient`]: it
//! POSTs structured JSON messages + tool definitions to the server's
//! `/chat/completions` endpoint and lets the server handle chat templating
//! and tool-call parsing.
//!
//! This is the appropriate choice for:
//! - Proprietary APIs (OpenAI, Anthropic, etc.) that do their own
//!   model-aware templating server-side.
//! - Situations where we don't want to maintain a model-specific template
//!   client-side.
//!
//! For open models with native templates we maintain (Gemma, Llama 3,
//! Qwen), the corresponding native adapter gives the model a cleaner
//! prompt without OpenAI protocol overhead.

use super::super::types::{ChatMessage, LlmStreamEvent, ToolDefinition};
use super::{
    ModelAdapter, StreamChunk, StreamParser,
    build_openai_request_body,
};

/// OpenAI-compatible wire format adapter (the legacy default).
pub struct OpenAICompatAdapter;

impl ModelAdapter for OpenAICompatAdapter {
    fn name(&self) -> &'static str {
        "openai_compat"
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
    ) -> serde_json::Value {
        build_openai_request_body(model, messages, tools, temperature, max_tokens)
    }

    fn new_stream_parser(&self) -> Box<dyn StreamParser> {
        Box::new(OpenAICompatParser::default())
    }
}

// ─── Stream parser ──────────────────────────────────────────────────────────

#[derive(Default)]
struct OpenAICompatParser {
    done_emitted: bool,
}

impl StreamParser for OpenAICompatParser {
    fn process_sse_data(&mut self, data: &str) -> Vec<LlmStreamEvent> {
        let mut events = Vec::new();

        if data == "[DONE]" {
            if !self.done_emitted {
                events.push(LlmStreamEvent::Done { finish_reason: None });
                self.done_emitted = true;
            }
            return events;
        }

        let chunk = match serde_json::from_str::<StreamChunk>(data) {
            Ok(c) => c,
            Err(_) => {
                // Skip unparseable chunks — common with some providers.
                return events;
            }
        };

        for choice in &chunk.choices {
            if let Some(text) = &choice.delta.content {
                if !text.is_empty() {
                    events.push(LlmStreamEvent::TextDelta(text.clone()));
                }
            }
            if let Some(reasoning) = &choice.delta.reasoning_content {
                if !reasoning.is_empty() {
                    events.push(LlmStreamEvent::ReasoningDelta(reasoning.clone()));
                }
            }
            if let Some(tool_calls) = &choice.delta.tool_calls {
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
                events.push(LlmStreamEvent::Done {
                    finish_reason: Some(reason.clone()),
                });
                self.done_emitted = true;
            }
        }

        events
    }

    fn finalize(&mut self) -> Vec<LlmStreamEvent> {
        if self.done_emitted {
            Vec::new()
        } else {
            self.done_emitted = true;
            vec![LlmStreamEvent::Done { finish_reason: None }]
        }
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::super::super::types::{ChatMessage, FunctionDef, ToolDefinition};
    use super::*;

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
    fn adapter_metadata() {
        let a = OpenAICompatAdapter;
        assert_eq!(a.name(), "openai_compat");
        assert_eq!(a.endpoint_path(), "/chat/completions");
    }

    #[test]
    fn build_request_body_includes_all_fields() {
        let a = OpenAICompatAdapter;
        let messages = vec![
            ChatMessage::system("system"),
            ChatMessage::user("hello"),
        ];
        let tools = vec![tool_def("shell")];
        let body = a.build_request_body("test-model", &messages, &tools, 1.0, 2048);

        assert_eq!(body["model"], "test-model");
        assert_eq!(body["stream"], true);
        assert_eq!(body["temperature"], 1.0);
        assert_eq!(body["max_tokens"], 2048);
        assert_eq!(body["messages"].as_array().unwrap().len(), 2);
        assert_eq!(body["tools"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn build_request_body_omits_empty_tools() {
        let a = OpenAICompatAdapter;
        let messages = vec![ChatMessage::user("hi")];
        let body = a.build_request_body("m", &messages, &[], 1.0, 100);
        // serde should have skipped the tools field entirely when None.
        assert!(body.get("tools").is_none() || body["tools"].is_null());
    }

    #[test]
    fn parser_text_delta() {
        let a = OpenAICompatAdapter;
        let mut p = a.new_stream_parser();
        let events = p.process_sse_data(
            r#"{"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}"#,
        );
        assert_eq!(events.len(), 1);
        match &events[0] {
            LlmStreamEvent::TextDelta(t) => assert_eq!(t, "hello"),
            _ => panic!("expected TextDelta"),
        }
    }

    #[test]
    fn parser_reasoning_delta() {
        let a = OpenAICompatAdapter;
        let mut p = a.new_stream_parser();
        let events = p.process_sse_data(
            r#"{"choices":[{"delta":{"reasoning_content":"thinking"},"finish_reason":null}]}"#,
        );
        assert_eq!(events.len(), 1);
        match &events[0] {
            LlmStreamEvent::ReasoningDelta(t) => assert_eq!(t, "thinking"),
            _ => panic!("expected ReasoningDelta"),
        }
    }

    #[test]
    fn parser_tool_call_delta() {
        let a = OpenAICompatAdapter;
        let mut p = a.new_stream_parser();
        let events = p.process_sse_data(
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"shell","arguments":"{\"cmd\":\"ls\"}"}}]},"finish_reason":null}]}"#,
        );
        assert_eq!(events.len(), 1);
        match &events[0] {
            LlmStreamEvent::ToolCallDelta {
                index,
                id,
                name,
                arguments_chunk,
            } => {
                assert_eq!(*index, 0);
                assert_eq!(id.as_deref(), Some("call_1"));
                assert_eq!(name.as_deref(), Some("shell"));
                assert_eq!(arguments_chunk, r#"{"cmd":"ls"}"#);
            }
            _ => panic!("expected ToolCallDelta"),
        }
    }

    #[test]
    fn parser_finish_reason_emits_done() {
        let a = OpenAICompatAdapter;
        let mut p = a.new_stream_parser();
        let events = p.process_sse_data(
            r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        );
        assert_eq!(events.len(), 1);
        match &events[0] {
            LlmStreamEvent::Done { finish_reason } => {
                assert_eq!(finish_reason.as_deref(), Some("stop"));
            }
            _ => panic!("expected Done"),
        }
    }

    #[test]
    fn parser_done_marker() {
        let a = OpenAICompatAdapter;
        let mut p = a.new_stream_parser();
        let events = p.process_sse_data("[DONE]");
        assert_eq!(events.len(), 1);
        match &events[0] {
            LlmStreamEvent::Done { finish_reason } => assert!(finish_reason.is_none()),
            _ => panic!("expected Done"),
        }
    }

    #[test]
    fn parser_done_marker_not_duplicated() {
        let a = OpenAICompatAdapter;
        let mut p = a.new_stream_parser();
        let _ = p.process_sse_data(
            r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        );
        // Subsequent [DONE] after a finish_reason shouldn't emit another Done.
        let events = p.process_sse_data("[DONE]");
        assert!(events.is_empty());
    }

    #[test]
    fn parser_skips_unparseable_chunks() {
        let a = OpenAICompatAdapter;
        let mut p = a.new_stream_parser();
        let events = p.process_sse_data("garbage-not-json");
        assert!(events.is_empty());
    }

    #[test]
    fn parser_empty_content_ignored() {
        let a = OpenAICompatAdapter;
        let mut p = a.new_stream_parser();
        let events = p.process_sse_data(
            r#"{"choices":[{"delta":{"content":""},"finish_reason":null}]}"#,
        );
        assert!(events.is_empty());
    }

    #[test]
    fn parser_finalize_emits_done_if_missing() {
        let a = OpenAICompatAdapter;
        let mut p = a.new_stream_parser();
        let _ = p.process_sse_data(
            r#"{"choices":[{"delta":{"content":"x"},"finish_reason":null}]}"#,
        );
        let events = p.finalize();
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], LlmStreamEvent::Done { .. }));
    }

    #[test]
    fn parser_finalize_noop_after_done() {
        let a = OpenAICompatAdapter;
        let mut p = a.new_stream_parser();
        let _ = p.process_sse_data("[DONE]");
        let events = p.finalize();
        assert!(events.is_empty());
    }
}
