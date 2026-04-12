use std::future::Future;
use std::time::Duration;

use anyhow::Result;

/// Retry an async operation with exponential backoff and jitter.
/// Only retries on errors whose Display representation contains "retryable" or
/// indicates a transient failure (5xx, rate limit, timeout, connection).
pub async fn retry_with_backoff<F, Fut, T>(
    operation: F,
    max_attempts: usize,
    min_delay_ms: u64,
) -> Result<T>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<T>>,
{
    let mut attempt = 0;
    loop {
        match operation().await {
            Ok(val) => return Ok(val),
            Err(e) if attempt < max_attempts && is_retryable(&e) => {
                attempt += 1;
                let base_delay = min_delay_ms.saturating_mul(1u64 << attempt.min(10));
                let jitter = rand::random::<u64>() % base_delay.max(1);
                let delay = base_delay + jitter;
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }
            Err(e) => return Err(e),
        }
    }
}

/// Determine if an error is retryable (transient).
fn is_retryable(error: &anyhow::Error) -> bool {
    let msg = format!("{error:?}").to_lowercase();
    // Server errors (5xx)
    msg.contains("status: 5") || msg.contains("status code: 5") || msg.contains("http 5") ||
    // Specific 5xx codes
    msg.contains("500") || msg.contains("502") || msg.contains("503") || msg.contains("504") ||
    // Rate limiting
    msg.contains("429") || msg.contains("too many requests") || msg.contains("rate limit") ||
    // Connection errors
    msg.contains("connection refused") || msg.contains("connection reset") ||
    msg.contains("connection closed") || msg.contains("connection") ||
    // Timeout errors
    msg.contains("timed out") || msg.contains("timeout") ||
    // Explicit retryable marker
    msg.contains("retryable")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[tokio::test]
    async fn test_retry_succeeds_immediately() {
        let result = retry_with_backoff(|| async { Ok::<i32, anyhow::Error>(42) }, 3, 10).await;
        assert_eq!(result.unwrap(), 42);
    }

    #[tokio::test]
    async fn test_retry_succeeds_after_failures() {
        let counter = Arc::new(AtomicUsize::new(0));
        let c = counter.clone();

        let result = retry_with_backoff(
            move || {
                let c = c.clone();
                async move {
                    let attempt = c.fetch_add(1, Ordering::SeqCst);
                    if attempt < 2 {
                        Err(anyhow::anyhow!("connection timeout"))
                    } else {
                        Ok(42)
                    }
                }
            },
            5,
            1, // 1ms delay for fast tests
        )
        .await;

        assert_eq!(result.unwrap(), 42);
        assert_eq!(counter.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn test_retry_gives_up_on_non_retryable() {
        let result = retry_with_backoff(
            || async { Err::<i32, _>(anyhow::anyhow!("invalid API key")) },
            5,
            1,
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_retry_max_attempts_zero() {
        let counter = Arc::new(AtomicUsize::new(0));
        let c = counter.clone();

        let result = retry_with_backoff(
            move || {
                let c = c.clone();
                async move {
                    c.fetch_add(1, Ordering::SeqCst);
                    Err::<i32, _>(anyhow::anyhow!("connection timeout"))
                }
            },
            0, // zero retries
            1,
        )
        .await;

        // Should fail after first attempt (0 retries means 1 total attempt)
        assert!(result.is_err());
        assert_eq!(counter.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_retry_all_retryable_errors_exhaust() {
        let counter = Arc::new(AtomicUsize::new(0));
        let c = counter.clone();

        let result = retry_with_backoff(
            move || {
                let c = c.clone();
                async move {
                    c.fetch_add(1, Ordering::SeqCst);
                    Err::<i32, _>(anyhow::anyhow!("503 service unavailable"))
                }
            },
            3,
            1,
        )
        .await;

        assert!(result.is_err());
        // 1 initial + 3 retries = 4 total attempts
        assert_eq!(counter.load(Ordering::SeqCst), 4);
    }

    #[tokio::test]
    async fn test_retry_recognizes_all_retryable_patterns() {
        // Test each retryable error pattern
        for msg in [
            "connection reset",
            "timeout exceeded",
            "rate limit reached",
            "HTTP 429 Too Many Requests",
            "HTTP 500 Internal Server Error",
            "HTTP 502 Bad Gateway",
            "HTTP 503 Service Unavailable",
            "HTTP 504 Gateway Timeout",
            "retryable error occurred",
        ] {
            let err = anyhow::anyhow!("{}", msg);
            assert!(
                is_retryable(&err),
                "Should be retryable: {msg}"
            );
        }
    }

    #[tokio::test]
    async fn test_retry_non_retryable_patterns() {
        for msg in [
            "invalid API key",
            "permission denied",
            "model not found",
            "bad request: malformed JSON",
        ] {
            let err = anyhow::anyhow!("{}", msg);
            assert!(
                !is_retryable(&err),
                "Should NOT be retryable: {msg}"
            );
        }
    }

    #[tokio::test]
    async fn test_retry_succeeds_on_last_attempt() {
        let counter = Arc::new(AtomicUsize::new(0));
        let c = counter.clone();

        let result = retry_with_backoff(
            move || {
                let c = c.clone();
                async move {
                    let attempt = c.fetch_add(1, Ordering::SeqCst);
                    if attempt < 3 {
                        Err(anyhow::anyhow!("connection timeout"))
                    } else {
                        Ok(99)
                    }
                }
            },
            3, // max_attempts = 3 retries, so attempt 3 is the last retry
            1,
        )
        .await;

        assert_eq!(result.unwrap(), 99);
        assert_eq!(counter.load(Ordering::SeqCst), 4);
    }
}
