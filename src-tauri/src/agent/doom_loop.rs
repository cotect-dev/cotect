/// Doom loop detector — identifies when the agent is stuck in repetitive tool call patterns.
///
/// Detects two types of loops:
/// 1. Consecutive identical calls: [A,A,A] — same tool with same arguments
/// 2. Repeating patterns: [A,B,C][A,B,C][A,B,C] — sequence of calls repeating
///
/// Adapted from Forge Code's doom_loop.rs pattern.
#[derive(Debug, Clone)]
pub struct DoomLoopDetector {
    history: Vec<(String, String)>, // (tool_name, arguments_json)
    threshold: usize,
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
    #[allow(dead_code)] // Used in tests
    pub fn new(threshold: usize) -> Self {
        Self {
            history: Vec::new(),
            threshold,
        }
    }

    /// Record a tool call in the history.
    pub fn record(&mut self, tool_name: &str, arguments: &str) {
        self.history
            .push((tool_name.to_string(), arguments.to_string()));
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
}
