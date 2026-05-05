use anyhow::{Context, Result, bail};
use reqwest::Client;
use serde::Deserialize;
use tokio::sync::mpsc;

use super::adapter::{self, ModelAdapter};
use super::types::{ChatMessage, LlmStreamEvent, ProviderConfig, ToolDefinition};

pub struct LlmClient {
    http: Client,
    endpoint: String,
    api_key: Option<String>,
    model: String,
    adapter: Box<dyn ModelAdapter>,
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

/// Normalize an endpoint URL to the OpenAI-compatible base path:
/// strip trailing `/`, `/models`, and convert LM Studio's `/api/v1` to `/v1`.
fn normalize_endpoint(raw: &str) -> String {
    let mut endpoint = raw.trim_end_matches('/').to_string();

    if endpoint.ends_with("/models") {
        endpoint.truncate(endpoint.len() - "/models".len());
    }

    // LM Studio's native API is /api/v1; chat/completions wants /v1.
    if endpoint.ends_with("/api/v1") {
        let base = &endpoint[..endpoint.len() - "/api/v1".len()];
        endpoint = format!("{base}/v1");
    }

    endpoint
}

/// Strip a trailing `/v1`, `/api/v1`, or `/openai/v1` from an endpoint so a
/// [`EndpointScope::ServerRoot`](crate::agent::adapter::EndpointScope::ServerRoot)
/// adapter path (like `/completion`) lands at the server root.
fn strip_v1_suffix(endpoint: &str) -> String {
    let trimmed = endpoint.trim_end_matches('/');
    for suffix in &["/openai/v1", "/api/v1", "/v1"] {
        if let Some(stripped) = trimmed.strip_suffix(suffix) {
            return stripped.to_string();
        }
    }
    trimmed.to_string()
}

impl LlmClient {
    pub fn new(config: &ProviderConfig) -> Self {
        let format = config.resolved_format();
        Self {
            http: Client::new(),
            endpoint: normalize_endpoint(&config.endpoint),
            api_key: config.api_key.clone(),
            model: config.model.clone(),
            adapter: adapter::build_adapter(format),
        }
    }

    /// Start a streaming chat completion. Returns a receiver of stream events.
    pub async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        tools: Option<Vec<ToolDefinition>>,
        temperature: f32,
    ) -> Result<mpsc::UnboundedReceiver<LlmStreamEvent>> {
        let base = match self.adapter.endpoint_scope() {
            adapter::EndpointScope::OpenAICompat => self.endpoint.clone(),
            adapter::EndpointScope::ServerRoot => strip_v1_suffix(&self.endpoint),
        };
        let url = format!("{}{}", base, self.adapter.endpoint_path());

        let tools_slice = tools.as_deref().unwrap_or(&[]);
        let body =
            self.adapter
                .build_request_body(&self.model, &messages, tools_slice, temperature, std::env::var("COTECT_MAX_TOKENS").ok().and_then(|v| v.parse().ok()).unwrap_or(65536));

        if std::env::var("COTECT_DEBUG_REQUESTS").is_ok() {
            if let Ok(json) = serde_json::to_string_pretty(&body) {
                eprintln!(
                    "\n━━━ LLM REQUEST [{}] ━━━\n{}\n━━━━━━━━━━━━━━━━━━",
                    self.adapter.name(),
                    json
                );
            }
        }

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
        let parser = self.adapter.new_stream_parser();

        tokio::spawn(async move {
            if let Err(e) = stream_sse_events(response, parser, &tx).await {
                let _ = tx.send(LlmStreamEvent::Error(e.to_string()));
            }
        });

        Ok(rx)
    }

    /// Tries OpenAI-compat `/v1/models` first, then LM Studio's `/api/v1/models`.
    pub async fn list_models(&self) -> Result<Vec<String>> {
        let lm_studio_url = if self.endpoint.ends_with("/v1") {
            let base = &self.endpoint[..self.endpoint.len() - "/v1".len()];
            format!("{base}/api/v1/models")
        } else {
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

            // Merge "data" (OpenAI) and "models" (LM Studio) fields.
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

/// Parse SSE lines and emit `LlmStreamEvent`s via the adapter's parser.
/// Uses an idle timeout (default 60s, COTECT_STREAM_IDLE_TIMEOUT) — long
/// enough that reasoning-heavy models (Gemma 4 silent thinking 10-20s)
/// don't trip it. Unbounded channel so the parser never blocks on consumers.
async fn stream_sse_events(
    response: reqwest::Response,
    mut parser: Box<dyn adapter::StreamParser>,
    tx: &mpsc::UnboundedSender<LlmStreamEvent>,
) -> Result<()> {
    use tokio_stream::StreamExt;

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let idle_timeout = std::time::Duration::from_secs(
        std::env::var("COTECT_STREAM_IDLE_TIMEOUT").ok().and_then(|v| v.parse().ok()).unwrap_or(60)
    );

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
                break;
            }
            Err(_) => {
                // Idle timeout — server stalled.
                tx.send(LlmStreamEvent::Done {
                    finish_reason: Some("timeout".into()),
                })
                .ok();
                return Ok(());
            }
        }

        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].trim().to_string();
            buffer.drain(..=newline_pos);

            if line.is_empty() {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                let is_done_marker = data == "[DONE]";
                let events = parser.process_sse_data(data);
                for event in events {
                    tx.send(event).ok();
                }
                if is_done_marker {
                    return Ok(());
                }
            }
        }
    }

    // No [DONE] received — let the parser flush its final state.
    for event in parser.finalize() {
        tx.send(event).ok();
    }

    Ok(())
}
