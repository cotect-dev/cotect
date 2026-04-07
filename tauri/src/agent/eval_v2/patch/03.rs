//! Patch v2 — Test 03: Cross-file return type cascade
//!
//! A TypeScript-style codebase (Python with type hints simulating TS patterns)
//! where a core function's return type changes from `str` to `tuple[str, int]`.
//! This cascades through 3 files:
//!
//! 1. `formatter.py`: The `format_entry()` function must return
//!    `(formatted_string, char_count)` instead of just `formatted_string`
//! 2. `renderer.py`: All callers of `format_entry()` must destructure
//!    the tuple — but `render_header()` calls a DIFFERENT `format_header()`
//!    that should NOT change
//! 3. `exporter.py`: The CSV export builds rows from `format_entry()` results
//!    and must include the count as a new column — but the JSON export uses
//!    `format_header()` and must NOT change
//!
//! Red herrings:
//! - `format_header()` has an almost identical signature to `format_entry()`
//!   and lives in the same file — changing it breaks the header tests
//! - `renderer.py` has a `_cache` dict that stores formatted strings; the
//!   model might think caching needs to change but it doesn't (it's unused
//!   in the current flow)
//! - `exporter.py` has a `_format_metadata()` helper that also returns
//!   strings — it should not be changed

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let formatter_file = ap(dir, "formatter.py");
        std::fs::write(&formatter_file, r#""""Text formatting utilities for the report system."""


def format_entry(label: str, value: str, width: int = 30) -> str:
    """Format a label-value pair as a fixed-width line.

    Returns the formatted string.
    """
    padded_label = label.ljust(width - len(value) - 3)
    line = f"| {padded_label} {value} |"
    return line


def format_header(title: str, width: int = 30) -> str:
    """Format a section header.

    Returns the formatted header string. This function has a different
    purpose from format_entry and its signature must remain unchanged.
    """
    border = "+" + "-" * (width - 2) + "+"
    padded = title.center(width - 2)
    return f"{border}\n|{padded}|\n{border}"


def format_separator(width: int = 30) -> str:
    """Format a horizontal separator line."""
    return "+" + "-" * (width - 2) + "+"
"#).unwrap();

        let renderer_file = ap(dir, "renderer.py");
        std::fs::write(&renderer_file, r#""""Report renderer — assembles formatted parts into a report."""

from formatter import format_entry, format_header, format_separator


class ReportRenderer:
    """Renders a complete report from data entries."""

    def __init__(self, title: str, width: int = 30):
        self.title = title
        self.width = width
        self._cache = {}  # reserved for future caching

    def render(self, entries: list[tuple[str, str]]) -> str:
        """Render a full report with header, entries, and footer.

        Args:
            entries: list of (label, value) pairs

        Returns:
            Complete formatted report as a string.
        """
        parts = []
        parts.append(format_header(self.title, self.width))
        total_chars = 0
        for label, value in entries:
            line = format_entry(label, value, self.width)
            parts.append(line)
        parts.append(format_separator(self.width))
        return "\n".join(parts)

    def render_single(self, label: str, value: str) -> str:
        """Render a single formatted entry."""
        return format_entry(label, value, self.width)

    def render_header(self) -> str:
        """Render just the header section."""
        return format_header(self.title, self.width)
"#).unwrap();

        let exporter_file = ap(dir, "exporter.py");
        std::fs::write(&exporter_file, r#""""Export module — converts report data to various output formats."""

import json
from formatter import format_entry, format_header


def export_csv(entries: list[tuple[str, str]], width: int = 30) -> str:
    """Export entries as CSV with formatted values.

    Each row contains: label, value, formatted_line
    """
    rows = ["label,value,formatted"]
    for label, value in entries:
        formatted = format_entry(label, value, width)
        rows.append(f"{label},{value},{formatted}")
    return "\n".join(rows)


def export_json(title: str, entries: list[tuple[str, str]]) -> str:
    """Export as JSON with header and entries.

    Uses format_header for the title — this should NOT change.
    """
    header = format_header(title)
    data = {
        "header": header,
        "entries": [{"label": l, "value": v} for l, v in entries],
    }
    return json.dumps(data, indent=2)


def _format_metadata(version: str, author: str) -> str:
    """Internal helper to format export metadata.

    Returns a plain string — NOT related to format_entry.
    """
    return f"v{version} by {author}"
"#).unwrap();

        let test_file = ap(dir, "test_report.py");
        std::fs::write(&test_file, r#"from formatter import format_entry, format_header
from renderer import ReportRenderer
from exporter import export_csv, export_json

def test_format_entry_returns_tuple():
    """format_entry must return (str, int) — the line and its char count."""
    result = format_entry("Name", "Alice")
    assert isinstance(result, tuple), \
        f"format_entry should return a tuple, got {type(result).__name__}"
    assert len(result) == 2, \
        f"format_entry should return 2 elements, got {len(result)}"
    line, count = result
    assert isinstance(line, str), f"First element should be str, got {type(line)}"
    assert isinstance(count, int), f"Second element should be int, got {type(count)}"
    assert count == len(line), \
        f"Count should equal len(line)={len(line)}, got {count}"

def test_format_header_unchanged():
    """format_header must still return a plain string."""
    result = format_header("Report")
    assert isinstance(result, str), \
        f"format_header should return str, got {type(result).__name__}"
    assert "Report" in result

def test_renderer_uses_char_counts():
    """ReportRenderer.render must track total character count."""
    r = ReportRenderer("Test Report")
    entries = [("Name", "Alice"), ("Age", "30"), ("City", "NYC")]
    report = r.render(entries)
    assert isinstance(report, str), f"render should return str, got {type(report)}"
    assert "Name" in report
    assert "Alice" in report

def test_renderer_single_returns_tuple():
    """render_single should return the tuple from format_entry."""
    r = ReportRenderer("Test")
    result = r.render_single("Key", "Val")
    assert isinstance(result, tuple), \
        f"render_single should return tuple, got {type(result).__name__}"
    line, count = result
    assert "Key" in line and "Val" in line

def test_csv_export_has_count_column():
    """CSV export must include char_count as a fourth column."""
    entries = [("Item", "Widget"), ("Price", "$9.99")]
    csv = export_csv(entries)
    lines = csv.strip().split("\n")
    # Header line should have count column
    assert "count" in lines[0].lower() or "char" in lines[0].lower(), \
        f"CSV header should have count column: {lines[0]}"
    # Data lines should have 4 fields
    fields = lines[1].split(",")
    assert len(fields) >= 4, \
        f"CSV data row should have >= 4 fields, got {len(fields)}: {lines[1]}"

def test_json_export_unchanged():
    """JSON export uses format_header, should still work."""
    result = export_json("Sales", [("Revenue", "$1M")])
    assert isinstance(result, str)
    import json
    data = json.loads(result)
    assert "header" in data
    assert "entries" in data
    assert data["entries"][0]["label"] == "Revenue"

def test_render_header_still_works():
    """ReportRenderer.render_header must still return a string."""
    r = ReportRenderer("My Report")
    h = r.render_header()
    assert isinstance(h, str)
    assert "My Report" in h

if __name__ == "__main__":
    test_format_entry_returns_tuple()
    test_format_header_unchanged()
    test_renderer_uses_char_counts()
    test_renderer_single_returns_tuple()
    test_csv_export_has_count_column()
    test_json_export_unchanged()
    test_render_header_still_works()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(format!(
            "We need to change `format_entry()` in formatter.py to return a \
             tuple of (formatted_line, char_count) instead of just the string. \
             This change cascades through renderer.py and exporter.py — all \
             callers must be updated to handle the new return type.\n\n\
             IMPORTANT: `format_header()` must NOT change — it has a different \
             purpose and its callers depend on it returning a plain string.\n\n\
             Step 1: Read all source files and trace every call to `format_entry()`.\n\
             Step 2: Apply coordinated patches WITHOUT running the code first.\n\
             Step 3: Run `python3 test_report.py` to verify. If tests fail, \
             read the errors and iterate until all tests pass.",
        )),
            vec![
                complete(),
                succeeded("shell"),
                // Primary: test suite must pass — it verifies format_entry
                // returns a tuple, format_header still returns a string,
                // renderer handles char counts, CSV has a count column,
                // and JSON export is unchanged.
                run_has("python3 test_report.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![formatter_file, renderer_file, exporter_file]),
            vec![test_file])
    }
    v.push(scen!("v2_patch_03_return_type_cascade", Category::Patch, Difficulty::Hard, I, setup));
}
