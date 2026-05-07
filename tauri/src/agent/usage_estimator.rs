use tiktoken_rs::cl100k_base;

/// Returns (prompt_tokens, completion_tokens, was_estimated).
///
/// `reported_*` are populated when the server returned a usage block.
/// When None, we estimate from the text using tiktoken (cl100k for OpenAI-family),
/// or fall back to word-count × 1.3 for unknown models.
pub fn count_tokens(
    model_id: &str,
    prompt_text: &str,
    completion_text: &str,
    reported_prompt: Option<i64>,
    reported_completion: Option<i64>,
) -> (i64, i64, bool) {
    if let (Some(p), Some(c)) = (reported_prompt, reported_completion) {
        return (p, c, false);
    }

    let lower = model_id.to_lowercase();
    let use_tiktoken = lower.contains("gpt")
        || lower.contains("openai")
        || lower.contains("o1")
        || lower.contains("o3");

    let (p, c) = if use_tiktoken {
        match cl100k_base() {
            Ok(bpe) => {
                let p = bpe.encode_with_special_tokens(prompt_text).len() as i64;
                let c = bpe.encode_with_special_tokens(completion_text).len() as i64;
                (p, c)
            }
            Err(_) => fallback(prompt_text, completion_text),
        }
    } else {
        fallback(prompt_text, completion_text)
    };

    (p, c, true)
}

fn fallback(prompt: &str, completion: &str) -> (i64, i64) {
    let est = |s: &str| -> i64 {
        let words = s.split_whitespace().count() as f64;
        (words * 1.3).round() as i64
    };
    (est(prompt), est(completion))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reported_values_short_circuit_estimator() {
        let (p, c, est) = count_tokens("gpt-4", "x", "y", Some(100), Some(50));
        assert_eq!(p, 100);
        assert_eq!(c, 50);
        assert!(!est);
    }

    #[test]
    fn fallback_uses_word_count() {
        let (p, c, est) = count_tokens(
            "mystery-model",
            "one two three four five",
            "alpha beta",
            None,
            None,
        );
        assert_eq!(p, 7); // 5 * 1.3 = 6.5 → round 7
        assert_eq!(c, 3); // 2 * 1.3 = 2.6 → round 3
        assert!(est);
    }

    #[test]
    fn tiktoken_path_for_openai_models() {
        let (p, c, est) = count_tokens("gpt-4", "Hello, world!", "Hi.", None, None);
        assert!(p > 0);
        assert!(c > 0);
        assert!(est);
    }
}
