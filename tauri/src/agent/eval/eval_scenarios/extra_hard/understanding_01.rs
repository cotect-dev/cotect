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
        std::fs::write(&workflow, r#"from retry import run_with_retry, _CONSERVATIVE_PROFILE
from state import StepResult, BatchResult
from idempotency import IdempotencyStore


class Workflow:
    def __init__(self, steps, idem_store=None, retry_profile=None):
        self._steps = steps
        self._idem = idem_store or IdempotencyStore()
        self._retry = retry_profile or _CONSERVATIVE_PROFILE

    def execute(self, inputs):
        batch = BatchResult()
        for step in self._steps:
            key = step.task_id(inputs)
            cached = self._idem.get(key)
            if cached is not None:
                batch.add(step.name, cached)
                continue
            try:
                value = run_with_retry(lambda: step.run(inputs), profile=self._retry)
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

_DEFAULT_PROFILE = {
    "max_attempts": 5,
    "base_delay": 0.1,
    "jitter_lo": 0.8,
    "jitter_hi": 1.2,
}

_CONSERVATIVE_PROFILE = {
    "max_attempts": 3,
    "base_delay": 0.05,
    "jitter_lo": 0.5,
    "jitter_hi": 1.5,
}


def run_with_retry(fn, profile=None, **overrides):
    cfg = dict(profile or _DEFAULT_PROFILE)
    cfg.update(overrides)
    max_attempts = cfg["max_attempts"]
    base_delay = cfg["base_delay"]
    jitter_lo = cfg["jitter_lo"]
    jitter_hi = cfg["jitter_hi"]
    attempt = 0
    while True:
        try:
            return fn()
        except Exception:
            attempt += 1
            if attempt >= max_attempts:
                raise
            delay = base_delay * (2 ** (attempt - 1))
            delay *= random.uniform(jitter_lo, jitter_hi)
            time.sleep(delay)


def run_with_backoff(fn, max_retries=3, initial_wait=0.2):
    for i in range(max_retries + 1):
        try:
            return fn()
        except Exception:
            if i == max_retries:
                raise
            time.sleep(initial_wait * (3 ** i))
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
            "Read the Python files in this tempdir and produce a \
             behavioural specification for `Workflow.execute`.\n\n\
             Your final response MUST be under 300 words and MUST cover \
             the retry strategy (exact numeric parameters — not the \
             defaults from any profile that isn't actually used), the \
             idempotency mechanism, and the failure-handling semantics, \
             all derived from tracing the actual code paths.\n\n\
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
                // The exponential growth shape — accept any reasonable
                // way the model can express "base 2": Python operator
                // (`2 **`, `2**`), math notation (`2^`, `2 ^`), English
                // verbs (doubles / doubled / doubling), powers-of-2
                // phrasing, or `base 2` / `factor of 2`. The intent is
                // to reject answers that say "exponential backoff" in
                // the abstract without specifying the base — not to
                // grade the model's syntactic preference.
                Check::OutputContainsAny(vec![
                    "2 ** ".into(),
                    "2**".into(),
                    "2^".into(),
                    "2 ^".into(),
                    "doubles".into(),
                    "doubled".into(),
                    "doubling".into(),
                    "powers of 2".into(),
                    "power of 2".into(),
                    "base 2".into(),
                    "factor of 2".into(),
                    "multiplied by 2".into(),
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
                // Negative: must not report the _DEFAULT_PROFILE values
                // as the actual retry params. The workflow uses
                // _CONSERVATIVE_PROFILE, not the default.
                Check::OutputDoesNotContain(vec![
                    "5 attempts".into(),
                    "five attempts".into(),
                    "up to 5".into(),
                    "max_attempts=5".into(),
                ]),
            ]),
            vec![workflow, retry, state, idem])
    }
    v.push(scen!("xhard_understanding_01_precise_spec", Category::Understanding, Difficulty::Hard, R, setup));
}
