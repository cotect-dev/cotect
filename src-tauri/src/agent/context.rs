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
}
