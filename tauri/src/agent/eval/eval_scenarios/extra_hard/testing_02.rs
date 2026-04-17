//! Testing v2 — Scenario 02: Statistics library
//!
//! Two-file Python statistics module. The model must write tests that
//! exercise the functions according to their docstrings.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let stats_file = ap(dir, "stats.py");
        std::fs::write(&stats_file, r#""""Basic statistics functions."""

import math


def mean(values):
    """Arithmetic mean of a list of numbers.

    Raises ValueError on empty input.

    >>> mean([1, 2, 3])
    2.0
    """
    if not values:
        raise ValueError("mean requires at least one value")
    return sum(values) / len(values)


def median(values):
    """Median of a list of numbers.

    For even-length lists, returns the average of the two middle values.
    Raises ValueError on empty input.

    >>> median([3, 1, 2])
    2
    >>> median([1, 2, 3, 4])
    2.5
    """
    if not values:
        raise ValueError("median requires at least one value")
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2 == 1:
        return s[mid]
    return s[mid]


def stdev(values):
    """Sample standard deviation (Bessel's correction: divide by N-1).

    Raises ValueError if fewer than 2 values.

    >>> round(stdev([2, 4, 4, 4, 5, 5, 7, 9]), 4)
    2.1381
    """
    if len(values) < 2:
        raise ValueError("stdev requires at least two values")
    m = mean(values)
    ss = sum((x - m) ** 2 for x in values)
    return math.sqrt(ss / len(values))
"#).unwrap();

        let transform_file = ap(dir, "transform.py");
        std::fs::write(&transform_file, r#""""Data transformation utilities built on stats module."""

from stats import mean


def normalize(values):
    """Min-max normalize values to the [0, 1] range.

    Each value becomes (value - min) / (max - min).
    If all values are equal, returns a list of 0.0s.
    Raises ValueError on empty input.

    >>> normalize([1, 2, 3])
    [0.0, 0.5, 1.0]
    """
    if not values:
        raise ValueError("cannot normalize empty list")
    lo = min(values)
    hi = max(values)
    if lo == hi:
        return [0.0] * len(values)
    return [(v - lo) / hi for v in values]


def z_scores(values):
    """Compute the z-score of each value: (value - mean) / stdev.

    Requires at least 2 values (uses sample stdev).
    Returns a list of floats.

    >>> z = z_scores([2, 4, 4, 4, 5, 5, 7, 9])
    >>> round(z[0], 4)
    -1.5011
    """
    from stats import stdev as sd
    m = mean(values)
    s = sd(values)
    return [(v - m) / s for v in values]
"#).unwrap();

        let stats_fixed = ap(dir, "stats_fixed.py");
        std::fs::write(&stats_fixed, r#""""Basic statistics functions."""

import math


def mean(values):
    """Arithmetic mean of a list of numbers.

    Raises ValueError on empty input.

    >>> mean([1, 2, 3])
    2.0
    """
    if not values:
        raise ValueError("mean requires at least one value")
    return sum(values) / len(values)


def median(values):
    """Median of a list of numbers.

    For even-length lists, returns the average of the two middle values.
    Raises ValueError on empty input.

    >>> median([3, 1, 2])
    2
    >>> median([1, 2, 3, 4])
    2.5
    """
    if not values:
        raise ValueError("median requires at least one value")
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2 == 1:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2


def stdev(values):
    """Sample standard deviation (Bessel's correction: divide by N-1).

    Raises ValueError if fewer than 2 values.

    >>> round(stdev([2, 4, 4, 4, 5, 5, 7, 9]), 4)
    2.1381
    """
    if len(values) < 2:
        raise ValueError("stdev requires at least two values")
    m = mean(values)
    ss = sum((x - m) ** 2 for x in values)
    return math.sqrt(ss / (len(values) - 1))
"#).unwrap();

        let transform_fixed = ap(dir, "transform_fixed.py");
        std::fs::write(&transform_fixed, r#""""Data transformation utilities built on stats module."""

from stats import mean


def normalize(values):
    """Min-max normalize values to the [0, 1] range.

    Each value becomes (value - min) / (max - min).
    If all values are equal, returns a list of 0.0s.
    Raises ValueError on empty input.

    >>> normalize([1, 2, 3])
    [0.0, 0.5, 1.0]
    """
    if not values:
        raise ValueError("cannot normalize empty list")
    lo = min(values)
    hi = max(values)
    if lo == hi:
        return [0.0] * len(values)
    return [(v - lo) / (hi - lo) for v in values]


def z_scores(values):
    """Compute the z-score of each value: (value - mean) / stdev.

    Requires at least 2 values (uses sample stdev).
    Returns a list of floats.

    >>> z = z_scores([2, 4, 4, 4, 5, 5, 7, 9])
    >>> round(z[0], 4)
    -1.5011
    """
    from stats import stdev as sd
    m = mean(values)
    s = sd(values)
    return [(v - m) / s for v in values]
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

pairs = [
    ("stats.py", "stats_buggy.py", "stats_fixed.py"),
    ("transform.py", "transform_buggy.py", "transform_fixed.py"),
]

def swap_all(suffix):
    for target, buggy, fixed in pairs:
        src = buggy if suffix == "buggy" else fixed
        if os.path.exists(src):
            shutil.copy(src, target)
    shutil.rmtree('__pycache__', ignore_errors=True)

def run_tests():
    return subprocess.run(
        [sys.executable, '-B', test_file],
        capture_output=True, text=True, timeout=30
    )

swap_all("buggy")
buggy_result = run_tests()
buggy_failed = buggy_result.returncode != 0 or "ALL_TESTS_PASSED" not in buggy_result.stdout

swap_all("fixed")
fixed_result = run_tests()
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

        let stats_buggy = ap(dir, "stats_buggy.py");
        std::fs::write(&stats_buggy, std::fs::read_to_string(&stats_file).unwrap()).unwrap();
        let transform_buggy = ap(dir, "transform_buggy.py");
        std::fs::write(&transform_buggy, std::fs::read_to_string(&transform_file).unwrap()).unwrap();

        with_blocked(with_scope(with_checks(pf(format!(
            "The statistics library consisting of {} and {} is suspected to \
             contain defects where the implementations diverge from their \
             documented contracts. Write a test suite that catches any such \
             divergence — a faithful implementation must pass every \
             assertion, while any deviation from the specified behaviour \
             must cause at least one failure.\n\n\
             Deliverable: a Python test script whose filename matches \
             `test_*.py`. The current source in this directory is suspected \
             to be buggy — running your test script directly against it is \
             expected to fail; that is the point, not a problem to paper \
             over by weakening assertions. To validate end-to-end, run \
             `python3 run_tests.py`: it prints exactly `ALL_TESTS_PASSED` \
             once your tests both catch the defects and still pass on a \
             faithful implementation. Stop as soon as you see that \
             sentinel — don't keep iterating. You decide the structure, \
             framework, and which behaviours are worth asserting.",
            stats_file, transform_file)),
            vec![
                complete(),
                succeeded("shell"),
                run_has("python3 run_tests.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![stats_file.clone(), transform_file.clone()]),
            vec![stats_fixed, transform_fixed, runner, stats_buggy, transform_buggy])
    }
    v.push(scen!("xhard_testing_02_stats_library", Category::Testing, Difficulty::Hard, I, setup));
}
