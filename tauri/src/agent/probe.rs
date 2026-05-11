use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProbeInput {
    pub endpoint: String,    // accepts host:port or full URL
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Probed {
    pub normalized_endpoint: String,
    pub server_type: String,         // "Ollama" | "OpenAI" | "llama.cpp" | "OpenAI-compatible (unknown)" | etc.
    pub models: Vec<DetectedModel>,
    pub capabilities: Vec<String>,   // e.g. ["streaming", "tool-calls"]
    pub format_per_model: std::collections::HashMap<String, String>,
    pub probe_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DetectedModel {
    pub id: String,
    pub family: Option<String>,
    pub context: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, thiserror::Error)]
pub enum ProbeError {
    #[error("endpoint unreachable: {0}")]
    Unreachable(String),
    #[error("authentication failed: {0}")]
    Auth(String),
    #[error("server doesn't expose /v1/models: {0}")]
    NotFound(String),
    #[error("tls handshake failed: {0}")]
    Tls(String),
    #[error("probe timed out after {0:?}")]
    Timeout(Duration),
    #[error("malformed response: {0}")]
    BadResponse(String),
}

pub fn diagnostic(err: &ProbeError, endpoint: &str) -> String {
    match err {
        ProbeError::Unreachable(_) => {
            let port = endpoint.rsplit(':').next().unwrap_or("?");
            format!("Endpoint unreachable. Is the server running on :{}?", port)
        }
        ProbeError::Auth(msg) if endpoint.contains("api.openai.com") => {
            format!("API key missing or invalid. OpenAI keys start with `sk-`. ({})", msg)
        }
        ProbeError::Auth(msg) => format!("Authentication failed. Check the API key. ({})", msg),
        ProbeError::NotFound(_) => "Server doesn't expose `/v1/models`. Try a different endpoint or enable OpenAI-compat.".into(),
        ProbeError::Tls(msg) => format!("TLS handshake failed. If self-signed, configure trust at the OS level. ({})", msg),
        ProbeError::Timeout(_) => "Probe timed out. Server may be slow or behind a proxy.".into(),
        ProbeError::BadResponse(msg) => format!("Server response not understood: {}", msg),
    }
}

fn normalize(endpoint: &str) -> String {
    if endpoint.starts_with("http://") || endpoint.starts_with("https://") {
        endpoint.to_string()
    } else {
        format!("http://{}/v1", endpoint.trim_end_matches('/'))
    }
}

fn detect_format(model_id: &str) -> &'static str {
    let lower = model_id.to_lowercase();
    if lower.contains("qwen") { "qwen" }
    else if lower.contains("gemma") { "gemma" }
    else if lower.contains("llama-3") || lower.contains("llama3") { "llama3" }
    else if lower.contains("claude") { "anthropic" }
    else { "openai_compat" }
}

fn detect_family(model_id: &str) -> Option<String> {
    let lower = model_id.to_lowercase();
    if lower.contains("qwen") { Some("Qwen".into()) }
    else if lower.contains("gemma") { Some("Gemma".into()) }
    else if lower.contains("llama-3") || lower.contains("llama3") { Some("Llama-3".into()) }
    else if lower.contains("claude") { Some("Claude".into()) }
    else if lower.contains("gpt") { Some("GPT".into()) }
    else { None }
}

fn detect_server_type(headers: &reqwest::header::HeaderMap, body_sample: &str) -> String {
    if let Some(server) = headers.get("server").and_then(|v| v.to_str().ok()) {
        if server.to_lowercase().contains("ollama") { return "Ollama".into() }
    }
    if headers.keys().any(|k| k.as_str().to_lowercase().starts_with("x-llama-cpp")) {
        return "llama.cpp".into()
    }
    if headers.contains_key("openai-organization") {
        return "OpenAI".into()
    }
    if body_sample.contains("\"object\":\"list\"") {
        return "OpenAI-compatible (unknown)".into()
    }
    "OpenAI-compatible (unknown)".into()
}

fn capabilities_for(server_type: &str, models: &[DetectedModel]) -> Vec<String> {
    let mut caps = vec!["streaming".to_string()];
    if matches!(server_type, "Ollama" | "OpenAI" | "llama.cpp") {
        caps.push("tool-calls".into());
    }
    if models.iter().any(|m| {
        let l = m.id.to_lowercase();
        l.contains("qwen3") || l.contains("deepseek-r1") || l.contains("gpt-5") || l.contains("o1")
    }) {
        caps.push("thinking".into());
    }
    caps
}

pub async fn probe(input: &ProbeInput) -> Result<Probed, ProbeError> {
    let start = Instant::now();
    let normalized = normalize(&input.endpoint);
    let url = format!("{}/models", normalized.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| ProbeError::BadResponse(e.to_string()))?;

    let mut req = client.get(&url);
    if let Some(k) = &input.api_key {
        req = req.bearer_auth(k);
    }

    let resp = req.send().await.map_err(|e| {
        if e.is_timeout() { return ProbeError::Timeout(Duration::from_secs(10)) }
        if e.is_connect() { return ProbeError::Unreachable(e.to_string()) }
        if e.to_string().to_lowercase().contains("tls") { return ProbeError::Tls(e.to_string()) }
        ProbeError::Unreachable(e.to_string())
    })?;

    let status = resp.status();
    let headers = resp.headers().clone();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(ProbeError::Auth(format!("HTTP {}", status.as_u16())))
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(ProbeError::NotFound(format!("HTTP 404 from {}", url)))
    }
    if !status.is_success() {
        return Err(ProbeError::BadResponse(format!("HTTP {}", status.as_u16())))
    }

    let body = resp.text().await.map_err(|e| ProbeError::BadResponse(e.to_string()))?;
    let server_type = detect_server_type(&headers, &body);

    // Parse OpenAI-shape model list. {"data": [{"id": "...", "meta": {"n_ctx": ...}}]}
    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| ProbeError::BadResponse(e.to_string()))?;
    let arr = json.get("data").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut models = Vec::with_capacity(arr.len());
    let mut format_per_model = std::collections::HashMap::new();
    for entry in arr {
        let id = entry.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if id.is_empty() { continue; }
        let context = entry
            .get("meta").and_then(|m| m.get("n_ctx")).and_then(|v| v.as_i64())
            .or_else(|| entry.get("context_length").and_then(|v| v.as_i64()));
        format_per_model.insert(id.clone(), detect_format(&id).to_string());
        models.push(DetectedModel { family: detect_family(&id), id, context });
    }

    let capabilities = capabilities_for(&server_type, &models);

    Ok(Probed {
        normalized_endpoint: normalized,
        server_type,
        models,
        capabilities,
        format_per_model,
        probe_ms: start.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[test]
    fn normalize_bare_host_port() {
        assert_eq!(normalize("localhost:11434"), "http://localhost:11434/v1");
    }

    #[test]
    fn normalize_full_url_preserved() {
        assert_eq!(normalize("https://api.openai.com/v1"), "https://api.openai.com/v1");
    }

    #[test]
    fn detect_format_known_families() {
        assert_eq!(detect_format("qwen2.5-coder-32b"), "qwen");
        assert_eq!(detect_format("gemma-3-12b-it"), "gemma");
        assert_eq!(detect_format("llama-3.1-70b"), "llama3");
        assert_eq!(detect_format("claude-3-opus"), "anthropic");
        assert_eq!(detect_format("mystery-model"), "openai_compat");
    }

    #[tokio::test]
    async fn probe_openai_shape_success() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                r#"{"object":"list","data":[{"id":"qwen2.5-coder-32b"},{"id":"gemma-3-12b-it"}]}"#
            ))
            .mount(&server).await;

        let probed = probe(&ProbeInput {
            endpoint: server.uri().trim_start_matches("http://").to_string(),
            api_key: None,
        }).await.unwrap();
        assert_eq!(probed.models.len(), 2);
        assert_eq!(probed.format_per_model["qwen2.5-coder-32b"], "qwen");
        assert!(probed.capabilities.contains(&"streaming".into()));
    }

    #[tokio::test]
    async fn probe_returns_auth_error_on_401() {
        let server = MockServer::start().await;
        Mock::given(method("GET")).and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(401)).mount(&server).await;

        let err = probe(&ProbeInput {
            endpoint: server.uri().trim_start_matches("http://").to_string(),
            api_key: Some("bad".into()),
        }).await.unwrap_err();
        assert!(matches!(err, ProbeError::Auth(_)));
    }

    #[tokio::test]
    async fn probe_returns_not_found_on_404() {
        let server = MockServer::start().await;
        Mock::given(method("GET")).and(path("/v1/models"))
            .respond_with(ResponseTemplate::new(404)).mount(&server).await;

        let err = probe(&ProbeInput {
            endpoint: server.uri().trim_start_matches("http://").to_string(),
            api_key: None,
        }).await.unwrap_err();
        assert!(matches!(err, ProbeError::NotFound(_)));
    }

    #[test]
    fn diagnostic_phrases_openai_auth_specifically() {
        let err = ProbeError::Auth("HTTP 401".into());
        let msg = diagnostic(&err, "https://api.openai.com/v1");
        assert!(msg.contains("OpenAI keys start with `sk-`"));
    }

    #[test]
    fn diagnostic_unreachable_mentions_port() {
        let err = ProbeError::Unreachable("connection refused".into());
        let msg = diagnostic(&err, "http://localhost:11434/v1");
        assert!(msg.contains("11434"));
    }
}
