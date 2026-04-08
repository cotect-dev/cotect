//! Testing v2 — Scenario 01: String utilities
//!
//! Single-file Python module with three string functions. The model must
//! write a test file that exercises them according to their docstrings.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let src_file = ap(dir, "strutil.py");
        std::fs::write(&src_file, r#"class StringUtil:
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
"#).unwrap();

        let fixed_file = ap(dir, "strutil_fixed.py");
        std::fs::write(&fixed_file, r#"class StringUtil:
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
            return text[:max_len - len(suffix)] + suffix
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
                current = word
            elif len(current) + 1 + len(word) <= width:
                current += " " + word
            else:
                lines.append(current)
                current = word
        if current:
            lines.append(current)
        return lines
"#).unwrap();

        let runner = ap(dir, "run_tests.py");
        std::fs::write(&runner, r#"import subprocess, sys, os, shutil

test_file = None
for f in sorted(os.listdir(".")):
    if f.startswith("test_") and f.endswith(".py") and f != "run_tests.py":
        test_file = f
        break

if test_file is None:
    print("NO_TEST_FILE_FOUND")
    sys.exit(1)

def run_against(label, module_file):
    backup = None
    if os.path.exists("strutil.py"):
        backup = open("strutil.py").read()
    shutil.copy(module_file, "strutil.py")
    shutil.rmtree('__pycache__', ignore_errors=True)
    result = subprocess.run(
        [sys.executable, '-B', test_file],
        capture_output=True, text=True, timeout=30
    )
    if backup is not None:
        with open("strutil.py", "w") as f:
            f.write(backup)
    return result

buggy_result = run_against("BUGGY", "strutil_buggy.py")
buggy_failed = buggy_result.returncode != 0 or "ALL_TESTS_PASSED" not in buggy_result.stdout

fixed_result = run_against("FIXED", "strutil_fixed.py")
fixed_passed = fixed_result.returncode == 0 and "ALL_TESTS_PASSED" in fixed_result.stdout

if buggy_failed and fixed_passed:
    print("ALL_TESTS_PASSED")
elif not buggy_failed:
    print(f"FAIL: tests did not catch any bugs in buggy code")
    print(f"stdout: {buggy_result.stdout[-500:]}")
else:
    print(f"FAIL: tests fail on corrected code too")
    print(f"stdout: {fixed_result.stdout[-500:]}")
    print(f"stderr: {fixed_result.stderr[-500:]}")
"#).unwrap();

        let buggy_copy = ap(dir, "strutil_buggy.py");
        std::fs::write(&buggy_copy, std::fs::read_to_string(&src_file).unwrap()).unwrap();

        with_blocked(with_scope(with_checks(pf(format!(
            "The string utility module {} may have bugs. Your task is to write a \
             comprehensive test file `test_strutil.py` that tests all three \
             methods according to their docstrings. Your tests should catch \
             any behavior that doesn't match the documented specification.\n\n\
             Step 1: Read the source code and its docstrings carefully.\n\
             Step 2: Write `test_strutil.py` with thorough tests for every method. \
             Use `from strutil import StringUtil` and print \"ALL_TESTS_PASSED\" \
             at the end if all assertions pass.\n\
             Step 3: Run `python3 test_strutil.py` to see which tests catch bugs.",
            src_file)),
            vec![
                complete(),
                succeeded("shell"),
                run_has("python3 run_tests.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![src_file.clone(), ap(dir, "test_strutil.py")]),
            vec![fixed_file, runner, buggy_copy])
    }
    v.push(scen!("xhard_testing_01_string_util", Category::Testing, Difficulty::Hard, I, setup));
}
