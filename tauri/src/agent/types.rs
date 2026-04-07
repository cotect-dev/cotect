use serde::{Deserialize, Serialize};

// ─── Task types (cross-boundary with frontend) ───────────────────────────────

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
}

// ─── Provider configuration ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    #[serde(default)]
    pub api_key: Option<String>,
    pub model: String,
    /// Wire format / chat template to use when talking to the model.
    /// `None` means auto-detect from the model identifier — see
    /// [`crate::agent::adapter::detect_format`].
    #[serde(default)]
    pub format: Option<crate::agent::adapter::PromptFormat>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub providers: Vec<ProviderConfig>,
    pub active_provider_id: String,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            providers: vec![ProviderConfig {
                id: "ollama".into(),
                name: "Local Ollama".into(),
                endpoint: "http://localhost:11434/v1".into(),
                api_key: None,
                model: String::new(),
                format: None,
            }],
            active_provider_id: "ollama".into(),
        }
    }
}

impl AgentConfig {
    pub fn active_provider(&self) -> Option<&ProviderConfig> {
        self.providers
            .iter()
            .find(|p| p.id == self.active_provider_id)
    }
}

impl ProviderConfig {
    /// Resolve the prompt format to use: either the explicit
    /// [`Self::format`] override, or the auto-detected format based on
    /// [`Self::model`].
    pub fn resolved_format(&self) -> crate::agent::adapter::PromptFormat {
        self.format
            .unwrap_or_else(|| crate::agent::adapter::detect_format(&self.model))
    }
}

// ─── LLM message types (internal) ───────────────────────────────────────────

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

    /// Approximate token count using chars/4 heuristic.
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

// ─── LLM stream events ─────────────────────────────────────────────────────

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

/// The fully-assembled response from one LLM turn.
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
    fn test_chat_message_system() {
        let msg = ChatMessage::system("You are helpful");
        assert_eq!(msg.role, Role::System);
        assert_eq!(msg.content, "You are helpful");
        assert!(msg.tool_calls.is_none());
        assert!(msg.tool_call_id.is_none());
    }

    #[test]
    fn test_chat_message_user() {
        let msg = ChatMessage::user("Hello");
        assert_eq!(msg.role, Role::User);
        assert_eq!(msg.content, "Hello");
    }

    #[test]
    fn test_chat_message_assistant() {
        let msg = ChatMessage::assistant("Hi there");
        assert_eq!(msg.role, Role::Assistant);
        assert_eq!(msg.content, "Hi there");
        assert!(msg.tool_calls.is_none());
    }

    #[test]
    fn test_chat_message_assistant_with_tools() {
        let calls = vec![ToolCall {
            id: "call_1".into(),
            call_type: "function".into(),
            function: FunctionCall {
                name: "read".into(),
                arguments: r#"{"file_path": "/test"}"#.into(),
            },
        }];
        let msg = ChatMessage::assistant_with_tools("", calls.clone());
        assert_eq!(msg.role, Role::Assistant);
        assert!(msg.tool_calls.is_some());
        assert_eq!(msg.tool_calls.unwrap().len(), 1);
    }

    #[test]
    fn test_chat_message_assistant_with_empty_tools() {
        let msg = ChatMessage::assistant_with_tools("text", vec![]);
        assert!(msg.tool_calls.is_none());
    }

    #[test]
    fn test_chat_message_tool_result() {
        let msg = ChatMessage::tool_result("call_1", "File contents here");
        assert_eq!(msg.role, Role::Tool);
        assert_eq!(msg.tool_call_id.as_deref(), Some("call_1"));
        assert_eq!(msg.content, "File contents here");
    }

    #[test]
    fn test_estimated_tokens_text_only() {
        let msg = ChatMessage::user("Hello world test"); // 16 chars -> 16/4 + 1 = 5
        let tokens = msg.estimated_tokens();
        assert!(tokens >= 4 && tokens <= 6);
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
    fn test_agent_config_default() {
        let config = AgentConfig::default();
        assert_eq!(config.providers.len(), 1);
        assert_eq!(config.providers[0].id, "ollama");
        assert_eq!(config.active_provider_id, "ollama");
    }

    #[test]
    fn test_agent_config_active_provider() {
        let config = AgentConfig::default();
        let active = config.active_provider();
        assert!(active.is_some());
        assert_eq!(active.unwrap().id, "ollama");
    }

    #[test]
    fn test_agent_config_active_provider_missing() {
        let config = AgentConfig {
            providers: vec![],
            active_provider_id: "nonexistent".into(),
        };
        assert!(config.active_provider().is_none());
    }

    #[test]
    fn test_task_event_serialization() {
        let event = TaskEvent::Text {
            content: "hello".into(),
            partial: true,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains(r#""type":"text""#));
        assert!(json.contains(r#""partial":true"#));
    }

    #[test]
    fn test_task_event_error_serialization() {
        let event = TaskEvent::Error {
            message: "something broke".into(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains(r#""type":"error""#));
    }

    #[test]
    fn test_task_event_complete_serialization() {
        let event = TaskEvent::Complete;
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains(r#""type":"complete""#));
    }

    #[test]
    fn test_agent_role_serialization() {
        let role = AgentRole::Implement;
        let json = serde_json::to_string(&role).unwrap();
        assert_eq!(json, r#""implement""#);
    }

    #[test]
    fn test_agent_role_deserialization() {
        let role: AgentRole = serde_json::from_str(r#""research""#).unwrap();
        assert_eq!(role, AgentRole::Research);
    }

    #[test]
    fn test_llm_turn_result_default() {
        let result = LlmTurnResult::default();
        assert!(result.content.is_empty());
        assert!(result.reasoning.is_empty());
        assert!(result.tool_calls.is_empty());
        assert!(result.finish_reason.is_none());
    }
}
