//! File patcher with three addressing modes.
//!
//! All three forms do the same thing: replace a region of a file
//! with new content. The response is the post-edit file body in
//! exactly the same shape `read` returns — so a successful patch
//! gives the model the same content it would have re-read on its
//! own, without the extra round-trip.
//!
//! Three forms:
//!
//! 1. **Line range.** `start_line` + `end_line` (1-indexed inclusive)
//!    plus `new_string`. Cheapest to write — line numbers come
//!    straight from `read`'s `N: ` prefix.
//! 2. **Exact string match.** `old_string` (must appear exactly once
//!    in the file) + `new_string`. The classic shape — content is
//!    self-anchoring.
//! 3. **Elided string match.** `old_string` containing the literal
//!    `[...]` placeholder + `new_string`. The placeholder stands in
//!    for "everything between these anchors" — useful for replacing
//!    whole functions or blocks without copying the body.
//!
//! On any failure (out-of-range, not-found, ambiguous), the tool
//! returns the current file inline so the model can correct without
//! a separate `read`. A blind patch is allowed: an exact match
//! proves the model's mental model was accurate, and a miss returns
//! the file inline anyway — same information either way.

use std::fmt::Write as _;
use std::sync::Arc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::ToolState;
use super::fs_read::resolve_path;
use super::MAX_FILE_SIZE;
use crate::agent::utils::{io_err, line_has_number_prefix};

/// The literal placeholder the model uses inside `old_string` to mean
/// "match everything between these two anchors."
const ELISION: &str = "[...]";

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FSPatchInput {
    /// The absolute path to the file to patch.
    pub file_path: String,

    /// **Form A — line range.** First line of the range to replace
    /// (1-indexed, inclusive). Pair with `end_line`. Mutually
    /// exclusive with `old_string`.
    #[serde(default)]
    pub start_line: Option<u32>,
    /// **Form A — line range.** Last line of the range to replace
    /// (inclusive). Must be >= start_line. Pair with `start_line`.
    #[serde(default)]
    pub end_line: Option<u32>,

    /// **Form B/C — string match.** The text to find and replace.
    /// - Without `[...]`: exact match (must occur once in the file).
    /// - With `[...]`: anchored elision — the placeholder stands in
    ///   for "everything between these anchors", e.g.
    ///   `"def foo():\n[...]\n    return None"` matches the whole
    ///   function body. Mutually exclusive with `start_line`/`end_line`.
    #[serde(default)]
    pub old_string: Option<String>,

    /// The replacement text. Pass an empty string for a pure
    /// deletion of the addressed region.
    pub new_string: String,
}

pub async fn execute(input: &FSPatchInput, state: &Arc<ToolState>) -> Result<String, String> {
    let resolved = resolve_path(&input.file_path, &state.root_path);
    let path_owned = resolved.to_string_lossy().to_string();
    let path = path_owned.as_str();

    // Block patches to protected files (eval sandboxing).
    if state.blocked_files.iter().any(|b| resolved.ends_with(b) || &resolved == b) {
        return Err(format!("Access denied: {path} is a protected file"));
    }

    // File-size guard.
    let meta = tokio::fs::metadata(path)
        .await
        .map_err(|e| format!("Cannot access {path}: {e}"))?;
    if meta.len() > MAX_FILE_SIZE {
        return Err(format!("{path}: file too large to patch ({} bytes)", meta.len()));
    }

    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| io_err("read file", path, e))?;

    // For the string-match forms, trim outer whitespace from BOTH
    // `old_string` and `new_string`. The leading/trailing whitespace
    // around the anchor isn't part of the actual match — it's just for
    // the model's readability — and dropping it lets a 3-space
    // `   def get` anchor naturally hit a 4-space `    def get` line
    // (the file's existing indent stays put around the splice).
    // Trimming `new_string` symmetrically keeps the splice balanced.
    let trimmed_old = input.old_string.as_ref().map(|s| s.trim().to_string());
    let trimmed_new = input.new_string.trim().to_string();

    // Resolve which form the model used and compute the byte range
    // to replace. Errors include the file body so the model can fix
    // and retry without a separate `read`.
    let (start_byte, end_byte) = match resolve_addressing(input, trimmed_old.as_deref(), &content) {
        Ok(r) => r,
        Err(e) => {
            state.mark_read(path).await;
            return Err(format!(
                "{e}\n\nCurrent file contents (line-numbered for reference; \
                 the `N: ` prefix is NOT part of the file):\n\n{}",
                number_lines(&content),
            ));
        }
    };

    // Pick the replacement text. Line-range form keeps the model's
    // `new_string` as-is (the model is intentionally addressing whole
    // lines, including any leading/trailing whitespace they want).
    // String-match form uses the trimmed version so it splices cleanly
    // into whatever indentation the file already has at the anchor.
    let used_string_match = input.old_string.is_some();
    let mut new_string = if used_string_match {
        trimmed_new
    } else {
        input.new_string.clone()
    };
    // If the replaced region ended with a newline (line-aligned patch),
    // restore it when `new_string` doesn't end with one — otherwise the
    // next line would merge into the inserted content. Mid-line
    // substring matches don't end at a newline, so this rule correctly
    // does nothing for them.
    let region_ended_with_newline =
        end_byte > 0 && content.as_bytes().get(end_byte - 1) == Some(&b'\n');
    if region_ended_with_newline
        && !new_string.is_empty()
        && !new_string.ends_with('\n')
    {
        new_string.push('\n');
    }
    let mut new_content = String::with_capacity(content.len());
    new_content.push_str(&content[..start_byte]);
    new_content.push_str(&new_string);
    new_content.push_str(&content[end_byte..]);

    // Preserve original trailing-newline policy.
    if content.ends_with('\n') && !new_content.is_empty() && !new_content.ends_with('\n') {
        new_content.push('\n');
    }

    tokio::fs::write(path, &new_content)
        .await
        .map_err(|e| io_err("write file", path, e))?;
    state.mark_read(path).await;

    // Return the post-edit file body in exactly the shape `read`
    // returns. The model gets the same content it would have re-read
    // on its own — one round-trip instead of two.
    Ok(number_lines(&new_content))
}

/// Validate the input shape and resolve to a `(start_byte, end_byte)`
/// range in `content`. Uniform interface so the rest of `execute` is
/// agnostic to which form the model used. `trimmed_old` is the
/// outer-whitespace-stripped version of `input.old_string` used by the
/// string-match path — passed through so trimming policy stays in one
/// place (the caller).
fn resolve_addressing(
    input: &FSPatchInput,
    trimmed_old: Option<&str>,
    content: &str,
) -> Result<(usize, usize), String> {
    let has_line_range = input.start_line.is_some() || input.end_line.is_some();
    let has_string = input.old_string.is_some();

    match (has_line_range, has_string) {
        (true, true) => Err(
            "Pass either `start_line`+`end_line` (line-range form) OR `old_string` \
             (string-match form), not both."
                .into(),
        ),
        (false, false) => Err(
            "Provide either `start_line`+`end_line` or `old_string` to identify the region \
             to replace."
                .into(),
        ),
        (true, false) => resolve_line_range(input, content),
        (false, true) => resolve_string_match(trimmed_old.unwrap(), content),
    }
}

fn resolve_line_range(input: &FSPatchInput, content: &str) -> Result<(usize, usize), String> {
    let start = input
        .start_line
        .ok_or("Line-range form requires both `start_line` and `end_line`.")?;
    let end = input
        .end_line
        .ok_or("Line-range form requires both `start_line` and `end_line`.")?;

    let line_starts = compute_line_starts(content);
    let total = line_starts.len();
    let s = start as usize;
    let e = end as usize;

    if s < 1 || e < s || e > total {
        return Err(format!(
            "Line range {start}-{end} is invalid. File has {total} lines; valid range \
             is 1..={total}, and start_line must be <= end_line."
        ));
    }

    let start_byte = line_starts[s - 1];
    let end_byte = if e == total {
        content.len()
    } else {
        line_starts[e]
    };
    Ok((start_byte, end_byte))
}

fn resolve_string_match(old_string: &str, content: &str) -> Result<(usize, usize), String> {
    if old_string.is_empty() {
        return Err("`old_string` is empty — provide the text to find.".into());
    }
    if old_string == ELISION {
        return Err(
            "`old_string` is just `[...]` with no anchors — provide actual text before \
             and/or after the placeholder, e.g. \"def foo():\\n[...]\\n    return None\"."
                .into(),
        );
    }

    let prefix_hint = if line_has_number_prefix(old_string) {
        "\n\nHINT: `old_string` appears to start with a line-number prefix like \
         `12: ` — that prefix comes from `read`'s display format and is NOT part \
         of the file. Strip the `N: ` prefix."
    } else {
        ""
    };

    if !old_string.contains(ELISION) {
        // Exact-match path. Substring matching anywhere in the file —
        // including mid-line. This is intentionally permissive: when
        // a multi-line `old_string` has slightly-wrong leading
        // whitespace on its first line (a common model quirk —
        // tokenization can drop a leading space), the inner-content
        // bytes still uniquely anchor the region. The leftover prefix
        // bytes from the file fill in the missing whitespace, so the
        // splice produces correct output.
        let mut iter = content.match_indices(old_string);
        let first = iter.next();
        let pos = match first {
            Some((p, _)) => p,
            None => {
                return Err(format!(
                    "`old_string` not found in the file.{prefix_hint}"
                ));
            }
        };
        if iter.next().is_some() {
            let count = content.matches(old_string).count();
            return Err(format!(
                "`old_string` appears {count} times — patch needs exactly one match. \
                 Three ways to disambiguate:\n\
                 - Add surrounding context lines until the snippet is unique.\n\
                 - Use `[...]` elision to anchor on opening + closing lines, e.g. \
                 `\"def foo():\\n[...]\\n    return None\"`.\n\
                 - Address by line number using `start_line`/`end_line` instead of \
                 `old_string`.{prefix_hint}"
            ));
        }
        return Ok((pos, pos + old_string.len()));
    }

    // Elided-match path. Split on the placeholder; we support exactly
    // one `[...]` per old_string for now.
    let parts: Vec<&str> = old_string.split(ELISION).collect();
    if parts.len() > 2 {
        return Err(
            "`old_string` contains more than one `[...]` placeholder — only one is \
             supported per patch. Anchor on a single contiguous region, or split \
             into multiple `patch` calls."
                .into(),
        );
    }
    let prefix = parts[0];
    let suffix = parts[1];

    if prefix.is_empty() && suffix.is_empty() {
        return Err(
            "`old_string` is just `[...]` with no anchors — provide text before and/or \
             after the placeholder so the tool can locate the region."
                .into(),
        );
    }

    // Locate prefix anchor. Substring match — same intentional
    // permissiveness as the exact-match path so inner content (the
    // suffix anchor and the prefix's own body) does the real anchoring
    // and small leading-whitespace miscounts don't block the model.
    let prefix_start = if prefix.is_empty() {
        0
    } else {
        let mut iter = content.match_indices(prefix);
        let first = iter.next().ok_or_else(|| {
            format!(
                "Prefix anchor (text before `[...]`) not found in the file. The text was: \
                 {prefix:?}.{prefix_hint}"
            )
        })?;
        if iter.next().is_some() {
            let count = content.matches(prefix).count();
            return Err(format!(
                "Prefix anchor (text before `[...]`) appears {count} times — patch needs \
                 exactly one. Add more context to the prefix until it's unique."
            ));
        }
        first.0
    };
    let prefix_end = prefix_start + prefix.len();

    // Locate suffix anchor AFTER prefix.
    let region_end = if suffix.is_empty() {
        content.len()
    } else {
        let after = &content[prefix_end..];
        let mut iter = after.match_indices(suffix);
        let first = iter.next().ok_or_else(|| {
            format!(
                "Suffix anchor (text after `[...]`) not found in the file after the \
                 prefix. The text was: {suffix:?}.{prefix_hint}"
            )
        })?;
        if iter.next().is_some() {
            let count = after.matches(suffix).count();
            return Err(format!(
                "Suffix anchor appears {count} times after the prefix — patch needs \
                 exactly one. Add more context to the suffix."
            ));
        }
        prefix_end + first.0 + suffix.len()
    };

    Ok((prefix_start, region_end))
}

fn compute_line_starts(s: &str) -> Vec<usize> {
    if s.is_empty() {
        return Vec::new();
    }
    let mut starts = vec![0usize];
    for (i, b) in s.bytes().enumerate() {
        if b == b'\n' && i + 1 < s.len() {
            starts.push(i + 1);
        }
    }
    starts
}

/// Format `content` the same way `read` does: every line prefixed
/// with its 1-indexed line number and a colon. Used for both success
/// responses (the post-edit file) and error payloads (the current
/// file inline). The model sees one consistent shape.
pub(super) fn number_lines(content: &str) -> String {
    let mut out = String::with_capacity(content.len() + content.lines().count() * 6);
    for (i, line) in content.lines().enumerate() {
        let _ = writeln!(out, "{}: {line}", i + 1);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::tools::test_helpers::{make_state, make_temp_file, read_file};

    fn input_string(path: &str, old: &str, new: &str) -> FSPatchInput {
        FSPatchInput {
            file_path: path.into(),
            start_line: None,
            end_line: None,
            old_string: Some(old.into()),
            new_string: new.into(),
        }
    }

    fn input_lines(path: &str, start: u32, end: u32, new: &str) -> FSPatchInput {
        FSPatchInput {
            file_path: path.into(),
            start_line: Some(start),
            end_line: Some(end),
            old_string: None,
            new_string: new.into(),
        }
    }

    // ─── Form A: line range ────────────────────────────────────────

    #[tokio::test]
    async fn line_range_replaces_single_line() {
        let f = make_temp_file("alpha\nbeta\ngamma\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_lines(&path, 2, 2, "BETA");
        let response = execute(&input, &state).await.unwrap();

        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert_eq!(on_disk, "alpha\nBETA\ngamma\n");
        // Response is the post-edit file in `read`-shape — no "patched" header.
        assert!(response.contains("1: alpha"));
        assert!(response.contains("2: BETA"));
        assert!(response.contains("3: gamma"));
        assert!(!response.contains("Successfully patched"));
        assert!(!response.contains("Post-edit"));
    }

    #[tokio::test]
    async fn line_range_replaces_multiline_with_more() {
        let f = make_temp_file("a\nb\nc\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_lines(&path, 2, 2, "X\nY\nZ");
        execute(&input, &state).await.unwrap();

        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert_eq!(on_disk, "a\nX\nY\nZ\nc\n");
    }

    #[tokio::test]
    async fn line_range_pure_delete_with_empty_new_string() {
        let f = make_temp_file("a\nb\nc\nd\ne\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_lines(&path, 2, 4, "");
        execute(&input, &state).await.unwrap();

        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert_eq!(on_disk, "a\ne\n");
    }

    #[tokio::test]
    async fn line_range_out_of_bounds_returns_file_inline() {
        let f = make_temp_file("a\nb\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_lines(&path, 1, 99, "X");
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("invalid"));
        assert!(err.contains("1: a"));
        assert!(err.contains("2: b"));
    }

    #[tokio::test]
    async fn line_range_inverted_rejected() {
        let f = make_temp_file("a\nb\nc\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_lines(&path, 3, 1, "X");
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("start_line must be <= end_line"));
    }

    // ─── Form B: exact string match ───────────────────────────────

    #[tokio::test]
    async fn exact_string_match_replaces() {
        let f = make_temp_file("hello world\nfoo bar\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_string(&path, "foo bar", "baz qux");
        execute(&input, &state).await.unwrap();

        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert!(on_disk.contains("baz qux"));
        assert!(!on_disk.contains("foo bar"));
    }

    #[tokio::test]
    async fn exact_match_not_found_returns_file_inline() {
        let f = make_temp_file("alpha\nbeta\ngamma\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_string(&path, "nonexistent", "X");
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("not found"));
        assert!(err.contains("1: alpha"));
        assert!(err.contains("3: gamma"));
    }

    #[tokio::test]
    async fn exact_match_ambiguous_suggests_alternatives() {
        let f = make_temp_file("aaa\naaa\naaa\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_string(&path, "aaa", "X");
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("appears 3 times"));
        assert!(err.contains("[...]"));
        assert!(err.contains("start_line"));
        assert!(err.contains("1: aaa"));
    }

    #[tokio::test]
    async fn blind_exact_match_succeeds_without_prior_read() {
        let f = make_temp_file("hello\nworld\n");
        let state = make_state();
        let path: String = f.path().to_str().unwrap().into();

        let input = input_string(&path, "world", "WORLD");
        let result = execute(&input, &state).await.unwrap();
        // Response is the post-edit body.
        assert!(result.contains("1: hello"));
        assert!(result.contains("2: WORLD"));
        assert!(state.has_read(&path).await);
    }

    #[tokio::test]
    async fn outer_whitespace_around_anchor_is_ignored() {
        // The model wrote 3-space leading indent on `def get` against
        // a 4-space file (a recurring tokenization quirk). With the
        // outer-whitespace-ignored rule, the trim of `old_string`
        // strips those 3 leading spaces and matches `def get(...)`
        // directly. The file's existing 4-space indent stays intact
        // around the splice.
        let f = make_temp_file("class C:\n    def get(self):\n        return 1\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let bad_old = "   def get(self):\n        return 1";
        let bad_new = "   def get(self):\n        return 42";
        let input = input_string(&path, bad_old, bad_new);
        execute(&input, &state).await.unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "class C:\n    def get(self):\n        return 42\n",
        );
    }

    #[tokio::test]
    async fn outer_whitespace_works_even_when_anchor_has_trailing_newline() {
        // Trailing newlines/spaces in `old_string` are also ignored.
        let f = make_temp_file("alpha\n    body\nfooter\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        // Trailing newline + extra spaces — should be trimmed away.
        let input = input_string(&path, "    body\n  ", "    BODY");
        execute(&input, &state).await.unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "alpha\n    BODY\nfooter\n",
        );
    }

    #[tokio::test]
    async fn wrong_inner_whitespace_fails_to_match() {
        // Outer whitespace is ignored, but INNER whitespace still
        // anchors. If the model gets the body indent wrong (7 spaces
        // instead of 8), the substring genuinely isn't in the file
        // and patch errors cleanly with the file inline.
        let f = make_temp_file("class C:\n    def get(self):\n        return 1\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let bad_old = "   def get(self):\n       return 1"; // 7-space body
        let input = input_string(&path, bad_old, "X");
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("not found"), "got: {err}");
    }

    #[tokio::test]
    async fn single_line_substring_match_works_mid_line() {
        // Single-line patches still work for in-word renames.
        let f = make_temp_file("let x = foo + bar;\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_string(&path, "foo", "FOO");
        execute(&input, &state).await.unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "let x = FOO + bar;\n",
        );
    }

    #[tokio::test]
    async fn line_number_prefix_in_old_string_emits_hint() {
        let f = make_temp_file("hello\nworld\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_string(&path, "1: hello", "1: HELLO");
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("not found"));
        assert!(err.contains("line-number prefix"));
    }

    // ─── Form C: elided string match ──────────────────────────────

    #[tokio::test]
    async fn elision_matches_function_body() {
        let f = make_temp_file(
            "import os\n\
             \n\
             def func():\n    \
             x = 1\n    \
             y = 2\n    \
             return None\n\
             \n\
             def other():\n    \
             pass\n",
        );
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_string(
            &path,
            "def func():\n[...]\n    return None",
            "def func():\n    return 42",
        );
        execute(&input, &state).await.unwrap();
        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert!(on_disk.contains("def func():\n    return 42"));
        assert!(!on_disk.contains("    x = 1"));
        assert!(on_disk.contains("def other():\n    pass"));
    }

    #[tokio::test]
    async fn elision_with_empty_prefix_anchors_at_start() {
        let f = make_temp_file("header\nbody\nfooter\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_string(&path, "[...]\nbody", "NEW HEADER\nNEW BODY");
        execute(&input, &state).await.unwrap();
        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert_eq!(on_disk, "NEW HEADER\nNEW BODY\nfooter\n");
    }

    #[tokio::test]
    async fn elision_with_empty_suffix_anchors_through_eof() {
        let f = make_temp_file("header\nbody\nfooter\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_string(&path, "body\n[...]", "NEW BODY\nNEW FOOTER\n");
        execute(&input, &state).await.unwrap();
        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert_eq!(on_disk, "header\nNEW BODY\nNEW FOOTER\n");
    }

    #[tokio::test]
    async fn elision_prefix_not_found_returns_file_inline() {
        let f = make_temp_file("alpha\nbeta\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_string(&path, "no_such_prefix\n[...]\nbeta", "X");
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("Prefix anchor"));
        assert!(err.contains("not found"));
        assert!(err.contains("1: alpha"));
    }

    #[tokio::test]
    async fn elision_suffix_not_found_after_prefix() {
        let f = make_temp_file("alpha\nbeta\ngamma\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_string(&path, "beta\n[...]\nno_such_suffix", "X");
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("Suffix anchor"));
        assert!(err.contains("not found"));
    }

    #[tokio::test]
    async fn elision_prefix_ambiguous() {
        let f = make_temp_file("repeated\nrepeated\nrepeated\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_string(&path, "repeated\n[...]\nrepeated", "X");
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("Prefix anchor"));
        assert!(err.contains("appears"));
    }

    #[tokio::test]
    async fn elision_just_placeholder_rejected() {
        let f = make_temp_file("anything\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_string(&path, "[...]", "X");
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("just `[...]`"));
    }

    #[tokio::test]
    async fn elision_multiple_placeholders_rejected() {
        let f = make_temp_file("a\nb\nc\nd\ne\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_string(&path, "a\n[...]\nc\n[...]\ne", "X");
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("more than one"));
    }

    // ─── Form validation ──────────────────────────────────────────

    #[tokio::test]
    async fn rejects_both_forms_set() {
        let f = make_temp_file("a\nb\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = FSPatchInput {
            file_path: path,
            start_line: Some(1),
            end_line: Some(1),
            old_string: Some("a".into()),
            new_string: "X".into(),
        };
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("not both"));
    }

    #[tokio::test]
    async fn rejects_neither_form_set() {
        let f = make_temp_file("a\nb\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = FSPatchInput {
            file_path: path,
            start_line: None,
            end_line: None,
            old_string: None,
            new_string: "X".into(),
        };
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("Provide either"));
    }

    #[tokio::test]
    async fn line_range_requires_both_start_and_end() {
        let f = make_temp_file("a\nb\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = FSPatchInput {
            file_path: path,
            start_line: Some(1),
            end_line: None,
            old_string: None,
            new_string: "X".into(),
        };
        let err = execute(&input, &state).await.unwrap_err();
        assert!(err.contains("requires both"));
    }

    // ─── Trailing-newline policy ──────────────────────────────────

    #[tokio::test]
    async fn preserves_trailing_newline() {
        let f = make_temp_file("a\nb\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_lines(&path, 2, 2, "B");
        execute(&input, &state).await.unwrap();

        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert!(on_disk.ends_with('\n'));
    }

    #[tokio::test]
    async fn preserves_no_trailing_newline() {
        let f = make_temp_file("a\nb");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_string(&path, "b", "BB");
        execute(&input, &state).await.unwrap();

        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert_eq!(on_disk, "a\nBB");
    }

    // ─── Response shape ───────────────────────────────────────────

    #[tokio::test]
    async fn response_is_full_post_edit_file_in_read_shape() {
        // The whole point of dropping return_mode: a successful patch
        // returns the post-edit file body in exactly the shape `read`
        // would return it, no headers, no banners, no commentary.
        // The model gets the same content it would have re-read on
        // its own — one round-trip instead of two.
        let f = make_temp_file("alpha\nbeta\ngamma\n");
        let state = make_state();
        let path = f.path().to_str().unwrap().to_string();
        read_file(&state, &path).await;

        let input = input_lines(&path, 2, 2, "BETA");
        let response = execute(&input, &state).await.unwrap();

        assert_eq!(response, "1: alpha\n2: BETA\n3: gamma\n");
    }
}
