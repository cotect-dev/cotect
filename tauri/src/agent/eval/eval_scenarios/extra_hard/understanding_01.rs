//! Understanding — Test 01: Behavioral spec write-up (Python, read-only)
//!
//! A 4-file Python workflow engine with no docstrings or comments. The model
//! must READ it and produce a concise (≤200 word) behavioral spec for
//! `Workflow.execute` that names:
//!   * the retry policy (exponential backoff with jitter, max 3 retries),
//!   * the idempotency contract (keyed by `task_id`; a previously-observed
//!     key short-circuits to the cached result),
//!   * the partial-failure semantics (on permanent failure after retries,
//!     other steps complete; the batch result marks the failed step with
//!     its exception).
//!
//! Rubric: final output must contain all the required substrings. No code
//! changes are required or expected — this is a comprehension test.

use std::path::Path;

use crate::agent::types::AgentRole::Research as R;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let workflow = ap(dir, "workflow.py");
        std::fs::write(&workflow, r#"from retry import run_with_retry
from state import StepResult, BatchResult
from idempotency import IdempotencyStore


class Workflow:
    def __init__(self, steps, idem_store=None):
        self._steps = steps
        self._idem = idem_store or IdempotencyStore()

    def execute(self, inputs):
        batch = BatchResult()
        for step in self._steps:
            key = step.task_id(inputs)
            cached = self._idem.get(key)
            if cached is not None:
                batch.add(step.name, cached)
                continue
            try:
                value = run_with_retry(lambda: step.run(inputs), max_attempts=3)
            except Exception as exc:
                batch.add_error(step.name, exc)
                continue
            self._idem.put(key, value)
            batch.add(step.name, value)
        return batch
"#).unwrap();

        let retry = ap(dir, "retry.py");
        std::fs::write(&retry, r#"import random
import time


def run_with_retry(fn, max_attempts=3, base_delay=0.05):
    attempt = 0
    while True:
        try:
            return fn()
        except Exception:
            attempt += 1
            if attempt >= max_attempts:
                raise
            delay = base_delay * (2 ** (attempt - 1))
            delay *= random.uniform(0.5, 1.5)
            time.sleep(delay)
"#).unwrap();

        let state = ap(dir, "state.py");
        std::fs::write(&state, r#"class StepResult:
    def __init__(self, name, value=None, error=None):
        self.name = name
        self.value = value
        self.error = error

    @property
    def ok(self):
        return self.error is None


class BatchResult:
    def __init__(self):
        self.results = []

    def add(self, name, value):
        self.results.append(StepResult(name, value=value))

    def add_error(self, name, error):
        self.results.append(StepResult(name, error=error))

    @property
    def ok(self):
        return all(r.ok for r in self.results)
"#).unwrap();

        let idem = ap(dir, "idempotency.py");
        std::fs::write(&idem, r#"class IdempotencyStore:
    def __init__(self):
        self._cache = {}

    def get(self, key):
        return self._cache.get(key)

    def put(self, key, value):
        self._cache[key] = value
"#).unwrap();

        with_scope(with_checks(pf(
            "Read the workflow engine in this tempdir (4 Python files: \
             workflow.py, retry.py, state.py, idempotency.py) and write a \
             concise behavioral specification for `Workflow.execute`.\n\n\
             Your final response MUST be under 250 words and MUST cover \
             all three of:\n\
             - Retry policy — number of attempts, backoff shape, jitter.\n\
             - Idempotency — how past results affect subsequent calls.\n\
             - Partial-failure semantics — what happens to sibling steps \
               when one step exhausts its retries.\n\n\
             Use the words `exponential`, `jitter`, `idempotency`, and \
             `partial` at least once each so a reviewer can confirm all \
             three axes are covered. Do not modify any files."
            .to_string()
        ),
            vec![
                complete(),
                // The spec must name each core axis. Case-insensitive match
                // via contains_ci. Attempt count is enforced separately with
                // OutputContainsAny so the model can spell it several ways.
                Check::OutputContainsAll(vec![
                    "exponential".into(),
                    "jitter".into(),
                    "idempotency".into(),
                    "partial".into(),
                ]),
                Check::OutputContainsAny(vec![
                    "3 attempts".into(),
                    "three attempts".into(),
                    "max_attempts=3".into(),
                    "up to 3".into(),
                    "3 tries".into(),
                ]),
            ]),
            vec![workflow, retry, state, idem])
    }
    v.push(scen!("xhard_understanding_01_spec_writeup", Category::Understanding, Difficulty::Hard, R, setup));
}
