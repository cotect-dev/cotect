//! Model-specific prompt formatting adapters.
//!
//! Different LLMs are trained on different chat templates. Rather than
//! pushing all conversation formatting through a single OpenAI-compatible
//! API (which embeds bookkeeping IDs and protocol overhead into the
//! model's prompt), we let each model family use its native template.
//!
//! The [`ModelAdapter`] trait abstracts the two wire-format concerns:
//!
//! 1. **Request building**: how to serialize our canonical `Vec<ChatMessage>`
//!    + tool definitions into an HTTP request body the server understands.
//! 2. **Stream parsing**: how to turn incoming SSE deltas back into our
//!    canonical [`LlmStreamEvent`] stream.
//!
//! Everything else in the orchestrator (context management, tool execution,
//! retry logic, eval assertions) remains format-agnostic.
//!
//! ## Auto-detection
//!
//! [`detect_format`] inspects a model identifier string and picks a
//! reasonable [`PromptFormat`]. Users can override via
//! `ProviderConfig::format`.
//!
//! ## Fallback philosophy
//!
//! When we don't recognize a model, we fall back to [`PromptFormat::OpenAICompat`]
//! — i.e. let the server apply its configured chat template via
//! `/v1/chat/completions`. This is the safest default because nearly every
//! modern open model is heavily instruction-tuned to its own chat template
//! (e.g. Gemma 4's `<|turn>` tokens, Llama 3's header tokens). Without those
//! tokens the model reverts to generic completion behaviour and echoes the
//! prompt instead of responding.
//!
//! [`PromptFormat::Plain`] is available as an *explicit* choice for generic
//! completion models (non-instruction-tuned) or for experimenting, but it
//! is never selected automatically.
//!
//! For proprietary APIs (OpenAI, Anthropic), we fall back to
//! [`PromptFormat::OpenAICompat`] since the provider does its own
//! model-aware templating server-side.

use serde::{Deserialize, Serialize};
use serde_json::json;

use super::types::{ChatMessage, LlmStreamEvent, ToolDefinition};

pub mod gemma;
pub mod openai_compat;
pub mod plain;
pub mod qwen;

/// Which wire format to use when talking to the LLM backend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptFormat {
    /// Plain markdown-style format with JSON tool calls in XML-like tags.
    /// No special tokens. Self-documenting. Works with any capable model
    /// without relying on specific training priors. Must be selected
    /// explicitly — unknown models fall back to [`OpenAICompat`](Self::OpenAICompat)
    /// instead.
    Plain,

    /// Gemma 2/3/4 native template using `<start_of_turn>` / `<end_of_turn>`
    /// markers with `<tool_call>` / `<tool_response>` XML-like tags for
    /// function calling.
    Gemma,

    /// Llama 3.x/4.x native template using `<|start_header_id|>` /
    /// `<|eot_id|>` markers.
    Llama3,

    /// Qwen 2/2.5/3 native template (ChatML variant with `<|im_start|>`).
    Qwen,

    /// Generic ChatML format with `<|im_start|>` / `<|im_end|>` markers.
    /// Used by many models that don't have a specifically-trained template.
    ChatML,

    /// Standard OpenAI `/v1/chat/completions` API with server-side
    /// templating. Use for proprietary APIs (GPT, Claude) where the
    /// provider handles model-specific adaptation.
    OpenAICompat,
}

impl PromptFormat {
    /// Human-readable label for UI display.
    #[allow(dead_code)] // Exposed to frontend via Tauri command (wired up separately).
    pub fn label(&self) -> &'static str {
        match self {
            Self::Plain => "Plain (markdown)",
            Self::Gemma => "Gemma",
            Self::Llama3 => "Llama 3",
            Self::Qwen => "Qwen",
            Self::ChatML => "ChatML",
            Self::OpenAICompat => "OpenAI-compatible",
        }
    }

    /// Parse a stored format string (as written by the probe / serde
    /// `snake_case` rendering) back into a [`PromptFormat`]. Returns
    /// `None` for unknown values so callers can fall back to auto-detect.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "plain" => Some(Self::Plain),
            "gemma" => Some(Self::Gemma),
            "llama3" => Some(Self::Llama3),
            "qwen" => Some(Self::Qwen),
            "chatml" => Some(Self::ChatML),
            "openai_compat" => Some(Self::OpenAICompat),
            _ => None,
        }
    }
}

/// Infer the appropriate [`PromptFormat`] from a model identifier string.
///
/// Matches common naming conventions (HuggingFace paths, Ollama tags, etc.)
/// to known model families. Falls back to [`PromptFormat::OpenAICompat`] for
/// unrecognized models — the safest default, since it lets the server apply
/// the model's native chat template.
///
/// # Examples
///
/// ```ignore
/// assert_eq!(detect_format("unsloth/gemma-4-26B-A4B-it-GGUF:UD-Q4_K_XL"), PromptFormat::Gemma);
/// assert_eq!(detect_format("meta-llama/Llama-3.1-70B-Instruct"), PromptFormat::Llama3);
/// assert_eq!(detect_format("Qwen/Qwen2.5-32B-Instruct"), PromptFormat::Qwen);
/// assert_eq!(detect_format("gpt-4o"), PromptFormat::OpenAICompat);
/// assert_eq!(detect_format("some-unknown-model"), PromptFormat::OpenAICompat);
/// ```
pub fn detect_format(model_id: &str) -> PromptFormat {
    let lower = model_id.to_lowercase();

    // Gemma family (all versions use the same template)
    if lower.contains("gemma") {
        return PromptFormat::Gemma;
    }

    // Llama 3.x and 4.x use the new header template. Llama 2 uses the old
    // [INST] format which we don't have a native adapter for — fall back
    // to OpenAICompat so the server handles it.
    if lower.contains("llama-3")
        || lower.contains("llama3")
        || lower.contains("llama-4")
        || lower.contains("llama4")
    {
        return PromptFormat::Llama3;
    }

    // Qwen 2.x / 2.5.x / 3.x all use ChatML-like template
    if lower.contains("qwen") {
        return PromptFormat::Qwen;
    }

    // ChatML-compatible models
    if lower.contains("mistral")
        || lower.contains("mixtral")
        || lower.contains("phi-3")
        || lower.contains("phi3")
        || lower.contains("phi-4")
        || lower.contains("phi4")
        || lower.contains("deepseek")
    {
        return PromptFormat::ChatML;
    }

    // Proprietary APIs — trust their server-side templating
    if lower.contains("gpt-")
        || lower.starts_with("o1-")
        || lower.starts_with("o3-")
        || lower.contains("claude-")
        || lower.contains("gemini-")
    {
        return PromptFormat::OpenAICompat;
    }

    // Unknown model — default to OpenAICompat (trust server-side templating).
    //
    // We *don't* use [`PromptFormat::Plain`] here because most modern open
    // models are heavily instruction-tuned to their native chat template
    // (e.g. Gemma 4's `<|turn>` tokens). Without those tokens they fall back
    // to raw completion behaviour and echo prompts instead of answering.
    //
    // Callers who know they have a generic completion model can override
    // the format explicitly via the `format` field on `ProviderConfig`.
    PromptFormat::OpenAICompat
}

/// Where an adapter's [`endpoint_path`](ModelAdapter::endpoint_path) is rooted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndpointScope {
    /// Path is relative to the OpenAI-compat base URL as provided
    /// (`http://host/v1/...`). Most chat-completions endpoints use this.
    OpenAICompat,
    /// Path is relative to the **server root**, below any `/v1` segment
    /// (e.g. llama.cpp's `/completion` endpoint at `http://host/completion`).
    /// The client strips a trailing `/v1` or `/api/v1` from the configured
    /// endpoint before appending the path.
    ServerRoot,
}

/// An adapter that handles wire-format conversion for a specific model family.
///
/// Adapters are stateless and safe to share across requests. Per-request
/// streaming state lives in the [`StreamParser`] returned by
/// [`ModelAdapter::new_stream_parser`].
pub trait ModelAdapter: Send + Sync {
    /// Short identifier for logging (e.g., `"openai_compat"`, `"gemma"`).
    fn name(&self) -> &'static str;

    /// URL path to append to the base endpoint. For OpenAI-compat this is
    /// `"/chat/completions"`. For native templates using llama.cpp's raw
    /// completion endpoint this would be `"/completions"` or `"/completion"`.
    fn endpoint_path(&self) -> &'static str;

    /// Whether [`endpoint_path`](Self::endpoint_path) is relative to the
    /// OpenAI-compatible base (e.g. `.../v1`) or the **server root** (e.g.
    /// `http://host:port/`, below any `/v1` segment).
    ///
    /// Most OpenAI-compat adapters use [`EndpointScope::OpenAICompat`].
    /// Native template adapters that hit llama.cpp's `/completion` endpoint
    /// (which is served at the server root) use [`EndpointScope::ServerRoot`].
    fn endpoint_scope(&self) -> EndpointScope {
        EndpointScope::OpenAICompat
    }

    /// Build the JSON request body to POST to the server.
    fn build_request_body(
        &self,
        model: &str,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
        temperature: f32,
        max_tokens: u32,
    ) -> serde_json::Value;

    /// Create a fresh [`StreamParser`] for one request. Each request gets
    /// its own parser because streaming state (buffers, in-progress tool
    /// calls) must not leak between requests.
    fn new_stream_parser(&self) -> Box<dyn StreamParser>;
}

/// Per-request streaming parser. Holds state (buffers, partial tool calls)
/// for one HTTP request's worth of SSE data.
pub trait StreamParser: Send {
    /// Process one SSE `data:` line (with the `data: ` prefix stripped).
    /// May emit zero or more events.
    ///
    /// If the line is `[DONE]` the parser should treat it as end-of-stream
    /// and may emit a final `Done` event.
    fn process_sse_data(&mut self, data: &str) -> Vec<LlmStreamEvent>;

    /// Called once when the HTTP stream closes without another event being
    /// emitted. Gives the parser a chance to flush any buffered content and
    /// ensure a `Done` event is emitted if not already.
    fn finalize(&mut self) -> Vec<LlmStreamEvent>;
}

/// Construct a boxed adapter for the given format.
///
/// Phase 1 only implements [`PromptFormat::OpenAICompat`]. Unimplemented
/// variants transparently fall through to it — this lets us roll out
/// native adapters incrementally without breaking any configuration.
pub fn build_adapter(format: PromptFormat) -> Box<dyn ModelAdapter> {
    match format {
        PromptFormat::OpenAICompat => Box::new(openai_compat::OpenAICompatAdapter),
        PromptFormat::Plain => Box::new(plain::PlainAdapter),
        PromptFormat::Gemma => Box::new(gemma::GemmaAdapter),
        // TODO(phase 2): replace these fall-throughs with real adapters.
        PromptFormat::Llama3 => Box::new(openai_compat::OpenAICompatAdapter),
        PromptFormat::Qwen => Box::new(qwen::QwenAdapter),
        PromptFormat::ChatML => Box::new(openai_compat::OpenAICompatAdapter),
    }
}

#[derive(Deserialize, Default)]
pub(crate) struct StreamChunk {
    pub choices: Vec<StreamChoice>,
}

#[derive(Deserialize)]
pub(crate) struct StreamChoice {
    pub delta: StreamDelta,
    pub finish_reason: Option<String>,
}

#[derive(Deserialize, Default)]
pub(crate) struct StreamDelta {
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub reasoning_content: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<Vec<StreamToolCallDelta>>,
}

#[derive(Deserialize)]
pub(crate) struct StreamToolCallDelta {
    pub index: usize,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub function: Option<StreamFunctionDelta>,
}

#[derive(Deserialize, Default)]
pub(crate) struct StreamFunctionDelta {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub arguments: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<ToolDefinition>>,
    pub stream: bool,
    pub temperature: f32,
    pub max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
}

/// Build a standard OpenAI-compat request body for chat completions.
pub(crate) fn build_openai_request_body(
    model: &str,
    messages: &[ChatMessage],
    tools: &[ToolDefinition],
    temperature: f32,
    max_tokens: u32,
) -> serde_json::Value {
    let body = ChatCompletionRequest {
        model: model.to_string(),
        messages: messages.to_vec(),
        tools: if tools.is_empty() {
            None
        } else {
            Some(tools.to_vec())
        },
        stream: true,
        temperature,
        max_tokens,
        reasoning_effort: None,
    };
    serde_json::to_value(&body).unwrap_or(serde_json::Value::Null)
}

/// How much of `buffer` can we safely emit without splitting a potential tag?
pub(crate) fn safe_emit_len(buffer: &str, tag: &str) -> usize {
    let len = buffer.len();
    if len == 0 {
        return 0;
    }
    for i in (1..=tag.len().min(len)).rev() {
        if buffer.ends_with(&tag[..i]) {
            return len - i;
        }
    }
    len
}

/// Safe emit length checking multiple potential tags.
pub(crate) fn safe_emit_len_multi(buffer: &str, tags: &[&str]) -> usize {
    let mut min = buffer.len();
    for tag in tags {
        min = min.min(safe_emit_len(buffer, tag));
    }
    min
}

/// Emit a format-error sentinel tool call delta when fallback parsing fails.
pub(crate) fn emit_format_error(idx: usize, content: &str, err: &str) -> LlmStreamEvent {
    let truncated = if content.len() > 200 {
        let end = content.floor_char_boundary(200);
        &content[..end]
    } else {
        content
    };
    LlmStreamEvent::ToolCallDelta {
        index: idx,
        id: Some(format!("call_{}", idx + 1)),
        name: Some("__format_error__".to_string()),
        arguments_chunk: json!({
            "raw": truncated,
            "error": err
        })
        .to_string(),
    }
}

/// Remove all `open_prefix … close_tag` blocks from `text`.
///
/// Both Gemma (`<|channel>thought … <channel|>`) and Qwen (`<think>…</think>`)
/// use the same algorithmic pattern: find the open prefix, skip to the close
/// tag, remove everything in between (including the tags themselves).
///
/// When `strip_trailing_newline` is `true`, a single leading `\n` immediately
/// after each close tag is also consumed (Qwen's `</think>` convention).
pub(crate) fn strip_paired_blocks(
    text: &str,
    open_prefix: &str,
    close_tag: &str,
    strip_trailing_newline: bool,
) -> String {
    let mut result = String::with_capacity(text.len());
    let mut remaining = text;
    while let Some(start) = remaining.find(open_prefix) {
        result.push_str(&remaining[..start]);
        let after_open = &remaining[start + open_prefix.len()..];
        if let Some(end) = after_open.find(close_tag) {
            remaining = &after_open[end + close_tag.len()..];
            if strip_trailing_newline {
                remaining = remaining.strip_prefix('\n').unwrap_or(remaining);
            }
        } else {
            // Unclosed block — skip everything after open tag
            remaining = "";
        }
    }
    result.push_str(remaining);
    result
}

/// Remove all blocks delimited by any of the given `(open, close)` tag pairs.
///
/// This is a convenience wrapper around [`strip_paired_blocks`] applied
/// sequentially for each pair. Useful for stripping multiple raw-token
/// families in one call (e.g. `<tool_call>…` **and** `<tool_response>…`).
pub(crate) fn strip_tag_pairs(text: &str, pairs: &[(&str, &str)]) -> String {
    let mut result = text.to_string();
    for &(open, close) in pairs {
        result = strip_paired_blocks(&result, open, close, false);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_format_gemma() {
        assert_eq!(
            detect_format("unsloth/gemma-4-26B-A4B-it-GGUF:UD-Q4_K_XL"),
            PromptFormat::Gemma
        );
        assert_eq!(detect_format("google/gemma-2-9b-it"), PromptFormat::Gemma);
        assert_eq!(detect_format("gemma-3-27b"), PromptFormat::Gemma);
    }

    #[test]
    fn detect_format_llama3() {
        assert_eq!(
            detect_format("meta-llama/Llama-3.1-70B-Instruct"),
            PromptFormat::Llama3
        );
        assert_eq!(detect_format("llama3.2:latest"), PromptFormat::Llama3);
        assert_eq!(detect_format("Llama-4-Scout-17B"), PromptFormat::Llama3);
    }

    #[test]
    fn detect_format_qwen() {
        assert_eq!(
            detect_format("Qwen/Qwen2.5-32B-Instruct"),
            PromptFormat::Qwen
        );
        assert_eq!(detect_format("qwen3:7b"), PromptFormat::Qwen);
    }

    #[test]
    fn detect_format_chatml_family() {
        assert_eq!(
            detect_format("mistralai/Mistral-7B-Instruct-v0.3"),
            PromptFormat::ChatML
        );
        assert_eq!(detect_format("mixtral-8x7b"), PromptFormat::ChatML);
        assert_eq!(detect_format("phi-4"), PromptFormat::ChatML);
        assert_eq!(detect_format("deepseek-coder-v2"), PromptFormat::ChatML);
    }

    #[test]
    fn detect_format_proprietary_apis() {
        assert_eq!(detect_format("gpt-4o"), PromptFormat::OpenAICompat);
        assert_eq!(detect_format("gpt-4o-mini"), PromptFormat::OpenAICompat);
        assert_eq!(detect_format("o1-preview"), PromptFormat::OpenAICompat);
        assert_eq!(detect_format("o3-mini"), PromptFormat::OpenAICompat);
        assert_eq!(
            detect_format("claude-3-5-sonnet-20241022"),
            PromptFormat::OpenAICompat
        );
        assert_eq!(detect_format("gemini-1.5-pro"), PromptFormat::OpenAICompat);
    }

    #[test]
    fn detect_format_unknown_falls_back_to_openai_compat() {
        assert_eq!(
            detect_format("some-random-model"),
            PromptFormat::OpenAICompat
        );
        assert_eq!(
            detect_format("my-custom-finetune"),
            PromptFormat::OpenAICompat
        );
        assert_eq!(detect_format(""), PromptFormat::OpenAICompat);
    }

    #[test]
    fn build_adapter_dispatches_correctly() {
        // Phase 2 status: Plain and Gemma are native, others fall through to OpenAICompat.
        assert_eq!(build_adapter(PromptFormat::Plain).name(), "plain");
        assert_eq!(build_adapter(PromptFormat::Gemma).name(), "gemma");
        assert_eq!(build_adapter(PromptFormat::Qwen).name(), "qwen");
        assert_eq!(
            build_adapter(PromptFormat::OpenAICompat).name(),
            "openai_compat"
        );
        // Unimplemented native formats still fall through.
        for format in [PromptFormat::Llama3, PromptFormat::ChatML] {
            assert_eq!(build_adapter(format).name(), "openai_compat");
        }
    }

    #[test]
    fn strip_paired_blocks_basic() {
        let input = "before<open>content<close>after";
        assert_eq!(
            strip_paired_blocks(input, "<open>", "<close>", false),
            "beforeafter"
        );
    }

    #[test]
    fn strip_paired_blocks_multiple() {
        let input = "a<open>x<close>b<open>y<close>c";
        assert_eq!(
            strip_paired_blocks(input, "<open>", "<close>", false),
            "abc"
        );
    }

    #[test]
    fn strip_paired_blocks_unclosed() {
        let input = "before<open>unclosed content";
        assert_eq!(
            strip_paired_blocks(input, "<open>", "<close>", false),
            "before"
        );
    }

    #[test]
    fn strip_paired_blocks_no_match() {
        assert_eq!(
            strip_paired_blocks("plain text", "<open>", "<close>", false),
            "plain text"
        );
    }

    #[test]
    fn strip_paired_blocks_trailing_newline() {
        let input = "<think>thought\n</think>\ntext";
        assert_eq!(
            strip_paired_blocks(input, "<think>", "</think>", true),
            "text"
        );
    }

    #[test]
    fn strip_paired_blocks_no_trailing_newline_flag() {
        let input = "<think>thought</think>\ntext";
        assert_eq!(
            strip_paired_blocks(input, "<think>", "</think>", false),
            "\ntext"
        );
    }

    #[test]
    fn strip_tag_pairs_multiple_families() {
        let input = "a<x>1</x>b<y>2</y>c";
        assert_eq!(
            strip_tag_pairs(input, &[("<x>", "</x>"), ("<y>", "</y>")]),
            "abc"
        );
    }

    #[test]
    fn strip_tag_pairs_no_match() {
        assert_eq!(
            strip_tag_pairs("clean text", &[("<x>", "</x>")]),
            "clean text"
        );
    }
}
