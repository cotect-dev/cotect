//! Performance — Test 02: Load-entire-file → streaming checksum (Python)
//!
//! `compute_checksum(path)` returns the SHA-256 of the file at `path`. The
//! seed implementation reads the whole file into memory via `f.read()` —
//! fine for small inputs, disastrous for the 30 MB seed the harness
//! generates. `tracemalloc` is used to enforce a 5 MB peak-memory budget.
//!
//! Fix: chunked streaming read (e.g. `while chunk := f.read(65536):`).

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        // Deterministic pseudo-random 30 MB seed file. Not a real PRNG —
        // we just want bytes that compress poorly so the streaming fix
        // genuinely matters. 30 MB keeps scenario setup under a second.
        let seed_path = dir.join("seed.bin");
        {
            use std::io::Write;
            let mut f = std::fs::File::create(&seed_path).unwrap();
            let mut buf = [0u8; 4096];
            let mut state: u64 = 0xdead_beef_cafe_babe;
            let total = 30 * 1024 * 1024;
            let mut written = 0;
            while written < total {
                for b in buf.iter_mut() {
                    // xorshift64*
                    state ^= state << 13;
                    state ^= state >> 7;
                    state ^= state << 17;
                    *b = (state & 0xff) as u8;
                }
                let n = (total - written).min(buf.len());
                f.write_all(&buf[..n]).unwrap();
                written += n;
            }
        }

        let src = ap(dir, "processor.py");
        std::fs::write(&src, r#""""Checksum + stats over a file.

compute_checksum must return the SHA-256 hex digest of the file at `path`.
It must run with bounded memory — processing a 30 MB file should peak at
well under 5 MB of Python-allocated memory.
"""

import hashlib


def compute_checksum(path: str) -> str:
    """Return SHA-256 hex digest of the file at `path`."""
    with open(path, "rb") as f:
        data = f.read()
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()
"#).unwrap();

        let test = ap(dir, "test_stream.py");
        std::fs::write(&test, r#""""Memory-budget test for compute_checksum."""

import hashlib
import os
import tracemalloc

from processor import compute_checksum


def _reference_digest(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def test_checksum_matches_reference():
    got = compute_checksum("seed.bin")
    want = _reference_digest("seed.bin")
    assert got == want, f"checksum mismatch: {got} vs {want}"


def test_peak_memory_budget():
    tracemalloc.start()
    tracemalloc.reset_peak()
    compute_checksum("seed.bin")
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    size = os.path.getsize("seed.bin")
    # Budget: 5 MB peak. Streaming with a 64 KB buffer peaks around 100 KB.
    # Load-all peaks at ~30 MB.
    budget = 5 * 1024 * 1024
    assert peak < budget, (
        f"peak memory {peak / 1024 / 1024:.1f} MB exceeds budget "
        f"{budget / 1024 / 1024:.1f} MB on a {size / 1024 / 1024:.1f} MB file — "
        "compute_checksum must stream, not f.read() the whole file"
    )


if __name__ == "__main__":
    test_checksum_matches_reference()
    test_peak_memory_budget()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(
            "`processor.py::compute_checksum` returns the SHA-256 of a file. \
             The current implementation reads the entire file into memory, \
             which blows the 5 MB peak-memory budget that `test_stream.py` \
             enforces via tracemalloc on the 30 MB `seed.bin`.\n\n\
             Rewrite `compute_checksum` so the test passes (ALL_TESTS_PASSED). \
             Keep the function signature `compute_checksum(path: str) -> str` \
             and produce the exact same SHA-256 hex digest — the test checks \
             against a reference streaming implementation."
            .to_string()
        ),
            vec![
                complete(),
                succeeded("shell"),
                run_has("python3 test_stream.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![src]),
            vec![test])
    }
    v.push(scen!("xhard_perf_02_streaming", Category::Performance, Difficulty::Hard, I, setup));
}
