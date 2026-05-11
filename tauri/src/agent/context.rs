use super::types::{ChatMessage, Role, ToolCall, ToolDefinition};
use super::utils::truncate_chars;

/// Conversation message list + tool definitions, with token estimation
/// and compaction support.
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

    pub fn append_user(&mut self, content: &str) {
        self.messages.push(ChatMessage::user(content));
    }

    /// Empty content is dropped — a trailing assistant turn is rejected by some
    /// servers as a "prefill" (e.g. Gemma 4 with enable_thinking).
    pub fn append_assistant(&mut self, content: &str) {
        if content.trim().is_empty() {
            return;
        }
        self.messages.push(ChatMessage::assistant(content));
    }

    pub fn append_assistant_with_tools(&mut self, content: &str, tool_calls: Vec<ToolCall>) {
        self.messages
            .push(ChatMessage::assistant_with_tools(content, tool_calls));
    }

    pub fn append_tool_result(&mut self, tool_call_id: &str, result: &str) {
        self.messages
            .push(ChatMessage::tool_result(tool_call_id, result));
    }

    /// Drops `__format_error__` tool-call round-trips so a successful retry
    /// leaves a clean conversation. Each failed attempt is a pair:
    /// `assistant(__format_error__) + tool(error)` — we remove both.
    pub fn compact_format_errors(&mut self) {
        let mut indices_to_remove: Vec<usize> = Vec::new();

        for (i, msg) in self.messages.iter().enumerate() {
            if msg.role == Role::Assistant {
                if let Some(calls) = &msg.tool_calls {
                    if calls.iter().any(|c| c.function.name == "__format_error__") {
                        indices_to_remove.push(i);
                        if i + 1 < self.messages.len() && self.messages[i + 1].role == Role::Tool {
                            indices_to_remove.push(i + 1);
                        }
                    }
                }
            }
        }

        if !indices_to_remove.is_empty() {
            // Remove in reverse to keep indices valid.
            indices_to_remove.dedup();
            for &i in indices_to_remove.iter().rev() {
                self.messages.remove(i);
            }
        }
    }
    pub fn inject_system_reminder(&mut self, content: &str) {
        self.messages.push(ChatMessage::user(format!(
            "<system_reminder>\n{}\n</system_reminder>",
            content
        )));
    }

    pub fn estimated_tokens(&self) -> usize {
        self.messages.iter().map(|m| m.estimated_tokens()).sum()
    }

    pub fn compaction_threshold(&self) -> usize {
        self.compaction_threshold
    }

    /// Keep system prompt + last N messages; replace the middle with a summary.
    pub fn compact(&mut self) {
        let keep_tail = 10;

        if self.messages.len() <= keep_tail + 2 {
            return;
        }

        let system_msg = self.messages[0].clone();
        let mid_start = 1;
        let mid_end = self.messages.len().saturating_sub(keep_tail);

        if mid_end <= mid_start {
            return;
        }

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
                        summary_parts.push(format!(
                            "Assistant: {preview} [tools: {}]",
                            tool_names.join(", ")
                        ));
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
    fn test_compact_preserves_system_and_tail() {
        let mut ctx = ConversationContext::new("system".into(), vec![]);
        // Add 20 messages
        for i in 0..20 {
            ctx.append_user(&format!("user message {i}"));
            ctx.append_assistant(&format!("assistant message {i}"));
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
        ctx.append_assistant("world");
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

    #[test]
    fn test_compaction_preserves_tool_results_in_tail() {
        let mut ctx = ConversationContext::new("system".into(), vec![]);

        // Add many early messages
        for i in 0..20 {
            ctx.append_user(&format!("request {i}"));
            ctx.append_assistant(&format!("response {i}"));
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
            ctx.append_assistant(&format!("late response {i}"));
        }

        ctx.compact();

        // The summary message should reference tool names
        let summary_msg = &ctx.messages()[1];
        assert!(summary_msg.content.contains("context_summary"));
        assert!(summary_msg.content.contains("read"));
    }

    #[test]
    fn test_compact_format_errors_removes_failed_attempts() {
        let mut ctx = ConversationContext::new("system".into(), vec![]);
        ctx.append_user("Do something");

        // Add a __format_error__ tool call + error result (failed parse attempt)
        let error_calls = vec![super::super::types::ToolCall {
            id: "call_1".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "__format_error__".into(),
                arguments: "raw malformed content".into(),
            },
        }];
        ctx.append_assistant_with_tools("", error_calls);
        ctx.append_tool_result("call_1", "Error: Tool call could not be parsed...");

        // Add a successful tool call + result (retry worked)
        let good_calls = vec![super::super::types::ToolCall {
            id: "call_2".into(),
            call_type: "function".into(),
            function: super::super::types::FunctionCall {
                name: "read".into(),
                arguments: r#"{"file_path":"/tmp/x.txt"}"#.into(),
            },
        }];
        ctx.append_assistant_with_tools("I'll read that.", good_calls);
        ctx.append_tool_result("call_2", "File contents");

        // Before compaction: system + user + error_asst + error_tool + good_asst + good_tool = 6
        assert_eq!(ctx.messages().len(), 6);

        ctx.compact_format_errors();

        // After: system + user + good_asst + good_tool = 4 (error pair removed)
        assert_eq!(ctx.messages().len(), 4);
        assert_eq!(ctx.messages()[0].role, Role::System);
        assert_eq!(ctx.messages()[1].role, Role::User);
        assert_eq!(ctx.messages()[2].role, Role::Assistant);
        assert_eq!(ctx.messages()[2].content, "I'll read that.");
        assert_eq!(ctx.messages()[3].role, Role::Tool);
        assert_eq!(ctx.messages()[3].content, "File contents");
    }

    #[test]
    fn test_compact_format_errors_noop_without_errors() {
        let mut ctx = ConversationContext::new("system".into(), vec![]);
        ctx.append_user("hello");
        ctx.append_assistant("world");
        let before = ctx.messages().len();
        ctx.compact_format_errors();
        assert_eq!(ctx.messages().len(), before);
    }
}
