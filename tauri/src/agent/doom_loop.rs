use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// Doom loop detector — identifies when the agent is stuck in repetitive tool call patterns.
///
/// Detects two types of loops:
/// 1. Consecutive identical calls: [A,A,A] — same tool with same arguments
/// 2. Repeating patterns: [A,B,C][A,B,C][A,B,C] — sequence of calls repeating
///
/// Arguments are stored as hashes to avoid unbounded memory growth from
/// tool calls that contain entire file contents (e.g., write tool).
/// History is capped at `MAX_HISTORY` entries.
#[derive(Debug, Clone)]
pub struct DoomLoopDetector {
    history: Vec<(String, u64)>, // (tool_name, arguments_hash)
    threshold: usize,
}

/// Maximum number of entries retained in the history ring.
const MAX_HISTORY: usize = 30;

fn hash_string(s: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    s.hash(&mut hasher);
    hasher.finish()
}

impl Default for DoomLoopDetector {
    fn default() -> Self {
        Self {
            history: Vec::new(),
            threshold: 3,
        }
    }
}

impl DoomLoopDetector {
    #[allow(dead_code)]
    pub fn new(threshold: usize) -> Self {
        Self {
            history: Vec::new(),
            threshold,
        }
    }

    /// Record a tool call in the history.
    pub fn record(&mut self, tool_name: &str, arguments: &str) {
        self.history
            .push((tool_name.to_string(), hash_string(arguments)));
        // Cap history to avoid unbounded growth.
        if self.history.len() > MAX_HISTORY {
            let excess = self.history.len() - MAX_HISTORY;
            self.history.drain(..excess);
        }
    }

    /// Check for repeating patterns. Returns Some(repetition_count) if a loop is detected.
    pub fn check(&self) -> Option<usize> {
        if self.history.len() < self.threshold {
            return None;
        }

        // Check patterns of increasing length
        for pattern_len in 1..=self.history.len() / self.threshold {
            let reps = self.count_trailing_repetitions(pattern_len);
            if reps >= self.threshold {
                return Some(reps);
            }
        }
        None
    }

    /// Count how many times a pattern of given length repeats at the end of the history.
    /// Works backwards from the most recent calls.
    fn count_trailing_repetitions(&self, pattern_len: usize) -> usize {
        let len = self.history.len();
        if pattern_len == 0 || len < pattern_len {
            return 0;
        }

        // The pattern is defined by the last pattern_len elements
        let pattern_start = len - pattern_len;
        let pattern = &self.history[pattern_start..];

        let mut repetitions = 1; // The pattern itself counts as 1
        let mut pos = pattern_start;

        while pos >= pattern_len {
            pos -= pattern_len;
            let chunk = &self.history[pos..pos + pattern_len];
            if chunk == pattern {
                repetitions += 1;
            } else {
                break;
            }
        }

        repetitions
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_no_loop_with_few_calls() {
        let mut d = DoomLoopDetector::default();
        d.record("read", r#"{"path":"a.txt"}"#);
        d.record("read", r#"{"path":"a.txt"}"#);
        assert_eq!(d.check(), None);
    }

    #[test]
    fn test_detect_consecutive_identical() {
        let mut d = DoomLoopDetector::default();
        d.record("read", r#"{"path":"a.txt"}"#);
        d.record("read", r#"{"path":"a.txt"}"#);
        d.record("read", r#"{"path":"a.txt"}"#);
        assert_eq!(d.check(), Some(3));
    }

    #[test]
    fn test_detect_pattern_abc_abc_abc() {
        let mut d = DoomLoopDetector::default();
        for _ in 0..3 {
            d.record("read", r#"{"path":"a.txt"}"#);
            d.record("write", r#"{"path":"b.txt"}"#);
            d.record("patch", r#"{"path":"c.txt"}"#);
        }
        assert_eq!(d.check(), Some(3));
    }

    #[test]
    fn test_no_loop_with_different_args() {
        let mut d = DoomLoopDetector::default();
        d.record("read", r#"{"path":"a.txt"}"#);
        d.record("read", r#"{"path":"b.txt"}"#);
        d.record("read", r#"{"path":"c.txt"}"#);
        assert_eq!(d.check(), None);
    }

    #[test]
    fn test_detect_recent_pattern_only() {
        let mut d = DoomLoopDetector::default();
        // Old pattern that doesn't repeat
        d.record("read", r#"{"path":"x.txt"}"#);
        d.record("write", r#"{"path":"y.txt"}"#);
        // New pattern that repeats 3x
        for _ in 0..3 {
            d.record("shell", r#"{"cmd":"ls"}"#);
            d.record("read", r#"{"path":"z.txt"}"#);
        }
        assert_eq!(d.check(), Some(3));
    }

    #[test]
    fn test_custom_threshold() {
        let mut d = DoomLoopDetector::new(2);
        d.record("read", r#"{"path":"a.txt"}"#);
        d.record("read", r#"{"path":"a.txt"}"#);
        assert_eq!(d.check(), Some(2));
    }

    #[test]
    fn test_empty_history() {
        let d = DoomLoopDetector::default();
        assert_eq!(d.check(), None);
    }

    #[test]
    fn test_threshold_of_1_detects_single_call() {
        let mut d = DoomLoopDetector::new(1);
        d.record("read", r#"{"path":"a.txt"}"#);
        assert_eq!(d.check(), Some(1));
    }

    #[test]
    fn test_long_pattern_abcde_repeated() {
        let mut d = DoomLoopDetector::default(); // threshold=3
        for _ in 0..3 {
            d.record("read", r#"{"p":"a"}"#);
            d.record("write", r#"{"p":"b"}"#);
            d.record("patch", r#"{"p":"c"}"#);
            d.record("shell", r#"{"c":"d"}"#);
            d.record("fetch", r#"{"u":"e"}"#);
        }
        assert_eq!(d.check(), Some(3));
    }

    #[test]
    fn test_interleaved_non_repeating_no_detection() {
        let mut d = DoomLoopDetector::default();
        d.record("read", r#"{"p":"a"}"#);
        d.record("write", r#"{"p":"b"}"#);
        d.record("read", r#"{"p":"c"}"#);
        d.record("write", r#"{"p":"d"}"#);
        d.record("read", r#"{"p":"e"}"#);
        d.record("write", r#"{"p":"f"}"#);
        assert_eq!(d.check(), None);
    }

    #[test]
    fn test_alternating_two_tools_detected() {
        let mut d = DoomLoopDetector::default();
        for _ in 0..3 {
            d.record("read", r#"{"p":"same"}"#);
            d.record("write", r#"{"p":"same"}"#);
        }
        assert_eq!(d.check(), Some(3));
    }

    #[test]
    fn test_just_below_threshold_not_detected() {
        let mut d = DoomLoopDetector::new(4);
        for _ in 0..3 {
            d.record("read", r#"{"p":"a"}"#);
        }
        assert_eq!(d.check(), None);
    }

    #[test]
    fn test_exactly_at_threshold() {
        let mut d = DoomLoopDetector::new(4);
        for _ in 0..4 {
            d.record("read", r#"{"p":"a"}"#);
        }
        assert_eq!(d.check(), Some(4));
    }

    #[test]
    fn test_pattern_broken_by_different_call() {
        let mut d = DoomLoopDetector::default();
        d.record("read", r#"{"p":"a"}"#);
        d.record("read", r#"{"p":"a"}"#);
        d.record("write", r#"{"p":"b"}"#); // Break the pattern
        d.record("read", r#"{"p":"a"}"#);
        d.record("read", r#"{"p":"a"}"#);
        assert_eq!(d.check(), None); // Only 2 consecutive at end
    }

    #[test]
    fn test_same_tool_different_args_no_loop() {
        let mut d = DoomLoopDetector::default();
        d.record("read", r#"{"p":"file1.txt"}"#);
        d.record("read", r#"{"p":"file2.txt"}"#);
        d.record("read", r#"{"p":"file3.txt"}"#);
        assert_eq!(d.check(), None);
    }

    #[test]
    fn test_higher_threshold_5() {
        let mut d = DoomLoopDetector::new(5);
        for _ in 0..4 {
            d.record("read", r#"{"p":"a"}"#);
        }
        assert_eq!(d.check(), None); // 4 < 5
        d.record("read", r#"{"p":"a"}"#);
        assert_eq!(d.check(), Some(5)); // 5 >= 5
    }

    #[test]
    fn test_multiple_pattern_lengths_checked() {
        // Pattern of length 2 repeating 3 times, with noise before
        let mut d = DoomLoopDetector::default();
        d.record("fetch", r#"{"u":"random"}"#);
        d.record("shell", r#"{"c":"other"}"#);
        for _ in 0..3 {
            d.record("read", r#"{"p":"x"}"#);
            d.record("write", r#"{"p":"x"}"#);
        }
        assert_eq!(d.check(), Some(3));
    }

    #[test]
    fn test_same_tool_and_args_detected_via_hash() {
        // Same tool+args combo should be detected as stuck
        let mut d = DoomLoopDetector::default();
        let big_content = "x".repeat(10_000); // large arg to verify hashing works
        for _ in 0..3 {
            d.record("write", &big_content);
        }
        assert_eq!(d.check(), Some(3));
    }

    #[test]
    fn test_different_args_produce_different_hashes() {
        let h1 = hash_string(r#"{"path":"a.txt","content":"hello"}"#);
        let h2 = hash_string(r#"{"path":"a.txt","content":"world"}"#);
        assert_ne!(h1, h2, "Different arguments must produce different hashes");
    }

    #[test]
    fn test_history_cap_at_max() {
        let mut d = DoomLoopDetector::default();
        for i in 0..50 {
            d.record(&format!("tool_{}", i), &format!("args_{}", i));
        }
        // History should be capped at MAX_HISTORY (30)
        assert_eq!(d.history.len(), MAX_HISTORY);
        // The oldest entries should have been drained; first remaining is tool_20
        assert_eq!(d.history[0].0, "tool_20");
    }

    #[test]
    fn test_detection_still_works_after_history_cap() {
        let mut d = DoomLoopDetector::default();
        // Fill history past the cap with unique calls
        for i in 0..28 {
            d.record(&format!("tool_{}", i), &format!("args_{}", i));
        }
        // Now add a repeating pattern that should be detected
        for _ in 0..3 {
            d.record("stuck_tool", r#"{"same":"args"}"#);
        }
        // 28 + 3 = 31, but record() drains excess when len > MAX_HISTORY,
        // so after the 31st insert we're back to 30.
        assert_eq!(d.history.len(), MAX_HISTORY);
        // The detector should still catch the 3 consecutive identical calls
        assert_eq!(d.check(), Some(3));
    }
}
