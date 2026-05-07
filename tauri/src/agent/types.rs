use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskScope {
    pub root_path: String,
    pub files: Vec<String>,
    #[serde(default)]
    pub directory: Option<String>,
    #[serde(default)]
    pub declarations: Vec<DeclarationInfo>,
    #[serde(default)]
    pub description: Option<String>,
    /// Files the agent is not allowed to read (eval-only).
    /// The read tool returns an error message instead of content.
    #[serde(default)]
    pub blocked_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeclarationInfo {
    pub name: String,
    pub kind: String,
    pub file_path: String,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRequest {
    pub id: String,
    pub prompt: String,
    pub scope: TaskScope,
    pub role: AgentRole,
    #[serde(default)]
    pub conversation_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRole {
    Implement,
    Research,
    Plan,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TaskEvent {
    Text {
        content: String,
        partial: bool,
    },
    Reasoning {
        content: String,
    },
    ToolStart {
        tool_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        file_path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        /// Raw JSON arguments passed to the tool (for debugging / transcripts).
        #[serde(skip_serializing_if = "Option::is_none")]
        arguments: Option<String>,
    },
    ToolEnd {
        tool_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        file_path: Option<String>,
        success: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<String>,
    },
    Followup {
        question: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        options: Option<Vec<String>>,
    },
    Error {
        message: String,
    },
    Complete,
    Interrupted {
        reason: String,
    },
    /// Advisory: model has been streaming reasoning/text without calling
    /// a tool. Not a circuit-breaker — orchestration is unaffected.
    /// One event per stall, reset on the next tool call.
    ReasoningStall {
        /// Wall milliseconds since the last tool call (or task start).
        elapsed_ms: u64,
        /// Bytes of reasoning + text streamed since the last tool call.
        reasoning_bytes: usize,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    #[serde(default)]
    pub api_key: Option<String>,
    pub model: String,
    /// `None` = auto-detect from model id; see `adapter::detect_format`.
    #[serde(default)]
    pub format: Option<crate::agent::adapter::PromptFormat>,
    /// Soft thinking-mode switch. For Qwen, `Some(true)` appends `/no_think`
    /// to the system prompt. Complementary to server-side flags
    /// (`--reasoning-budget 0`, `--chat-template-kwargs ..enable_thinking..`),
    /// not a substitute.
    #[serde(default)]
    pub disable_thinking: Option<bool>,
}

impl ProviderConfig {
    /// Explicit `format` override, otherwise auto-detected from `model`.
    pub fn resolved_format(&self) -> crate::agent::adapter::PromptFormat {
        self.format
            .unwrap_or_else(|| crate::agent::adapter::detect_format(&self.model))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    #[default]
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatMessage {
    pub role: Role,
    #[serde(default)]
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self { role: Role::System, content: content.into(), ..Default::default() }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self { role: Role::User, content: content.into(), ..Default::default() }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self { role: Role::Assistant, content: content.into(), ..Default::default() }
    }

    pub fn assistant_with_tools(content: impl Into<String>, tool_calls: Vec<ToolCall>) -> Self {
        Self {
            role: Role::Assistant,
            content: content.into(),
            tool_calls: if tool_calls.is_empty() { None } else { Some(tool_calls) },
            ..Default::default()
        }
    }

    pub fn tool_result(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: Role::Tool,
            content: content.into(),
            tool_call_id: Some(tool_call_id.into()),
            ..Default::default()
        }
    }

    /// chars/4 heuristic.
    pub fn estimated_tokens(&self) -> usize {
        let mut chars = self.content.len();
        if let Some(calls) = &self.tool_calls {
            for call in calls {
                chars += call.function.name.len() + call.function.arguments.len();
            }
        }
        chars / 4 + 1
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: FunctionCall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    #[serde(rename = "type")]
    pub def_type: String,
    pub function: FunctionDef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionDef {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone)]
pub enum LlmStreamEvent {
    TextDelta(String),
    ReasoningDelta(String),
    ToolCallDelta {
        index: usize,
        id: Option<String>,
        name: Option<String>,
        arguments_chunk: String,
    },
    Done {
        finish_reason: Option<String>,
    },
    Error(String),
}

#[derive(Debug, Clone, Default)]
pub struct LlmTurnResult {
    pub content: String,
    pub reasoning: String,
    pub tool_calls: Vec<ToolCall>,
    pub finish_reason: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chat_message_assistant_with_empty_tools() {
        let msg = ChatMessage::assistant_with_tools("text", vec![]);
        assert!(msg.tool_calls.is_none());
    }

    #[test]
    fn test_estimated_tokens_text_only() {
        let msg = ChatMessage::user("Hello world test"); // 16 chars -> 16/4 + 1 = 5
        let tokens = msg.estimated_tokens();
        assert!((4..=6).contains(&tokens));
    }

    #[test]
    fn test_estimated_tokens_with_tool_calls() {
        let msg = ChatMessage::assistant_with_tools(
            "",
            vec![ToolCall {
                id: "c1".into(),
                call_type: "function".into(),
                function: FunctionCall {
                    name: "read".into(),
                    arguments: r#"{"file_path":"/very/long/path/to/file.txt"}"#.into(),
                },
            }],
        );
        // Should count tool call name + arguments as part of tokens
        assert!(msg.estimated_tokens() > 1);
    }

    #[test]
    fn test_provider_config_disable_thinking_deserializes_default_none() {
        // Existing configs on disk won't have the new field — make sure serde
        // tolerates its absence.
        let json = r#"{
            "id": "test",
            "name": "Test",
            "endpoint": "http://localhost:8080/v1",
            "model": "qwen3:7b"
        }"#;
        let cfg: ProviderConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.disable_thinking, None);
    }

}
