use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// Doom loop detector — identifies when the agent is stuck in repetitive tool call patterns.
///
/// Detects four failure modes:
///
/// 1. **Consecutive identical calls** — same tool with same arguments.
/// 2. **Repeating patterns** — `[A,B,C][A,B,C][A,B,C]`.
/// 3. **Near-identical calls** — same tool, similar arguments (only differ in
///    whitespace, casing, or trailing content). Catches the common case where
///    a model runs `python3 -c "# check x"` three times with slightly different
///    comments and thinks it's making progress.
/// 4. **Thinking-in-shell** — a shell command whose body is mostly Python/JS
///    comments or bare expressions with no real side effects. The model is
///    using the tool-call channel as a thinking pad.
///
/// Arguments are stored as hashes (exact + coarse) so large write-tool payloads
/// don't balloon memory. History is capped at `MAX_HISTORY` entries.
#[derive(Debug, Clone)]
pub struct DoomLoopDetector {
    /// (tool_name, exact_argument_hash, coarse_argument_hash)
    history: Vec<(String, u64, u64)>,
    /// Consecutive thinking-in-shell count — reset when a real action fires.
    thinking_shell_streak: usize,
    threshold: usize,
}

/// Maximum number of entries retained in the history ring.
const MAX_HISTORY: usize = 30;

/// How many consecutive "thinking-in-shell" commands trip the loop alarm.
const THINKING_SHELL_THRESHOLD: usize = 3;

fn hash_string(s: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    s.hash(&mut hasher);
    hasher.finish()
}

/// Coarse signature: tool name + normalised prefix of arguments. Collapses
/// whitespace, lowercases, takes first 80 characters. Lets us recognise
/// "same-shape" commands that differ only in incidental text (comments,
/// formatting, trailing variations).
fn coarse_signature(tool_name: &str, arguments: &str) -> u64 {
    let normalised: String = arguments
        .chars()
        .filter(|c| !c.is_whitespace())
        .take(80)
        .flat_map(|c| c.to_lowercase())
        .collect();
    hash_string(&format!("{}:{}", tool_name, normalised))
}

/// Strip cosmetic bash decorations from a shell tool's arguments so that
/// `python3 t.py`, `python3 t.py 2>&1`, `python3 t.py 2>&1 || true`, and
/// `python3 t.py 2>&1; echo "EXIT: $?"` all produce the same exact hash.
/// Aimed only at the noise patterns observed in eval runs.
///
/// Returns the cleaned bash command (extracted from the JSON arguments
/// blob). Used only for the EXACT hash — the coarse signature still uses
/// the raw arguments so the long-prefix collision detector keeps working
/// for `python3 -c ...; print(1)/(2)/(3)`-style near-duplicates that
/// share a long prefix but differ in tail content.
pub(crate) fn normalise_shell_arguments(arguments: &str) -> String {
    let command = match extract_command_field(arguments) {
        Some(c) => c,
        None => return arguments.to_string(),
    };

    let mut s = command;

    // Output redirects — strip in place. Conservative list; we only
    // handle the very common forms.
    let redirect_patterns = [
        " 2>&1",
        " 2>/dev/null",
        " >/dev/null",
        " &>/dev/null",
        " 1>&2",
    ];
    for pat in &redirect_patterns {
        s = s.replace(pat, "");
    }

    // Trailing noise — exit-code echo wrappers, fallthrough wrappers.
    // Order matters: strip `2>&1` first (above), then these trailing
    // patterns, so chained noise (`go test 2>&1 || true`) collapses
    // through both passes.
    let trailing_noise = [
        "; echo \"EXIT: $?\"",
        "; echo \"---EXIT: $?\"",
        "; echo $?",
        " || true",
        " | cat",
    ];
    for pat in &trailing_noise {
        s = s.replace(pat, "");
    }

    // Collapse repeated whitespace runs to a single space.
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Heuristic: does this shell command look like the model is using the shell
/// as a scratchpad for reasoning rather than actually running code?
///
/// Triggers on `python3 -c "# ..."` / `node -e "// ..."` commands where
/// almost every line is a comment or trivial expression. Also catches
/// `python3 -c " # comment only \n # comment only"`.
pub(crate) fn is_thinking_in_shell(tool_name: &str, arguments: &str) -> bool {
    if tool_name != "shell" {
        return false;
    }

    // Extract the shell `command` field from the JSON arguments without
    // pulling in serde_json for this hot path — we just need a rough read.
    let command = match extract_command_field(arguments) {
        Some(c) => c,
        None => return false,
    };

    // Only consider `-c` / `-e` style inline scripts, where the entire
    // "source code" sits inside a single shell argument.
    let lower = command.to_ascii_lowercase();
    let looks_like_inline_script = (lower.contains("python3 -c")
        || lower.contains("python -c")
        || lower.contains("node -e")
        || lower.contains("bash -c")
        || lower.contains("sh -c"))
        && command.len() > 20;
    if !looks_like_inline_script {
        return false;
    }

    // Count content lines vs comment-or-empty lines inside the inline script.
    // Comment markers covered: `#` (Python/shell), `//` (JS), `/*` / `*/`.
    let mut content_lines = 0usize;
    let mut noise_lines = 0usize;
    for raw in command.lines() {
        let line = raw.trim();
        if line.is_empty() {
            noise_lines += 1;
            continue;
        }
        if line.starts_with('#')
            || line.starts_with("//")
            || line.starts_with("/*")
            || line.starts_with('*')
        {
            noise_lines += 1;
            continue;
        }
        // The shell wrapping itself (`python3 -c`, `sh -c`, closing quote) isn't
        // really "content" — strip the command word from consideration when
        // it's a pure preamble.
        if line.contains(" -c ") || line.contains(" -e ") {
            // The preamble line itself may contain the opening quote; if
            // everything after the -c/-e flag is whitespace or a quote, the
            // line is noise.
            let after = line
                .split(" -c ")
                .nth(1)
                .unwrap_or("")
                .split(" -e ")
                .next()
                .unwrap_or("");
            let payload = after.trim_matches(|c: char| c == '"' || c == '\'' || c.is_whitespace());
            if payload.is_empty() {
                noise_lines += 1;
                continue;
            }
        }
        content_lines += 1;
    }

    let total = content_lines + noise_lines;
    if total == 0 {
        return false;
    }
    // Trigger when ≥60 % of lines are comments/empty — the shell command
    // is essentially a comment with a thin tool-call wrapper around it.
    noise_lines * 5 >= total * 3
}

/// Best-effort extraction of the `command` field from a JSON arguments blob
/// like `{"command":"python3 -c \"...\""}`. Returns None if we can't locate
/// it — callers then skip the thinking-in-shell check.
fn extract_command_field(arguments: &str) -> Option<String> {
    let key = "\"command\"";
    let idx = arguments.find(key)?;
    let after = &arguments[idx + key.len()..];
    let colon = after.find(':')?;
    let mut rest = after[colon + 1..].trim_start();
    if !rest.starts_with('"') {
        return None;
    }
    rest = &rest[1..]; // skip opening quote
    let mut out = String::with_capacity(rest.len());
    let mut chars = rest.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => break,
            }
        } else if c == '"' {
            // unescaped closing quote — end of the command value
            return Some(out);
        } else {
            out.push(c);
        }
    }
    // No closing quote found — return whatever we had; callers just use it
    // as a heuristic.
    Some(out)
}

impl Default for DoomLoopDetector {
    fn default() -> Self {
        Self {
            history: Vec::new(),
            thinking_shell_streak: 0,
            threshold: 20,
        }
    }
}

impl DoomLoopDetector {
    #[allow(dead_code)]
    pub fn new(threshold: usize) -> Self {
        Self {
            history: Vec::new(),
            thinking_shell_streak: 0,
            threshold,
        }
    }

    /// Record a tool call in the history.
    pub fn record(&mut self, tool_name: &str, arguments: &str) {
        // For the exact hash, normalise shell arguments so that bash
        // cosmetics (output redirects, exit-code echo wrappers,
        // `|| true`) don't disguise consecutive reruns of the same
        // failing test as distinct calls. The coarse signature still
        // uses the raw args so the long-prefix detector continues to
        // work for `python3 -c ...; print(1)/(2)/(3)` near-duplicates.
        let exact_input = if tool_name == "shell" {
            normalise_shell_arguments(arguments)
        } else {
            arguments.to_string()
        };
        let exact = hash_string(&exact_input);
        let coarse = coarse_signature(tool_name, arguments);
        self.history.push((tool_name.to_string(), exact, coarse));
        if is_thinking_in_shell(tool_name, arguments) {
            self.thinking_shell_streak += 1;
        } else {
            self.thinking_shell_streak = 0;
        }
        // Cap history to avoid unbounded growth.
        if self.history.len() > MAX_HISTORY {
            let excess = self.history.len() - MAX_HISTORY;
            self.history.drain(..excess);
        }
    }

    /// Check for any of the four failure modes. Returns Some(repetition_count)
    /// when a loop is detected; the caller treats that as a soft warning at
    /// first and hard abort once the count gets large (see orch.rs).
    pub fn check(&self) -> Option<usize> {
        // Fast path — thinking-in-shell streak.
        if self.thinking_shell_streak >= THINKING_SHELL_THRESHOLD {
            return Some(self.thinking_shell_streak);
        }

        if self.history.len() < self.threshold {
            return None;
        }

        // Exact-match detection — as before.
        for pattern_len in 1..=self.history.len() / self.threshold {
            let reps = self.count_trailing_repetitions_exact(pattern_len);
            if reps >= self.threshold {
                return Some(reps);
            }
        }

        // Near-identical detection — same coarse signature repeating 3+ times.
        // Only runs after exact-match detection to avoid double-counting;
        // pattern_len is fixed at 1 here (consecutive near-duplicates) since
        // longer coarse patterns tend to be noisy.
        let coarse_reps = self.count_trailing_repetitions_coarse();
        if coarse_reps >= self.threshold {
            return Some(coarse_reps);
        }

        None
    }

    /// True if the current alarm is a thinking-in-shell streak. Lets the
    /// orchestrator word the reminder more specifically.
    pub fn last_alarm_is_thinking_in_shell(&self) -> bool {
        self.thinking_shell_streak >= THINKING_SHELL_THRESHOLD
    }

    fn count_trailing_repetitions_exact(&self, pattern_len: usize) -> usize {
        let len = self.history.len();
        if pattern_len == 0 || len < pattern_len {
            return 0;
        }
        let pattern_start = len - pattern_len;
        let pattern: Vec<(String, u64)> = self.history[pattern_start..]
            .iter()
            .map(|(n, h, _)| (n.clone(), *h))
            .collect();

        let mut repetitions = 1;
        let mut pos = pattern_start;
        while pos >= pattern_len {
            pos -= pattern_len;
            let chunk: Vec<(String, u64)> = self.history[pos..pos + pattern_len]
                .iter()
                .map(|(n, h, _)| (n.clone(), *h))
                .collect();
            if chunk == pattern {
                repetitions += 1;
            } else {
                break;
            }
        }
        repetitions
    }

    fn count_trailing_repetitions_coarse(&self) -> usize {
        let len = self.history.len();
        if len == 0 {
            return 0;
        }
        let (last_name, _, last_coarse) = &self.history[len - 1];
        let mut reps = 1;
        for i in (0..len - 1).rev() {
            let (n, _, c) = &self.history[i];
            if n == last_name && c == last_coarse {
                reps += 1;
            } else {
                break;
            }
        }
        reps
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
        for _ in 0..20 {
            d.record("read", r#"{"path":"a.txt"}"#);
        }
        assert_eq!(d.check(), Some(20));
    }

    #[test]
    fn test_detect_pattern_abc_abc_abc() {
        let mut d = DoomLoopDetector::new(3);
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
        let mut d = DoomLoopDetector::new(3);
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
        let mut d = DoomLoopDetector::new(3); // threshold=3
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
        let mut d = DoomLoopDetector::new(3);
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
        let mut d = DoomLoopDetector::new(3);
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
        let mut d = DoomLoopDetector::new(3);
        d.record("read", r#"{"p":"a"}"#);
        d.record("read", r#"{"p":"a"}"#);
        d.record("write", r#"{"p":"b"}"#); // Break the pattern
        d.record("read", r#"{"p":"a"}"#);
        d.record("read", r#"{"p":"a"}"#);
        assert_eq!(d.check(), None); // Only 2 consecutive at end
    }

    #[test]
    fn test_same_tool_different_args_no_loop() {
        let mut d = DoomLoopDetector::new(3);
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
        let mut d = DoomLoopDetector::new(3);
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
        let mut d = DoomLoopDetector::new(3);
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
    fn test_coarse_detection_near_identical_shell_commands() {
        // Three shell commands sharing the same ~80-char prefix but with
        // different trailing content. The coarse signature is built from
        // the first 80 non-whitespace chars, so all three hash identically
        // — the detector should flag this as a near-duplicate loop even
        // though the exact hashes differ.
        let mut d = DoomLoopDetector::new(3);
        d.record(
            "shell",
            r##"{"command":"python3 -c import sys, os, pathlib; sys.path.insert(0, \"/tmp/abc\"); print(1)"}"##,
        );
        d.record(
            "shell",
            r##"{"command":"python3 -c import sys, os, pathlib; sys.path.insert(0, \"/tmp/abc\"); print(2)"}"##,
        );
        d.record(
            "shell",
            r##"{"command":"python3 -c import sys, os, pathlib; sys.path.insert(0, \"/tmp/abc\"); print(3)"}"##,
        );
        assert!(
            d.check().is_some(),
            "near-identical commands sharing a long prefix should trip the alarm",
        );
    }

    #[test]
    fn test_coarse_signature_does_not_flag_legit_variations() {
        // Legitimately different shell commands — different target files —
        // must NOT trigger the coarse detector.
        let mut d = DoomLoopDetector::new(3);
        d.record("shell", r##"{"command":"ls src/"}"##);
        d.record("shell", r##"{"command":"ls tests/"}"##);
        d.record("shell", r##"{"command":"cat Cargo.toml"}"##);
        assert_eq!(d.check(), None);
    }

    #[test]
    fn test_thinking_in_shell_detected() {
        let mut d = DoomLoopDetector::new(3);
        // Three consecutive comment-only python3 -c commands.
        d.record(
            "shell",
            r##"{"command":"python3 -c \"# look at the original pipeline.py\n# we need to understand structure\n# then plan the refactor\""}"##,
        );
        d.record(
            "shell",
            r##"{"command":"python3 -c \"# now let me think about encoding\n# the smart quotes are mojibake\n# should preserve them\""}"##,
        );
        d.record(
            "shell",
            r##"{"command":"python3 -c \"# check: is this valid UTF-8?\n# or latin-1?\n# need to decide\""}"##,
        );
        let c = d.check();
        assert!(
            c.is_some(),
            "3 consecutive comment-only shell commands must trip the alarm"
        );
        assert!(d.last_alarm_is_thinking_in_shell());
    }

    #[test]
    fn test_real_shell_action_resets_thinking_streak() {
        let mut d = DoomLoopDetector::new(3);
        d.record(
            "shell",
            r##"{"command":"python3 -c \"# thinking comment\""}"##,
        );
        d.record("shell", r##"{"command":"python3 -c \"# more thinking\""}"##);
        // A real action resets the thinking-in-shell streak.
        d.record("shell", r##"{"command":"python3 test_pipeline.py"}"##);
        d.record(
            "shell",
            r##"{"command":"python3 -c \"# back to thinking\""}"##,
        );
        // Streak should be 1 now (only the last one), not 3.
        assert_eq!(
            d.check(),
            None,
            "real action must reset the thinking-in-shell streak"
        );
        assert!(!d.last_alarm_is_thinking_in_shell());
    }

    #[test]
    fn test_regular_shell_commands_are_not_thinking() {
        assert!(!is_thinking_in_shell(
            "shell",
            r##"{"command":"python3 test.py"}"##
        ));
        assert!(!is_thinking_in_shell(
            "shell",
            r##"{"command":"cargo test --release"}"##
        ));
        assert!(!is_thinking_in_shell(
            "shell",
            r##"{"command":"go test ./..."}"##
        ));
        assert!(!is_thinking_in_shell(
            "shell",
            r##"{"command":"ls -la && cat foo.txt"}"##
        ));
    }

    #[test]
    fn test_extract_command_field_basic() {
        let args = r##"{"command":"echo hello","other":"ignored"}"##;
        assert_eq!(extract_command_field(args).as_deref(), Some("echo hello"));
    }

    #[test]
    fn test_extract_command_field_with_escaped_quotes() {
        let args = r##"{"command":"echo \"nested quote\""}"##;
        assert_eq!(
            extract_command_field(args).as_deref(),
            Some("echo \"nested quote\""),
        );
    }

    #[test]
    fn test_shell_redirect_variants_collapse_to_same_signature() {
        // Three reruns of the same failing test that differ only in
        // bash cosmetics must hash to the same coarse signature so the
        // doom detector flags the stall on the third call.
        let mut d = DoomLoopDetector::new(3);
        d.record("shell", r##"{"command":"python3 test_x.py"}"##);
        d.record("shell", r##"{"command":"python3 test_x.py 2>&1"}"##);
        d.record("shell", r##"{"command":"python3 test_x.py 2>&1 || true"}"##);
        assert!(
            d.check().is_some(),
            "shell reruns differing only in redirects/fallthroughs must trip the alarm",
        );
    }

    #[test]
    fn test_shell_exit_echo_wrapper_normalised() {
        // `; echo "EXIT: $?"` and `; echo "---EXIT: $?"` are model tics
        // for "see the exit code without re-reading the docs"; they
        // must not protect duplicate calls from the coarse detector.
        let mut d = DoomLoopDetector::new(3);
        d.record("shell", r##"{"command":"cargo build"}"##);
        d.record("shell", r##"{"command":"cargo build; echo \"EXIT: $?\""}"##);
        d.record(
            "shell",
            r##"{"command":"cargo build; echo \"---EXIT: $?\""}"##,
        );
        assert!(d.check().is_some());
    }

    #[test]
    fn test_shell_normalisation_does_not_collapse_distinct_commands() {
        // Different actual commands must still have different signatures.
        let mut d = DoomLoopDetector::new(3);
        d.record("shell", r##"{"command":"cargo build 2>&1"}"##);
        d.record("shell", r##"{"command":"cargo test 2>&1"}"##);
        d.record("shell", r##"{"command":"cargo check 2>&1"}"##);
        assert_eq!(
            d.check(),
            None,
            "redirect-stripping must not erase real command differences",
        );
    }

    #[test]
    fn test_normalise_shell_arguments_strips_redirects() {
        let n = normalise_shell_arguments(r##"{"command":"python3 test.py 2>&1"}"##);
        // Redirect dropped; command preserved.
        assert!(n.contains("python3 test.py"));
        assert!(!n.contains("2>&1"));
    }

    #[test]
    fn test_normalise_shell_arguments_strips_trailing_or_true() {
        let n = normalise_shell_arguments(r##"{"command":"npm test || true"}"##);
        assert!(n.contains("npm test"));
        assert!(!n.contains("|| true"));
    }

    #[test]
    fn test_normalise_shell_arguments_strips_chained_noise() {
        let n = normalise_shell_arguments(r##"{"command":"go test 2>&1 || true"}"##);
        assert!(n.contains("go test"));
        assert!(!n.contains("2>&1"));
        assert!(!n.contains("|| true"));
    }

    #[test]
    fn test_normalise_shell_arguments_passes_clean_command_through() {
        let n = normalise_shell_arguments(r##"{"command":"ls -la"}"##);
        assert_eq!(n, "ls -la");
    }

    #[test]
    fn test_detection_still_works_after_history_cap() {
        let mut d = DoomLoopDetector::new(3);
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
