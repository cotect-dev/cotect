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
}

#[derive(Deserialize)]
struct ModelsResponse {
    data: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    id: String,
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

impl LlmClient {
    pub fn new(config: &ProviderConfig) -> Self {
        Self {
            http: Client::new(),
            endpoint: config.endpoint.trim_end_matches('/').to_string(),
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
    ) -> Result<mpsc::Receiver<LlmStreamEvent>> {
        let url = format!("{}/chat/completions", self.endpoint);

        let body = ChatCompletionRequest {
            model: self.model.clone(),
            messages,
            tools,
            stream: true,
            temperature,
            max_tokens: 16384,
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

        let (tx, rx) = mpsc::channel(256);

        tokio::spawn(async move {
            if let Err(e) = stream_sse_events(response, &tx).await {
                let _ = tx.send(LlmStreamEvent::Error(e.to_string())).await;
            }
        });

        Ok(rx)
    }

    /// Fetch available models from the /models endpoint.
    pub async fn list_models(&self) -> Result<Vec<String>> {
        let url = format!("{}/models", self.endpoint);
        let mut request = self.http.get(&url);
        if let Some(key) = &self.api_key {
            request = request.bearer_auth(key);
        }

        let resp = request
            .send()
            .await
            .context("Failed to connect to models endpoint")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            bail!("Models API error {status}: {body}");
        }

        let models: ModelsResponse = resp.json().await.context("Failed to parse models response")?;
        Ok(models.data.into_iter().map(|m| m.id).collect())
    }
}

/// Parse SSE lines from the response body and emit LlmStreamEvents.
/// Uses a 60-second inactivity timeout — if no bytes arrive for 60s,
/// the stream is considered dead and a Done event is sent.
async fn stream_sse_events(
    response: reqwest::Response,
    tx: &mpsc::Sender<LlmStreamEvent>,
) -> Result<()> {
    use tokio_stream::StreamExt;

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let idle_timeout = std::time::Duration::from_secs(60);

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
                // 60s with no bytes — server is stalled
                tx.send(LlmStreamEvent::Done {
                    finish_reason: Some("timeout".into()),
                })
                .await
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
                    return Ok(());
                }

                match serde_json::from_str::<StreamChunk>(data) {
                    Ok(chunk) => {
                        for choice in &chunk.choices {
                            // Text content
                            if let Some(text) = &choice.delta.content {
                                if !text.is_empty() {
                                    tx.send(LlmStreamEvent::TextDelta(text.clone()))
                                        .await
                                        .ok();
                                }
                            }

                            // Reasoning content
                            if let Some(reasoning) = &choice.delta.reasoning_content {
                                if !reasoning.is_empty() {
                                    tx.send(LlmStreamEvent::ReasoningDelta(reasoning.clone()))
                                        .await
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
                                    .await
                                    .ok();
                                }
                            }

                            // Finish reason
                            if let Some(reason) = &choice.finish_reason {
                                tx.send(LlmStreamEvent::Done {
                                    finish_reason: Some(reason.clone()),
                                })
                                .await
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
    .await
    .ok();

    Ok(())
}
