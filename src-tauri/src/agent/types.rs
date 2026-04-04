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

// ─── LLM message types (internal) ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
        Self {
            role: Role::System,
            content: content.into(),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: content.into(),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: Role::Assistant,
            content: content.into(),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    pub fn assistant_with_tools(content: impl Into<String>, tool_calls: Vec<ToolCall>) -> Self {
        Self {
            role: Role::Assistant,
            content: content.into(),
            tool_calls: if tool_calls.is_empty() {
                None
            } else {
                Some(tool_calls)
            },
            tool_call_id: None,
            name: None,
        }
    }

    pub fn tool_result(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: Role::Tool,
            content: content.into(),
            tool_calls: None,
            tool_call_id: Some(tool_call_id.into()),
            name: None,
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
