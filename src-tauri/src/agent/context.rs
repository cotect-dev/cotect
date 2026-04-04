use super::types::{ChatMessage, Role, ToolCall, ToolDefinition};
use super::utils::truncate_chars;

/// Manages the conversation context (message list + tool definitions).
/// Handles token estimation and context compaction.
#[derive(Debug, Clone)]
pub struct ConversationContext {
    messages: Vec<ChatMessage>,
    tool_defs: Vec<ToolDefinition>,
    compaction_threshold: usize,
}

impl ConversationContext {
    pub fn new(system_prompt: String, tool_defs: Vec<ToolDefinition>) -> Self {
        let mut messages = Vec::with_capacity(64);
        messages.push(ChatMessage::system(system_prompt));
        Self {
            messages,
            tool_defs,
            compaction_threshold: 100_000, // ~100k tokens default
        }
    }

    pub fn messages(&self) -> &[ChatMessage] {
        &self.messages
    }

    pub fn tool_definitions(&self) -> &[ToolDefinition] {
        &self.tool_defs
    }

    /// Add a user message.
    pub fn append_user(&mut self, content: &str) {
        self.messages.push(ChatMessage::user(content));
    }

    /// Add an assistant response (text only, no tool calls).
    pub fn append_assistant(&mut self, content: &str, _reasoning: &str) {
        self.messages.push(ChatMessage::assistant(content));
    }

    /// Add an assistant message with tool calls, followed by each tool result.
    pub fn append_assistant_with_tools(&mut self, content: &str, tool_calls: Vec<ToolCall>) {
        self.messages
            .push(ChatMessage::assistant_with_tools(content, tool_calls));
    }

    /// Add a tool result message.
    pub fn append_tool_result(&mut self, tool_call_id: &str, result: &str) {
        self.messages
            .push(ChatMessage::tool_result(tool_call_id, result));
    }

    /// Inject a system reminder into the conversation (for doom loop warnings, etc.)
    pub fn inject_system_reminder(&mut self, content: &str) {
        self.messages.push(ChatMessage::user(format!(
            "<system_reminder>\n{}\n</system_reminder>",
            content
        )));
    }

    /// Estimate total token count across all messages.
    pub fn estimated_tokens(&self) -> usize {
        self.messages.iter().map(|m| m.estimated_tokens()).sum()
    }

    pub fn compaction_threshold(&self) -> usize {
        self.compaction_threshold
    }

    /// Compact the context by keeping system prompt + last N messages,
    /// replacing the middle with a summary marker.
    pub fn compact(&mut self) {
        let keep_tail = 10;

        if self.messages.len() <= keep_tail + 2 {
            return; // Nothing to compact
        }

        let system_msg = self.messages[0].clone();
        let mid_start = 1;
        let mid_end = self.messages.len().saturating_sub(keep_tail);

        if mid_end <= mid_start {
            return;
        }

        // Build a summary of the compacted messages
        let mut summary_parts: Vec<String> = Vec::new();
        for msg in &self.messages[mid_start..mid_end] {
            match msg.role {
                Role::User => {
                    let preview = truncate_chars(&msg.content, 200);
                    summary_parts.push(format!("User: {preview}"));
                }
                Role::Assistant => {
                    let preview = truncate_chars(&msg.content, 200);
                    if let Some(calls) = &msg.tool_calls {
                        let tool_names: Vec<&str> =
                            calls.iter().map(|c| c.function.name.as_str()).collect();
                        summary_parts
                            .push(format!("Assistant: {preview} [tools: {}]", tool_names.join(", ")));
                    } else {
                        summary_parts.push(format!("Assistant: {preview}"));
                    }
                }
                Role::Tool => {
                    let preview = truncate_chars(&msg.content, 100);
                    summary_parts.push(format!("Tool result: {preview}"));
                }
                Role::System => {}
            }
        }

        let summary = format!(
            "<context_summary>\n\
             The following is a summary of earlier conversation turns that have been compacted:\n\n\
             {}\n\
             </context_summary>",
            summary_parts.join("\n")
        );

        let tail = self.messages[mid_end..].to_vec();
        self.messages.clear();
        self.messages.push(system_msg);
        self.messages.push(ChatMessage::user(summary));
        self.messages.extend(tail);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_estimated_tokens() {
        let ctx = ConversationContext::new("System prompt here".into(), vec![]);
        // "System prompt here" = 18 chars => 18/4 + 1 = 5 tokens
        assert!(ctx.estimated_tokens() >= 4);
    }

    #[test]
    fn test_compact_preserves_system_and_tail() {
        let mut ctx = ConversationContext::new("system".into(), vec![]);
        // Add 20 messages
        for i in 0..20 {
            ctx.append_user(&format!("user message {i}"));
            ctx.append_assistant(&format!("assistant message {i}"), "");
        }
        let before_len = ctx.messages.len(); // 1 system + 40 user/assistant = 41
        assert_eq!(before_len, 41);

        ctx.compact();

        // After compaction: system + summary + last 10 = 12
        assert_eq!(ctx.messages.len(), 12);
        assert_eq!(ctx.messages[0].role, Role::System);
        assert!(ctx.messages[1].content.contains("context_summary"));
    }

    #[test]
    fn test_compact_noop_when_small() {
        let mut ctx = ConversationContext::new("system".into(), vec![]);
        ctx.append_user("hello");
        ctx.append_assistant("world", "");
        let before = ctx.messages.len();
        ctx.compact();
        assert_eq!(ctx.messages.len(), before);
    }

    #[test]
    fn test_inject_system_reminder() {
        let mut ctx = ConversationContext::new("system".into(), vec![]);
        ctx.inject_system_reminder("You are stuck in a loop");
        assert_eq!(ctx.messages.len(), 2);
        assert!(ctx.messages[1].content.contains("system_reminder"));
    }

    // ─── Multi-turn conversation tests ──────────────────────────────────

    #[test]
    fn test_multi_turn_conversation_structure() {
        let mut ctx = ConversationContext::new("You are helpful.".into(), vec![]);
        assert_eq!(ctx.messages().len(), 1);
        assert_eq!(ctx.messages()[0].role, Role::System);

        ctx.append_user("What is 2+2?");
        assert_eq!(ctx.messages().len(), 2);

        ctx.append_assistant("4", "");
        assert_eq!(ctx.messages().len(), 3);

        ctx.append_user("And 3+3?");
        assert_eq!(ctx.messages().len(), 4);

        // Verify roles alternate correctly
        assert_eq!(ctx.messages()[0].role, Role::System);
        assert_eq!(ctx.messages()[1].role, Role::User);
        assert_eq!(ctx.messages()[2].role, Role::Assistant);
        assert_eq!(ctx.messages()[3].role, Role::User);
    }

    #[test]
    fn test_conversation_with_tool_calls() {
        let mut ctx = ConversationContext::new("system".into(), vec![]);
        ctx.append_user("Read the file");

        let tool_calls = vec![super::super::types::ToolCall {
            id: "call_1".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "read".into(),
                arguments: r#"{"file_path":"/tmp/test.txt"}"#.into(),
            },
        }];
        ctx.append_assistant_with_tools("I'll read that file.", tool_calls);
        assert_eq!(ctx.messages().len(), 3);

        ctx.append_tool_result("call_1", "File contents: hello world");
        assert_eq!(ctx.messages().len(), 4);
        assert_eq!(ctx.messages()[3].role, Role::Tool);
        assert_eq!(ctx.messages()[3].tool_call_id.as_deref(), Some("call_1"));
    }

    #[test]
    fn test_compaction_preserves_tool_results_in_tail() {
        let mut ctx = ConversationContext::new("system".into(), vec![]);

        // Add many early messages
        for i in 0..20 {
            ctx.append_user(&format!("request {i}"));
            ctx.append_assistant(&format!("response {i}"), "");
        }

        // Add tool call + result at the end
        let tool_calls = vec![super::super::types::ToolCall {
            id: "call_final".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "shell".into(),
                arguments: r#"{"command":"ls"}"#.into(),
            },
        }];
        ctx.append_assistant_with_tools("Running command", tool_calls);
        ctx.append_tool_result("call_final", "file1.txt\nfile2.txt");

        let total_before = ctx.messages().len();
        assert!(total_before > 12); // More than keep_tail + 2

        ctx.compact();

        // Should have: system + summary + last 10 messages
        assert!(ctx.messages().len() <= 12);
        // Verify the tool result is in the tail
        let has_tool = ctx.messages().iter().any(|m| m.role == Role::Tool);
        assert!(has_tool, "Tool result should be preserved in tail");
    }

    #[test]
    fn test_compaction_summary_includes_tool_names() {
        let mut ctx = ConversationContext::new("system".into(), vec![]);

        // Build enough messages for compaction to happen on the early ones
        for i in 0..8 {
            ctx.append_user(&format!("request {i}"));
            let tc = vec![super::super::types::ToolCall {
                id: format!("c_{i}"),
                call_type: "function".into(),
                function: super::super::types::FunctionCall {
                    name: "read".into(),
                    arguments: format!(r#"{{"file_path":"file_{i}.txt"}}"#),
                },
            }];
            ctx.append_assistant_with_tools(&format!("resp {i}"), tc);
            ctx.append_tool_result(&format!("c_{i}"), &format!("result {i}"));
        }

        // Add final messages to fill the tail
        for i in 0..6 {
            ctx.append_user(&format!("late request {i}"));
            ctx.append_assistant(&format!("late response {i}"), "");
        }

        ctx.compact();

        // The summary message should reference tool names
        let summary_msg = &ctx.messages()[1];
        assert!(summary_msg.content.contains("context_summary"));
        assert!(summary_msg.content.contains("read"));
    }

    #[test]
    fn test_token_estimation_grows_with_content() {
        let mut ctx = ConversationContext::new("short".into(), vec![]);
        let initial = ctx.estimated_tokens();

        ctx.append_user("a very long user message that has many words and characters in it");
        let after_user = ctx.estimated_tokens();
        assert!(after_user > initial);

        ctx.append_assistant("an equally long response with plenty of content", "");
        let after_assistant = ctx.estimated_tokens();
        assert!(after_assistant > after_user);
    }

    #[test]
    fn test_tool_definitions_returned_correctly() {
        let defs = vec![
            ToolDefinition {
                def_type: "function".into(),
                function: super::super::types::FunctionDef {
                    name: "read".into(),
                    description: "Read a file".into(),
                    parameters: serde_json::json!({}),
                },
            },
            ToolDefinition {
                def_type: "function".into(),
                function: super::super::types::FunctionDef {
                    name: "write".into(),
                    description: "Write a file".into(),
                    parameters: serde_json::json!({}),
                },
            },
        ];
        let ctx = ConversationContext::new("sys".into(), defs);
        assert_eq!(ctx.tool_definitions().len(), 2);
        assert_eq!(ctx.tool_definitions()[0].function.name, "read");
    }

    #[test]
    fn test_multiple_system_reminders() {
        let mut ctx = ConversationContext::new("system".into(), vec![]);
        ctx.append_user("hello");
        ctx.inject_system_reminder("Reminder 1");
        ctx.inject_system_reminder("Reminder 2");
        assert_eq!(ctx.messages().len(), 4); // system + user + 2 reminders
        assert!(ctx.messages()[2].content.contains("Reminder 1"));
        assert!(ctx.messages()[3].content.contains("Reminder 2"));
    }
}
