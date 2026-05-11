//! Testing v2 — Scenario 01: String utilities
//!
//! Single-file Python module with three string functions. The model must
//! write a test file that exercises them according to their docstrings.

use std::path::Path;

use super::*;
use crate::agent::types::AgentRole::Implement as I;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let src_file = ap(dir, "strutil.py");
        std::fs::write(
            &src_file,
            r#"class StringUtil:
    """Utility class for common string operations."""

    @staticmethod
    def truncate(text: str, max_len: int, suffix: str = "...") -> str:
        """Truncate text to at most max_len characters total.

        If the text is longer than max_len, cut it and append suffix
        so the total length is exactly max_len.
        If the text is max_len or shorter, return it unchanged.

        Examples:
            truncate("hello world", 8) => "hello..."
            truncate("hello world", 8, "~") => "hello w~"
            truncate("hi", 10) => "hi"
        """
        if len(text) > max_len:
            return text[:max_len] + suffix
        return text

    @staticmethod
    def pad_center(text: str, width: int, fill: str = " ") -> str:
        """Center text within a field of given width.

        If text is shorter than width, pad both sides with fill character.
        Left side gets the extra character if padding is odd.
        If text is already >= width, return it unchanged.
        """
        if len(text) >= width:
            return text
        total_pad = width - len(text)
        left = (total_pad + 1) // 2
        right = total_pad // 2
        return fill * left + text + fill * right

    @staticmethod
    def wrap_lines(text: str, width: int) -> list[str]:
        """Wrap text into lines of at most `width` characters.

        Splits on spaces. Words that fit within width are joined.
        Words longer than width should appear on their own line (unbroken).
        Preserves word order. Never produces empty lines.

        Examples:
            wrap_lines("aa bb cc", 5) => ["aa bb", "cc"]
            wrap_lines("short verylongword end", 5) => ["short", "verylongword", "end"]
        """
        words = text.split()
        lines = []
        current = ""
        for word in words:
            if not current:
                if len(word) <= width:
                    current = word
            elif len(current) + 1 + len(word) <= width:
                current += " " + word
            else:
                lines.append(current)
                current = word if len(word) <= width else ""
        if current:
            lines.append(current)
        return lines
"#,
        )
        .unwrap();

        let fixed_file = ap(dir, "strutil_fixed.py");
        std::fs::write(
            &fixed_file,
            r#"class StringUtil:
    """Utility class for common string operations."""

    @staticmethod
    def truncate(text: str, max_len: int, suffix: str = "...") -> str:
        """Truncate text to at most max_len characters total.

        If the text is longer than max_len, cut it and append suffix
        so the total length is exactly max_len.
        If the text is max_len or shorter, return it unchanged.

        Examples:
            truncate("hello world", 8) => "hello..."
            truncate("hello world", 8, "~") => "hello w~"
            truncate("hi", 10) => "hi"
        """
        if len(text) <= max_len:
            return text
        cut = max_len - len(suffix)
        if cut <= 0:
            return suffix[:max_len]
        return text[:cut] + suffix

    @staticmethod
    def pad_center(text: str, width: int, fill: str = " ") -> str:
        """Center text within a field of given width.

        If text is shorter than width, pad both sides with fill character.
        Left side gets the extra character if padding is odd.
        If text is already >= width, return it unchanged.
        """
        if len(text) >= width:
            return text
        total_pad = width - len(text)
        left = (total_pad + 1) // 2
        right = total_pad // 2
        return fill * left + text + fill * right

    @staticmethod
    def wrap_lines(text: str, width: int) -> list[str]:
        """Wrap text into lines of at most `width` characters.

        Splits on spaces. Words that fit within width are joined.
        Words longer than width should appear on their own line (unbroken).
        Preserves word order. Never produces empty lines.

        Examples:
            wrap_lines("aa bb cc", 5) => ["aa bb", "cc"]
            wrap_lines("short verylongword end", 5) => ["short", "verylongword", "end"]
        """
        words = text.split()
        lines = []
        current = ""
        for word in words:
            if not current:
                current = word
            elif len(current) + 1 + len(word) <= width:
                current += " " + word
            else:
                lines.append(current)
                current = word
        if current:
            lines.append(current)
        return lines
"#,
        )
        .unwrap();

        let runner = ap(dir, "run_tests.py");
        std::fs::write(
            &runner,
            r#"import subprocess, sys, os, shutil

test_file = None
for f in sorted(os.listdir(".")):
    if f.startswith("test_") and f.endswith(".py") and f != "run_tests.py":
        test_file = f
        break

if test_file is None:
    print("NO_TEST_FILE_FOUND")
    sys.exit(1)

def _invoke(cmd, timeout_msg):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired as e:
        class R: pass
        r = R()
        r.returncode = 124
        r.stdout = (e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or ""))
        r.stderr = timeout_msg
        return r

def run_against(label, module_file):
    backup = None
    if os.path.exists("strutil.py"):
        backup = open("strutil.py").read()
    shutil.copy(module_file, "strutil.py")
    shutil.rmtree('__pycache__', ignore_errors=True)
    timeout_msg = f"TIMEOUT after 30s (tests hung on {label} impl)"
    # Prefer pytest (handles unittest.TestCase + bare test_ funcs); fall back
    # to direct execution if pytest collected nothing (script-style tests).
    result = _invoke(
        [sys.executable, '-B', '-m', 'pytest', test_file, '-x', '--tb=short', '-q'],
        timeout_msg,
    )
    if result.returncode == 5:
        result = _invoke([sys.executable, '-B', test_file], timeout_msg)
    if backup is not None:
        with open("strutil.py", "w") as f:
            f.write(backup)
    return result

buggy_result = run_against("BUGGY", "strutil_buggy.py")
buggy_failed = buggy_result.returncode != 0

fixed_result = run_against("FIXED", "strutil_fixed.py")
fixed_passed = fixed_result.returncode == 0

if buggy_failed and fixed_passed:
    print("ALL_TESTS_PASSED")
elif not buggy_failed:
    print(f"FAIL: tests did not catch any bugs in buggy code")
    print(f"stdout: {buggy_result.stdout[-500:]}")
else:
    print(f"FAIL: tests fail on corrected code too")
    print(f"stdout: {fixed_result.stdout[-500:]}")
    print(f"stderr: {fixed_result.stderr[-500:]}")
"#,
        )
        .unwrap();

        let buggy_copy = ap(dir, "strutil_buggy.py");
        std::fs::write(&buggy_copy, std::fs::read_to_string(&src_file).unwrap()).unwrap();

        with_blocked(
            with_scope(
                with_checks(
                    pf(format!(
                        "The string utility module at {} is suspected to contain defects \
             where the implementation diverges from its documented contract. \
             Write a test suite that would catch any such divergence — \
             a correct implementation must pass every assertion, and any \
             deviation from the specified behaviour must cause at least one \
             failure.\n\n\
             Deliverable: a Python test script whose filename matches \
             `test_*.py`. The current source in this directory is suspected \
             to be buggy — running your test script directly against it is \
             expected to fail; that is the point, not a problem to paper \
             over by weakening assertions. To validate end-to-end, run \
             `python3 run_tests.py`: it prints exactly `ALL_TESTS_PASSED` \
             once your tests both catch the defects and still pass on a \
             faithful implementation. Stop as soon as you see that \
             sentinel — don't keep iterating. You may choose any testing \
             approach (plain asserts, unittest, pytest, custom harness) \
             as long as this contract is honoured.",
                        src_file
                    )),
                    vec![
                        complete(),
                        succeeded("shell"),
                        run_has("python3 run_tests.py", &["ALL_TESTS_PASSED"]),
                    ],
                ),
                vec![src_file.clone()],
            ),
            vec![fixed_file, runner, buggy_copy],
        )
    }
    v.push(scen!(
        "xhard_testing_01_string_util",
        Category::Testing,
        Difficulty::Hard,
        I,
        setup
    ));
}
