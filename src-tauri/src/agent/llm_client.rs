use anyhow::{Context, Result, bail};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use super::types::{ChatMessage, LlmStreamEvent, ProviderConfig, ToolDefinition};

pub struct LlmClient {
    http: Client,
    endpoint: String,
    api_key: Option<String>,
    model: String,
}

#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<ToolDefinition>>,
    stream: bool,
    temperature: f32,
    max_tokens: u32,
    /// Controls reasoning/thinking token budget. Set to "none" to disable
    /// extended thinking on reasoning models (e.g., Gemma 4).
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<String>,
}

#[derive(Deserialize)]
struct ModelsResponse {
    /// OpenAI-standard format uses "data", LM Studio uses "models".
    #[serde(default)]
    data: Vec<ModelEntry>,
    #[serde(default)]
    models: Vec<LmStudioModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    id: String,
}

#[derive(Deserialize)]
struct LmStudioModelEntry {
    key: String,
    /// Only include LLM-type models, not embeddings.
    #[serde(default)]
    r#type: Option<String>,
}

// SSE chunk types for streaming
#[derive(Deserialize)]
struct StreamChunk {
    choices: Vec<StreamChoice>,
}

#[derive(Deserialize)]
struct StreamChoice {
    delta: StreamDelta,
    finish_reason: Option<String>,
}

#[derive(Deserialize, Default)]
struct StreamDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    reasoning_content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<StreamToolCallDelta>>,
}

#[derive(Deserialize)]
struct StreamToolCallDelta {
    index: usize,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    function: Option<StreamFunctionDelta>,
}

#[derive(Deserialize, Default)]
struct StreamFunctionDelta {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

/// Normalize an endpoint URL to the OpenAI-compatible base path.
///
/// Handles common variations:
/// - Strips trailing `/models` (user may paste the models listing URL)
/// - Converts LM Studio's `/api/v1` to `/v1` (LM Studio uses `/api/v1` for its
///   native API but `/v1` for the OpenAI-compatible chat/completions endpoint)
/// - Strips trailing slashes
fn normalize_endpoint(raw: &str) -> String {
    let mut endpoint = raw.trim_end_matches('/').to_string();

    // Strip trailing /models suffix (user may have pasted the models URL)
    if endpoint.ends_with("/models") {
        endpoint.truncate(endpoint.len() - "/models".len());
    }

    // LM Studio serves its native API at /api/v1 but OpenAI-compatible
    // endpoints at /v1. Rewrite so chat/completions hits the right path.
    if endpoint.ends_with("/api/v1") {
        let base = &endpoint[..endpoint.len() - "/api/v1".len()];
        endpoint = format!("{base}/v1");
    }

    endpoint
}

impl LlmClient {
    pub fn new(config: &ProviderConfig) -> Self {
        Self {
            http: Client::new(),
            endpoint: normalize_endpoint(&config.endpoint),
            api_key: config.api_key.clone(),
            model: config.model.clone(),
        }
    }

    /// Start a streaming chat completion. Returns a receiver of stream events.
    pub async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        tools: Option<Vec<ToolDefinition>>,
        temperature: f32,
    ) -> Result<mpsc::UnboundedReceiver<LlmStreamEvent>> {
        let url = format!("{}/chat/completions", self.endpoint);

        let body = ChatCompletionRequest {
            model: self.model.clone(),
            messages,
            tools,
            stream: true,
            temperature,
            max_tokens: 2048,
            reasoning_effort: None,
        };

        let mut request = self.http.post(&url).json(&body);
        if let Some(key) = &self.api_key {
            request = request.bearer_auth(key);
        }

        let response = request
            .send()
            .await
            .context("Failed to connect to LLM endpoint")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            bail!("LLM API error {status}: {body}");
        }

        let (tx, rx) = mpsc::unbounded_channel();

        tokio::spawn(async move {
            if let Err(e) = stream_sse_events(response, &tx).await {
                let _ = tx.send(LlmStreamEvent::Error(e.to_string()));
            }
        });

        Ok(rx)
    }

    /// Fetch available models from the /models endpoint.
    /// Tries the OpenAI-compatible `/v1/models` first, then falls back to
    /// LM Studio's native `/api/v1/models` endpoint.
    pub async fn list_models(&self) -> Result<Vec<String>> {
        // Build fallback URL: replace trailing /v1 with /api/v1
        let lm_studio_url = if self.endpoint.ends_with("/v1") {
            let base = &self.endpoint[..self.endpoint.len() - "/v1".len()];
            format!("{base}/api/v1/models")
        } else {
            // No /v1 suffix — skip fallback
            String::new()
        };

        let mut urls = vec![format!("{}/models", self.endpoint)];
        if !lm_studio_url.is_empty() {
            urls.push(lm_studio_url);
        }

        let mut last_err = None;
        for url in &urls {
            let mut request = self.http.get(url);
            if let Some(key) = &self.api_key {
                request = request.bearer_auth(key);
            }

            let resp = match request.send().await {
                Ok(r) if r.status().is_success() => r,
                Ok(r) => {
                    let status = r.status();
                    let body = r.text().await.unwrap_or_default();
                    last_err = Some(format!("Models API error {status}: {body}"));
                    continue;
                }
                Err(e) => {
                    last_err = Some(format!("Failed to connect to models endpoint: {e}"));
                    continue;
                }
            };

            let models: ModelsResponse =
                resp.json().await.context("Failed to parse models response")?;

            // Merge results from both "data" (OpenAI) and "models" (LM Studio) fields
            let mut ids: Vec<String> = models.data.into_iter().map(|m| m.id).collect();
            ids.extend(
                models
                    .models
                    .into_iter()
                    .filter(|m| m.r#type.as_deref() != Some("embedding"))
                    .map(|m| m.key),
            );

            if !ids.is_empty() {
                return Ok(ids);
            }
        }

        bail!(last_err.unwrap_or_else(|| "No models found".into()))
    }
}

/// Parse SSE lines from the response body and emit LlmStreamEvents.
///
/// Uses a 5-second inactivity timeout — if no bytes arrive for 5s during
/// an active stream, the connection is considered dead.
///
/// Sends events via an unbounded channel so the SSE parser never blocks,
/// regardless of how fast or slow the consumer drains events.
async fn stream_sse_events(
    response: reqwest::Response,
    tx: &mpsc::UnboundedSender<LlmStreamEvent>,
) -> Result<()> {
    use tokio_stream::StreamExt;

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let idle_timeout = std::time::Duration::from_secs(5);

    loop {
        let chunk = tokio::time::timeout(idle_timeout, stream.next()).await;

        match chunk {
            Ok(Some(Ok(bytes))) => {
                buffer.push_str(&String::from_utf8_lossy(&bytes));
            }
            Ok(Some(Err(e))) => {
                return Err(anyhow::anyhow!("Stream read error: {e}"));
            }
            Ok(None) => {
                // Stream ended normally
                break;
            }
            Err(_) => {
                // 5s with no bytes — server is stalled
                tx.send(LlmStreamEvent::Done {
                    finish_reason: Some("timeout".into()),
                })
                .ok();
                return Ok(());
            }
        }

        // Process complete lines
        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].trim().to_string();
            buffer.drain(..=newline_pos);

            if line.is_empty() {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    // Send Done explicitly — don't rely solely on channel close
                    tx.send(LlmStreamEvent::Done {
                        finish_reason: None,
                    })
                    .ok();
                    return Ok(());
                }

                match serde_json::from_str::<StreamChunk>(data) {
                    Ok(chunk) => {
                        for choice in &chunk.choices {
                            // Text content
                            if let Some(text) = &choice.delta.content {
                                if !text.is_empty() {
                                    tx.send(LlmStreamEvent::TextDelta(text.clone()))
                                        .ok();
                                }
                            }

                            // Reasoning content
                            if let Some(reasoning) = &choice.delta.reasoning_content {
                                if !reasoning.is_empty() {
                                    tx.send(
                                        LlmStreamEvent::ReasoningDelta(reasoning.clone()),
                                    )
                                    .ok();
                                }
                            }

                            // Tool call deltas
                            if let Some(tool_calls) = &choice.delta.tool_calls {
                                for tc in tool_calls {
                                    let func = tc.function.as_ref();
                                    tx.send(LlmStreamEvent::ToolCallDelta {
                                        index: tc.index,
                                        id: tc.id.clone(),
                                        name: func.and_then(|f| f.name.clone()),
                                        arguments_chunk: func
                                            .and_then(|f| f.arguments.clone())
                                            .unwrap_or_default(),
                                    })
                                    .ok();
                                }
                            }

                            // Finish reason
                            if let Some(reason) = &choice.finish_reason {
                                tx.send(LlmStreamEvent::Done {
                                    finish_reason: Some(reason.clone()),
                                })
                                .ok();
                            }
                        }
                    }
                    Err(_) => {
                        // Skip unparseable SSE chunks — common with some providers
                    }
                }
            }
        }
    }

    // Stream ended without [DONE] — send a Done event anyway
    tx.send(LlmStreamEvent::Done {
        finish_reason: None,
    })
    .ok();

    Ok(())
}
