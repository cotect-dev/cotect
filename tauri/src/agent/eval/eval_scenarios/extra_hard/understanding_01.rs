//! Understanding — Test 01: Precise behavioural spec from code (read-only)
//!
//! A 4-file Python workflow engine with no docstrings or comments. The
//! model must READ it and produce a behavioural spec for `Workflow.execute`
//! that demonstrates **actual code comprehension**, not parroting of task-
//! description keywords.
//!
//! The earlier version of this scenario gave away the axes (retry /
//! idempotency / partial failure) in the prompt and rewarded keyword match
//! — models could pass it without reading a line of source. This version:
//!
//!   1. Strips domain words from the prompt. The model has to NAME the
//!      behaviours it sees, not translate a provided taxonomy.
//!   2. Checks for implementation-specific numeric and structural details
//!      that only come from reading the code: the exact base delay
//!      (`0.05`), the jitter range (`0.5` / `1.5`), the `2 **` (or
//!      "doubles") exponential shape, and the fact that idempotency keys
//!      depend on BOTH the step name and the inputs (`task_id(inputs)`),
//!      not the step alone.
//!   3. Still uses a loose structural check (batch result, per-step failure
//!      isolation) so the model gets credit for general understanding even
//!      if it doesn't use the exact English word "partial".

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
            "Read the four Python files in this tempdir (workflow.py, \
             retry.py, state.py, idempotency.py) and produce a behavioural \
             specification for `Workflow.execute`.\n\n\
             Your final response MUST be under 300 words and MUST include \
             all of the following, derived from the code (not from this \
             prompt):\n\
             - The maximum number of attempts per step.\n\
             - The exact base delay value and the multiplier applied on \
               each successive attempt.\n\
             - The numeric range of the jitter applied to each sleep.\n\
             - What KEY the idempotency cache is indexed by (name it \
               precisely — is it the step name, the inputs, or something \
               derived from both?).\n\
             - What the engine does to the sibling steps of one that \
               exhausts its retries.\n\n\
             Do NOT copy language from this prompt. Describe the actual \
             behaviour. Do not modify any files."
            .to_string()
        ),
            vec![
                complete(),
                // Implementation-specific numeric details. The model has to
                // read `retry.py` to get these — they're nowhere in the
                // prompt. A model that parrots the prompt keywords will
                // fail on the numerics.
                Check::OutputContainsAll(vec![
                    "0.05".into(),   // base_delay constant
                    "0.5".into(),    // jitter low end
                    "1.5".into(),    // jitter high end
                ]),
                // The exponential growth shape — accept either the literal
                // `2 **` form, or natural-language equivalents.
                Check::OutputContainsAny(vec![
                    "2 ** ".into(),
                    "2**".into(),
                    "doubles".into(),
                    "doubled".into(),
                    "doubling".into(),
                    "powers of 2".into(),
                ]),
                // Attempt count — same lenient match as before.
                Check::OutputContainsAny(vec![
                    "3 attempts".into(),
                    "three attempts".into(),
                    "max_attempts=3".into(),
                    "up to 3".into(),
                    "3 tries".into(),
                ]),
                // Idempotency key shape — must mention `task_id` (the
                // actual method called) so we know the model traced the
                // key derivation, not just said "idempotency".
                Check::OutputContains("task_id".into()),
                // Partial-failure semantics — the model must explain that
                // sibling steps keep running when one fails. Accept any of
                // the reasonable phrasings.
                Check::OutputContainsAny(vec![
                    "continue".into(),
                    "other steps".into(),
                    "remaining steps".into(),
                    "siblings".into(),
                    "partial".into(),
                    "isolated".into(),
                ]),
            ]),
            vec![workflow, retry, state, idem])
    }
    v.push(scen!("xhard_understanding_01_precise_spec", Category::Understanding, Difficulty::Hard, R, setup));
}
