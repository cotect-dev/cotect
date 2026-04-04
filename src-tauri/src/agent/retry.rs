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
    msg.contains("timeout")
        || msg.contains("connection")
        || msg.contains("rate limit")
        || msg.contains("429")
        || msg.contains("500")
        || msg.contains("502")
        || msg.contains("503")
        || msg.contains("504")
        || msg.contains("retryable")
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
}
