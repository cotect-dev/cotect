use std::fmt::Display;

/// Truncate a string at a char boundary, appending "..." if truncated.
/// Safe for all UTF-8 strings.
pub fn truncate_chars(s: &str, max_chars: usize) -> String {
    let truncated: String = s.chars().take(max_chars).collect();
    if truncated.len() == s.len() {
        truncated
    } else {
        format!("{truncated}...")
    }
}

/// Truncate a string at a safe UTF-8 byte boundary, appending a label if truncated.
/// Finds the largest valid char boundary <= `max_bytes`.
pub fn truncate_bytes(s: &str, max_bytes: usize, label: &str) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    // Find the largest valid UTF-8 char boundary at or before max_bytes
    let boundary = s.floor_char_boundary(max_bytes);
    format!("{}\n\n[{label}]", &s[..boundary])
}

/// Format a filesystem I/O error consistently.
pub fn io_err(verb: &str, path: &str, e: impl Display) -> String {
    format!("Cannot {verb} '{path}': {e}")
}

/// Returns true if `line` looks like it starts with a `N: ` line-number prefix
/// from the `read` tool (e.g. `1: foo`, `  12: bar`). Detection is conservative:
/// it only fires when the very first non-whitespace characters are digits followed by `: `.
pub fn line_has_number_prefix(line: &str) -> bool {
    let trimmed = line.trim_start();
    let mut chars = trimmed.chars();
    let mut saw_digit = false;
    while let Some(c) = chars.next() {
        if c.is_ascii_digit() {
            saw_digit = true;
            continue;
        }
        if saw_digit && c == ':' {
            return chars.next() == Some(' ');
        }
        return false;
    }
    false
}

/// Format the "must read before edit" error.
pub fn read_first_err(path: &str, verb: &str) -> String {
    format!("You must read '{path}' before {verb} it. Use the read tool first.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truncate_chars_short() {
        assert_eq!(truncate_chars("hello", 10), "hello");
    }

    #[test]
    fn test_truncate_chars_exact() {
        assert_eq!(truncate_chars("hello", 5), "hello");
    }

    #[test]
    fn test_truncate_chars_long() {
        assert_eq!(truncate_chars("hello world", 5), "hello...");
    }

    #[test]
    fn test_truncate_chars_empty() {
        assert_eq!(truncate_chars("", 5), "");
    }

    #[test]
    fn test_truncate_chars_multibyte() {
        // Japanese chars are 3 bytes each; truncating at 2 chars should be safe
        let s = "日本語テスト";
        let result = truncate_chars(s, 2);
        assert_eq!(result, "日本...");
    }

    #[test]
    fn test_truncate_bytes_short() {
        assert_eq!(truncate_bytes("hello", 100, "truncated"), "hello");
    }

    #[test]
    fn test_truncate_bytes_long() {
        let result = truncate_bytes("hello world", 5, "Output truncated");
        assert!(result.starts_with("hello"));
        assert!(result.contains("[Output truncated]"));
    }

    #[test]
    fn test_truncate_bytes_multibyte_safety() {
        // "日" is 3 bytes; setting max_bytes=4 should slice at byte 3 (one char), not panic
        let s = "日本";
        let result = truncate_bytes(s, 4, "truncated");
        assert!(result.starts_with("日"));
        assert!(result.contains("[truncated]"));
    }
}
