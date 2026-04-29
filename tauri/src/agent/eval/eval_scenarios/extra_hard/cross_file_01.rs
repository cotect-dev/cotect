//! Cross-file v2 — Test 01: Return type change cascading through a pipeline
//!
//! A data processing pipeline across 4 files where `fetch_records()` in
//! data_source.py returns a list of dicts. The task asks the model to change
//! it to return a `RecordSet` wrapper class (defined in models.py) that
//! includes metadata (total_count, fetched_at).
//!
//! `RecordSet` intentionally does NOT implement __iter__, __len__, or
//! __getitem__ — consumers must access the `.records` attribute directly.
//! This forces changes in every downstream file:
//! - transformer.py iterates over the result (must use .records)
//! - aggregator.py checks len() on the result (must use .records)
//! - reporter.py indexes with [0] (must use .records[0])
//!
//! The model must modify data_source.py AND all 3 consumer files.
//! Forgetting any one consumer causes a TypeError at runtime.
//!
//! Red herrings:
//! - data_source.py has a `_fetch_raw()` helper that also returns a list —
//!   this one should NOT be changed (it's internal plumbing)
//! - reporter.py has a `format_summary()` that takes a plain dict — this
//!   is unrelated and should NOT be changed

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let models_file = ap(dir, "models.py");
        std::fs::write(&models_file, r#"from datetime import datetime


class RecordSet:
    """A wrapper around a list of records with metadata.

    Access records via the `.records` attribute.
    This class does not behave like a list — consumers must
    explicitly use `.records` for iteration, indexing, etc.
    """

    def __init__(self, records: list[dict], fetched_at: datetime | None = None):
        self.records = records
        self.total_count = len(records)
        self.fetched_at = fetched_at or datetime.now()

    def __repr__(self):
        return f"RecordSet({self.total_count} records)"

    def __bool__(self):
        return self.total_count > 0
"#).unwrap();

        let source_file = ap(dir, "data_source.py");
        std::fs::write(&source_file, r#"from datetime import datetime


def _fetch_raw(query: str) -> list[dict]:
    """Internal helper — fetches raw rows from the data store.
    Returns a plain list of dicts. This is low-level plumbing
    and should always return a plain list."""
    if query == "users":
        return [
            {"id": 1, "name": "Alice", "score": 95},
            {"id": 2, "name": "Bob", "score": 82},
            {"id": 3, "name": "Carol", "score": 91},
        ]
    elif query == "empty":
        return []
    else:
        return [{"id": 0, "name": "Unknown", "score": 0}]


def fetch_records(query: str) -> list[dict]:
    """Fetch records for a given query.

    Returns a list of record dicts.
    """
    raw = _fetch_raw(query)
    return raw
"#).unwrap();

        let transformer_file = ap(dir, "transformer.py");
        std::fs::write(&transformer_file, r#"from data_source import fetch_records


def normalize_scores(query: str) -> list[dict]:
    """Fetch records and normalize scores to 0-1 range."""
    data = fetch_records(query)
    if not data:
        return []
    max_score = max(r["score"] for r in data)
    if max_score == 0:
        return list(data)
    result = []
    for record in data:
        normalized = dict(record)
        normalized["score"] = round(record["score"] / max_score, 4)
        result.append(normalized)
    return result


def enrich_records(query: str, extra_field: str, default_value: str) -> list[dict]:
    """Fetch records and add an extra field to each one."""
    data = fetch_records(query)
    result = []
    for record in data:
        enriched = dict(record)
        enriched[extra_field] = default_value
        result.append(enriched)
    return result
"#).unwrap();

        let aggregator_file = ap(dir, "aggregator.py");
        std::fs::write(&aggregator_file, r#"from data_source import fetch_records


def count_records(query: str) -> int:
    """Return the number of records for a query."""
    data = fetch_records(query)
    return len(data)


def average_score(query: str) -> float:
    """Return the average score across all records."""
    data = fetch_records(query)
    if len(data) == 0:
        return 0.0
    total = sum(r["score"] for r in data)
    return round(total / len(data), 2)


def top_scorer(query: str) -> dict | None:
    """Return the record with the highest score, or None if empty."""
    data = fetch_records(query)
    if not data:
        return None
    return max(data, key=lambda r: r["score"])
"#).unwrap();

        let reporter_file = ap(dir, "reporter.py");
        std::fs::write(&reporter_file, r#"from data_source import fetch_records


def format_summary(info: dict) -> str:
    """Format a plain dict as a summary line. Unrelated to record fetching."""
    return " | ".join(f"{k}={v}" for k, v in sorted(info.items()))


def first_record_name(query: str) -> str:
    """Return the name of the first record, or 'N/A' if empty."""
    data = fetch_records(query)
    if not data:
        return "N/A"
    return data[0]["name"]


def record_names(query: str) -> list[str]:
    """Return all record names as a list."""
    data = fetch_records(query)
    return [r["name"] for r in data]


def generate_report(query: str) -> str:
    """Generate a multi-line report of all records."""
    data = fetch_records(query)
    lines = []
    for i, record in enumerate(data):
        lines.append(f"{i+1}. {record['name']} (score: {record['score']})")
    if not lines:
        return "No records found."
    return "\n".join(lines)
"#).unwrap();

        let test_file = ap(dir, "test_pipeline.py");
        std::fs::write(&test_file, r#"from datetime import datetime
from models import RecordSet
from data_source import fetch_records, _fetch_raw
from transformer import normalize_scores, enrich_records
from aggregator import count_records, average_score, top_scorer
from reporter import first_record_name, record_names, generate_report, format_summary


def test_fetch_returns_recordset():
    result = fetch_records("users")
    assert isinstance(result, RecordSet), \
        f"fetch_records should return RecordSet, got {type(result).__name__}"
    assert result.total_count == 3, f"Expected 3 records, got {result.total_count}"
    assert isinstance(result.fetched_at, datetime), \
        f"fetched_at should be datetime, got {type(result.fetched_at)}"


def test_recordset_records_is_list():
    result = fetch_records("users")
    assert isinstance(result.records, list), \
        f"RecordSet.records should be a list, got {type(result.records)}"


def test_raw_fetch_still_returns_list():
    result = _fetch_raw("users")
    assert isinstance(result, list), \
        f"_fetch_raw should return list, got {type(result).__name__}"
    assert not isinstance(result, RecordSet), \
        "_fetch_raw should NOT return RecordSet"


def test_transformer_normalize():
    results = normalize_scores("users")
    assert isinstance(results, list), f"Expected list, got {type(results)}"
    assert len(results) == 3
    assert all(0 <= r["score"] <= 1 for r in results)


def test_transformer_enrich():
    results = enrich_records("users", "status", "active")
    assert len(results) == 3
    assert all(r["status"] == "active" for r in results)


def test_aggregator_count():
    assert count_records("users") == 3
    assert count_records("empty") == 0


def test_aggregator_average():
    avg = average_score("users")
    assert abs(avg - 89.33) < 0.01, f"Expected ~89.33, got {avg}"


def test_aggregator_top():
    top = top_scorer("users")
    assert top is not None
    assert top["name"] == "Alice"
    assert top_scorer("empty") is None


def test_reporter_first_name():
    assert first_record_name("users") == "Alice"
    assert first_record_name("empty") == "N/A"


def test_reporter_names():
    names = record_names("users")
    assert names == ["Alice", "Bob", "Carol"]


def test_reporter_generate():
    report = generate_report("users")
    assert "Alice" in report
    assert "Bob" in report
    assert "Carol" in report


def test_format_summary_unchanged():
    result = format_summary({"a": 1, "b": 2})
    assert "a=1" in result
    assert "b=2" in result


def test_empty_recordset():
    result = fetch_records("empty")
    assert isinstance(result, RecordSet)
    assert result.total_count == 0
    assert result.records == []


if __name__ == "__main__":
    test_fetch_returns_recordset()
    test_recordset_records_is_list()
    test_raw_fetch_still_returns_list()
    test_transformer_normalize()
    test_transformer_enrich()
    test_aggregator_count()
    test_aggregator_average()
    test_aggregator_top()
    test_reporter_first_name()
    test_reporter_names()
    test_reporter_generate()
    test_format_summary_unchanged()
    test_empty_recordset()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(
            "This project has a data pipeline. A `RecordSet` wrapper class already \
             exists in the codebase — find it and read its contract. The public \
             entrypoint that the rest of the pipeline uses to retrieve records \
             currently returns a plain list of dicts; change it so it returns a \
             `RecordSet` carrying that list plus metadata (total_count, \
             fetched_at). Every downstream caller must continue to work — \
             `RecordSet` does not behave like a list, so consumers have to be \
             adjusted.\n\n\
             Explore the repo yourself to find the callers. Do not change any \
             internal/private helper that is documented as returning a plain \
             list, and do not touch functions that are unrelated to record \
             fetching.\n\n\
             Apply all edits first, then run the bundled test suite \
             (`python3 test_pipeline.py`) and iterate until it prints \
             ALL_TESTS_PASSED.".to_string()),
            vec![
                complete(),
                succeeded("shell"),
                // Entry point now returns RecordSet wrapper
                file_has(&source_file, &["RecordSet"]),
                file_lacks(&source_file, &["def fetch_records(query: str) -> list[dict]"]),
                // Consumers now reach through .records
                file_has(&transformer_file, &[".records"]),
                file_has(&aggregator_file, &[".records"]),
                file_has(&reporter_file, &[".records"]),
                // Internal helper still returns a plain list (unchanged signature)
                file_has(&source_file, &["def _fetch_raw"]),
                // format_summary unrelated helper preserved
                file_has(&reporter_file, &["def format_summary"]),
                // The bundled end-to-end test must actually pass
                run_has("python3 test_pipeline.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![source_file, transformer_file, aggregator_file, reporter_file, models_file]),
            vec![test_file])
    }
    v.push(scen!("xhard_cross_file_01_return_type_cascade", Category::CrossFile, Difficulty::Hard, I, setup));
}
