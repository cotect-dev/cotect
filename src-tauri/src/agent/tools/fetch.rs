use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::agent::utils::truncate_bytes;

const MAX_RESPONSE: usize = 100 * 1024; // 100 KB

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FetchInput {
    /// The URL to fetch.
    pub url: String,
    /// If true, return raw content without processing.
    #[serde(default)]
    pub raw: Option<bool>,
}

pub async fn execute(input: &FetchInput) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client
        .get(&input.url)
        .header("User-Agent", "Cotect/1.0")
        .send()
        .await
        .map_err(|e| format!("Fetch failed for '{}': {e}", input.url))?;

    if !response.status().is_success() {
        return Err(format!(
            "HTTP {} for '{}'",
            response.status(),
            input.url
        ));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    Ok(truncate_bytes(&body, MAX_RESPONSE, &format!("Response truncated at {MAX_RESPONSE} bytes")))
}
