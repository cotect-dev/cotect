//! Refactor v2 — Test 05: God Class Decomposition
//!
//! A monolithic `DataPipeline` class that does loading, transformation,
//! validation, and export all in one 200+ line class. The prompt asks
//! to decompose it into separate responsibility classes.
//!
//! Architecture:
//! - pipeline.py: the god class with everything
//! - test_pipeline.py: comprehensive tests
//!
//! The model must split it into:
//! - loader.py (or keep in pipeline.py): data loading
//! - transformer.py (or keep in pipeline.py): data transformation
//! - A refactored pipeline.py that orchestrates
//!
//! Traps:
//! 1. `_fix_encoding()` looks like a no-op helper (it replaces common
//!    mojibake sequences). It's called inside `load()` and seems like
//!    it could be removed. But the test data contains mojibake that
//!    must be cleaned.
//!
//! 2. The `_registry` class variable and `register_transform()` class
//!    method look like over-engineering / dead code. But the test
//!    registers a custom transform and expects it to work through the
//!    pipeline. Removing the registry breaks the test.
//!
//! 3. `_CHUNK_SIZE = 100` looks like premature optimization for
//!    chunked processing. But `process()` uses it to batch records,
//!    and the test verifies chunked processing behavior (partial
//!    results on error).
//!
//! Legitimate refactoring: the class genuinely does too many things.
//! The loading, transforming, and exporting logic should be separated.
//! But the tricky parts must be preserved wherever they land.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let pipeline_file = ap(dir, "pipeline.py");
        std::fs::write(&pipeline_file, r#"import csv
import json
import io

class DataPipeline:
    """Data processing pipeline."""

    _CHUNK_SIZE = 100
    _registry = {}

    @classmethod
    def register_transform(cls, name: str, func):
        """Register a named transform function."""
        cls._registry[name] = func

    def __init__(self, strict: bool = False):
        self._data = []
        self._errors = []
        self._strict = strict
        self._transforms = []

    def _fix_encoding(self, text: str) -> str:
        """Clean up text encoding issues."""
        replacements = {
            "Ã©": "e",
            "Ã¨": "e",
            "Ã¼": "u",
            "Ã¶": "o",
            "Ã¤": "a",
            "Ã±": "n",
            "â€™": "'",
            "â€œ": '"',
            "â€\x9d": '"',
        }
        for bad, good in replacements.items():
            text = text.replace(bad, good)
        return text

    def load_csv(self, csv_text: str) -> int:
        """Load records from a CSV string. Returns count of loaded records."""
        self._data = []
        self._errors = []
        reader = csv.DictReader(io.StringIO(csv_text))
        count = 0
        for row in reader:
            cleaned = {}
            for key, value in row.items():
                cleaned[key.strip()] = self._fix_encoding(value.strip())
            self._data.append(cleaned)
            count += 1
        return count

    def load_json(self, json_text: str) -> int:
        """Load records from a JSON string (expects a list of dicts)."""
        self._data = []
        self._errors = []
        records = json.loads(json_text)
        if not isinstance(records, list):
            raise ValueError("JSON must be a list of records")
        for record in records:
            cleaned = {}
            for key, value in record.items():
                if isinstance(value, str):
                    cleaned[key] = self._fix_encoding(value)
                else:
                    cleaned[key] = value
            self._data.append(cleaned)
        return len(self._data)

    def add_transform(self, name: str) -> None:
        """Add a registered transform by name to the pipeline."""
        if name not in DataPipeline._registry:
            raise KeyError(f"Unknown transform: {name}")
        self._transforms.append(name)

    def _apply_transforms(self, record: dict) -> dict:
        """Apply all registered transforms to a record."""
        result = dict(record)
        for name in self._transforms:
            func = DataPipeline._registry[name]
            result = func(result)
        return result

    def validate_record(self, record: dict) -> list[str]:
        """Validate a single record. Returns list of error messages."""
        errors = []
        for key, value in record.items():
            if isinstance(value, str) and not value:
                errors.append(f"empty field: {key}")
        if "name" in record and len(record["name"]) > 200:
            errors.append("name too long")
        return errors

    def process(self) -> list[dict]:
        """Process all loaded data in chunks: transform, validate, collect.

        In strict mode, stops at the first validation error.
        Returns successfully processed records.
        """
        results = []
        for i in range(0, len(self._data), DataPipeline._CHUNK_SIZE):
            chunk = self._data[i:i + DataPipeline._CHUNK_SIZE]
            for record in chunk:
                try:
                    transformed = self._apply_transforms(record)
                    errors = self.validate_record(transformed)
                    if errors:
                        self._errors.extend(errors)
                        if self._strict:
                            return results  # stop on first error
                        continue
                    results.append(transformed)
                except Exception as e:
                    self._errors.append(f"transform error: {e}")
                    if self._strict:
                        return results
        return results

    def export_csv(self, records: list[dict]) -> str:
        """Export records to a CSV string."""
        if not records:
            return ""
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=records[0].keys())
        writer.writeheader()
        for record in records:
            writer.writerow(record)
        return output.getvalue()

    def export_json(self, records: list[dict]) -> str:
        """Export records to a JSON string."""
        return json.dumps(records, indent=2)

    @property
    def errors(self) -> list[str]:
        return list(self._errors)

    @property
    def data(self) -> list[dict]:
        return list(self._data)
"#).unwrap();

        let test_file = ap(dir, "test_pipeline.py");
        std::fs::write(&test_file, r#"import json
from pipeline import DataPipeline

def test_load_csv():
    p = DataPipeline()
    csv_data = "name,age,city\nAlice,30,NYC\nBob,25,LA\n"
    count = p.load_csv(csv_data)
    assert count == 2, f"should load 2 records, got {count}"
    assert p.data[0]["name"] == "Alice"

def test_load_json():
    p = DataPipeline()
    data = [{"name": "Alice", "age": 30}, {"name": "Bob", "age": 25}]
    count = p.load_json(json.dumps(data))
    assert count == 2

def test_mojibake_cleanup():
    """Encoding fix should clean up mojibake in loaded data."""
    p = DataPipeline()
    csv_data = "name,city\nRenÃ©,MontrÃ©al\n"
    p.load_csv(csv_data)
    assert p.data[0]["name"] == "Rene", f"got {p.data[0]['name']!r}"
    assert p.data[0]["city"] == "Montreal", f"got {p.data[0]['city']!r}"

def test_custom_transform():
    """Registered transforms should be applied during processing."""
    # Register a custom transform
    DataPipeline.register_transform("upper_name", lambda r: {**r, "name": r["name"].upper()})

    p = DataPipeline()
    csv_data = "name,age\nAlice,30\nBob,25\n"
    p.load_csv(csv_data)
    p.add_transform("upper_name")
    results = p.process()
    assert results[0]["name"] == "ALICE", f"got {results[0]['name']!r}"
    assert results[1]["name"] == "BOB"

def test_unknown_transform_raises():
    p = DataPipeline()
    try:
        p.add_transform("nonexistent")
        assert False, "should raise KeyError"
    except KeyError:
        pass

def test_validation_rejects_empty_fields():
    p = DataPipeline()
    p.load_json('[{"name": "", "age": 25}]')
    results = p.process()
    assert len(results) == 0, "empty name should be rejected"
    assert len(p.errors) > 0

def test_strict_mode_stops_early():
    p = DataPipeline(strict=True)
    data = [
        {"name": "Alice", "age": "30"},
        {"name": "", "age": "25"},
        {"name": "Carol", "age": "35"},
    ]
    p.load_json(json.dumps(data))
    results = p.process()
    # Should stop at the second record (empty name), return only Alice
    assert len(results) == 1, f"strict mode should stop early, got {len(results)}"
    assert results[0]["name"] == "Alice"

def test_chunked_processing():
    """Process should work correctly with chunked batching."""
    p = DataPipeline()
    # Create more records than _CHUNK_SIZE
    records = [{"name": f"user_{i}", "age": str(i)} for i in range(250)]
    p.load_json(json.dumps(records))
    results = p.process()
    assert len(results) == 250, f"should process all 250, got {len(results)}"

def test_export_csv():
    p = DataPipeline()
    records = [{"name": "Alice", "age": "30"}, {"name": "Bob", "age": "25"}]
    csv_out = p.export_csv(records)
    assert "Alice" in csv_out
    assert "Bob" in csv_out
    lines = csv_out.strip().split("\n")
    assert len(lines) == 3  # header + 2 rows

def test_export_json():
    p = DataPipeline()
    records = [{"name": "Alice"}]
    json_out = p.export_json(records)
    parsed = json.loads(json_out)
    assert parsed[0]["name"] == "Alice"

def test_export_empty():
    p = DataPipeline()
    assert p.export_csv([]) == ""
    assert p.export_json([]) == "[]"

def test_chunk_size_exists():
    """_CHUNK_SIZE should be defined for batch processing."""
    assert hasattr(DataPipeline, '_CHUNK_SIZE')
    assert DataPipeline._CHUNK_SIZE > 0

def test_god_class_decomposed():
    """DataPipeline should be decomposed — not all logic in one class."""
    import inspect
    src = inspect.getsource(DataPipeline)
    line_count = len(src.splitlines())
    # The original god class is 136 lines. After decomposing loading,
    # transformation, and/or export into separate classes, the
    # orchestrator should be significantly smaller.
    assert line_count <= 100, (
        f"DataPipeline has {line_count} lines (original: 136). "
        f"Extract loading, transform, or export logic into separate classes."
    )

if __name__ == "__main__":
    test_load_csv()
    test_load_json()
    test_mojibake_cleanup()
    test_custom_transform()
    test_unknown_transform_raises()
    test_validation_rejects_empty_fields()
    test_strict_mode_stops_early()
    test_chunked_processing()
    test_export_csv()
    test_export_json()
    test_export_empty()
    test_chunk_size_exists()
    test_god_class_decomposed()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(format!(
            "The DataPipeline class in {} is a god class that handles loading, \
             transforming, validating, and exporting data all in one place. \
             Decompose it into separate concerns:\n\
             - Extract loading logic into a DataLoader class or module.\n\
             - Extract transformation and validation into a DataTransformer class.\n\
             - Keep DataPipeline as a slim orchestrator.\n\
             - Remove dead code, unused methods, and over-engineered features \
               like the plugin registry and chunked processing.\n\n\
             Step 1: Read the code and plan the decomposition.\n\
             Step 2: Apply your refactoring.\n\
             Step 3: Run the existing `python3 test_pipeline.py` to verify. If tests fail, \
             you may have removed something that's actually used.",
            pipeline_file)),
            vec![
                complete(),
                succeeded("shell"),
                // Primary: tests must pass — they cover CSV/JSON loading,
                // mojibake cleanup, custom transforms, validation, strict mode,
                // chunked processing, and export.
                run_has("python3 test_pipeline.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![pipeline_file]),
            vec![test_file])
    }
    v.push(scen!("xhard_refactor_05_god_class_decomposition", Category::Refactor, Difficulty::Hard, I, setup));
}
