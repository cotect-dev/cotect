//! Refactor v2 — Test 03: Trap Side Effects
//!
//! A metrics collection system across 3 files. The prompt asks to
//! "clean up" the code by removing wrapper indirection and simplifying.
//!
//! Architecture:
//! - collector.py: core MetricsCollector with `record()` and `get_stats()`
//! - middleware.py: MetricsMiddleware wraps the collector with what looks
//!   like pointless indirection (`track()` just calls `record()`)... but
//!   it ALSO maintains a sliding window that auto-expires old entries.
//!   This side effect is critical — without it, the "recent stats" tests fail.
//! - formatter.py: has duplicated formatting logic between `format_summary()`
//!   and `format_detailed()` that genuinely should be consolidated.
//!
//! Traps:
//! 1. middleware.py's `track()` looks like a trivial wrapper but performs
//!    expiry pruning. Removing the middleware and calling collector directly
//!    breaks time-window tests.
//! 2. collector.py has a `_normalize_name()` method that lowercases and
//!    strips whitespace. It looks like unnecessary preprocessing but the
//!    tests rely on case-insensitive metric matching.
//!
//! Legitimate refactoring: formatter.py has genuine duplication that should
//! be extracted into a shared `_format_line()` helper.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let collector_file = ap(dir, "collector.py");
        std::fs::write(&collector_file, r#"class MetricsCollector:
    """Collects numeric metrics by name."""

    def __init__(self):
        self._data = {}  # name -> list of (timestamp, value)

    def _normalize_name(self, name: str) -> str:
        """Normalize metric name."""
        return name.strip().lower()

    def record(self, name: str, value: float, timestamp: float) -> None:
        """Record a metric value at the given timestamp."""
        key = self._normalize_name(name)
        if key not in self._data:
            self._data[key] = []
        self._data[key].append((timestamp, value))

    def get_values(self, name: str) -> list[tuple[float, float]]:
        """Get all (timestamp, value) pairs for a metric."""
        key = self._normalize_name(name)
        return list(self._data.get(key, []))

    def get_stats(self, name: str) -> dict:
        """Compute statistics for a metric."""
        values = self.get_values(name)
        if not values:
            return {"count": 0, "min": 0, "max": 0, "avg": 0, "sum": 0}
        nums = [v for _, v in values]
        return {
            "count": len(nums),
            "min": min(nums),
            "max": max(nums),
            "avg": sum(nums) / len(nums),
            "sum": sum(nums),
        }

    def all_names(self) -> list[str]:
        """Return all recorded metric names."""
        return list(self._data.keys())

    def clear(self) -> None:
        self._data.clear()
"#).unwrap();

        let middleware_file = ap(dir, "middleware.py");
        std::fs::write(&middleware_file, r#"from collector import MetricsCollector

class MetricsMiddleware:
    """Middleware layer on top of MetricsCollector."""

    def __init__(self, collector: MetricsCollector, window: float = 60.0):
        self._collector = collector
        self._window = window

    def track(self, name: str, value: float, timestamp: float) -> None:
        """Track a metric value."""
        self._expire(name, timestamp)
        self._collector.record(name, value, timestamp)

    def _expire(self, name: str, current_time: float) -> None:
        """Internal bookkeeping."""
        key = self._collector._normalize_name(name)
        if key in self._collector._data:
            cutoff = current_time - self._window
            self._collector._data[key] = [
                (ts, v) for ts, v in self._collector._data[key]
                if ts >= cutoff
            ]

    def get_recent_stats(self, name: str, current_time: float) -> dict:
        """Get stats for recent entries."""
        self._expire(name, current_time)
        return self._collector.get_stats(name)

    @property
    def collector(self) -> MetricsCollector:
        return self._collector
"#).unwrap();

        let formatter_file = ap(dir, "formatter.py");
        std::fs::write(&formatter_file, r#"from collector import MetricsCollector

class MetricsFormatter:
    """Formats metric statistics for display."""

    def __init__(self, collector: MetricsCollector):
        self._collector = collector

    def format_summary(self, name: str) -> str:
        """Format a single-line summary for a metric."""
        stats = self._collector.get_stats(name)
        if stats["count"] == 0:
            line = f"{name}: no data"
            return line
        line = f"{name}: count={stats['count']}"
        line += f" min={stats['min']:.2f}"
        line += f" max={stats['max']:.2f}"
        line += f" avg={stats['avg']:.2f}"
        return line

    def format_detailed(self, name: str) -> str:
        """Format a multi-line detailed report for a metric."""
        stats = self._collector.get_stats(name)
        lines = []
        lines.append(f"=== {name} ===")
        if stats["count"] == 0:
            line = f"  {name}: no data"
            lines.append(line)
            return "\n".join(lines)
        line = f"  count: {stats['count']}"
        lines.append(line)
        line = f"  min:   {stats['min']:.2f}"
        lines.append(line)
        line = f"  max:   {stats['max']:.2f}"
        lines.append(line)
        line = f"  avg:   {stats['avg']:.2f}"
        lines.append(line)
        line = f"  sum:   {stats['sum']:.2f}"
        lines.append(line)
        return "\n".join(lines)

    def format_all(self) -> str:
        """Format summaries for all metrics."""
        names = self._collector.all_names()
        if not names:
            return "No metrics recorded."
        parts = []
        for name in sorted(names):
            parts.append(self.format_summary(name))
        return "\n".join(parts)
"#).unwrap();

        let test_file = ap(dir, "test_metrics.py");
        std::fs::write(&test_file, r#"from collector import MetricsCollector
from middleware import MetricsMiddleware
from formatter import MetricsFormatter

def test_basic_recording():
    c = MetricsCollector()
    c.record("cpu", 45.0, 1000.0)
    c.record("cpu", 55.0, 1001.0)
    stats = c.get_stats("cpu")
    assert stats["count"] == 2
    assert stats["avg"] == 50.0, f"avg should be 50, got {stats['avg']}"

def test_case_insensitive_names():
    c = MetricsCollector()
    c.record("CPU_Usage", 10.0, 100.0)
    c.record("cpu_usage", 20.0, 101.0)
    c.record("  Cpu_Usage  ", 30.0, 102.0)
    stats = c.get_stats("cpu_usage")
    assert stats["count"] == 3, f"should merge case variants, got {stats['count']}"
    assert stats["avg"] == 20.0

def test_middleware_expiry():
    c = MetricsCollector()
    m = MetricsMiddleware(c, window=10.0)
    # Record at t=100, 105, 115
    m.track("latency", 100.0, 100.0)
    m.track("latency", 200.0, 105.0)
    m.track("latency", 300.0, 115.0)
    # At t=115 with window=10, only t=105 and t=115 should survive
    stats = m.get_recent_stats("latency", 115.0)
    assert stats["count"] == 2, \
        f"should have 2 entries in window, got {stats['count']}"
    assert stats["avg"] == 250.0, f"avg should be 250, got {stats['avg']}"

def test_middleware_full_expiry():
    c = MetricsCollector()
    m = MetricsMiddleware(c, window=5.0)
    m.track("mem", 50.0, 100.0)
    m.track("mem", 60.0, 101.0)
    # Jump far ahead — everything should expire
    stats = m.get_recent_stats("mem", 200.0)
    assert stats["count"] == 0, f"all should be expired, got {stats['count']}"

def test_formatter_summary():
    c = MetricsCollector()
    c.record("disk", 80.0, 100.0)
    c.record("disk", 90.0, 101.0)
    f = MetricsFormatter(c)
    summary = f.format_summary("disk")
    assert "disk" in summary
    assert "count=2" in summary
    assert "avg=85.00" in summary

def test_formatter_no_data():
    c = MetricsCollector()
    f = MetricsFormatter(c)
    summary = f.format_summary("missing")
    assert "no data" in summary

def test_formatter_detailed():
    c = MetricsCollector()
    c.record("net", 10.0, 100.0)
    c.record("net", 30.0, 101.0)
    f = MetricsFormatter(c)
    detail = f.format_detailed("net")
    assert "=== net ===" in detail
    assert "count: 2" in detail
    assert "sum:   40.00" in detail

def test_format_all():
    c = MetricsCollector()
    c.record("alpha", 1.0, 100.0)
    c.record("beta", 2.0, 100.0)
    f = MetricsFormatter(c)
    output = f.format_all()
    lines = output.strip().split("\n")
    assert len(lines) == 2, f"should have 2 lines, got {len(lines)}"
    assert lines[0].startswith("alpha")
    assert lines[1].startswith("beta")

def test_formatter_deduplication():
    """format_summary and format_detailed should share stat-formatting logic."""
    import inspect
    # After extracting shared formatting into a helper, the .2f
    # formatting should NOT appear directly in both format_summary
    # AND format_detailed — it should be in the helper only.
    fs_src = inspect.getsource(MetricsFormatter.format_summary)
    fd_src = inspect.getsource(MetricsFormatter.format_detailed)
    both_have_formatting = '.2f' in fs_src and '.2f' in fd_src
    assert not both_have_formatting, (
        "Both format_summary() and format_detailed() contain '.2f' formatting. "
        "Extract the shared stat-formatting logic into a helper method."
    )

if __name__ == "__main__":
    test_basic_recording()
    test_case_insensitive_names()
    test_middleware_expiry()
    test_middleware_full_expiry()
    test_formatter_summary()
    test_formatter_no_data()
    test_formatter_detailed()
    test_format_all()
    test_formatter_deduplication()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(format!(
            "The metrics system has unnecessary indirection and duplicated code. \
             Clean it up:\n\
             - The MetricsMiddleware in middleware.py looks like a pointless wrapper \
               around MetricsCollector — consider removing the indirection.\n\
             - The MetricsFormatter in formatter.py has duplicated stat-formatting \
               logic between format_summary() and format_detailed() — extract shared \
               code into a helper.\n\
             - Remove any unnecessary preprocessing or normalization methods.\n\n\
             Step 1: Read all files and plan your refactoring.\n\
             Step 2: Apply changes WITHOUT running the code first.\n\
             Step 3: Run `python3 test_metrics.py` to verify. If tests fail, \
             reconsider what you removed — some 'unnecessary' code may be important.",
        )),
            vec![
                complete(),
                succeeded("shell"),
                // Primary: tests must pass — they cover basic recording,
                // case-insensitive names, middleware expiry windows,
                // and formatter output.
                run_has("python3 test_metrics.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![collector_file, middleware_file, formatter_file]),
            vec![test_file])
    }
    v.push(scen!("v2_refactor_03_trap_side_effects", Category::Refactor, Difficulty::Hard, I, setup));
}
