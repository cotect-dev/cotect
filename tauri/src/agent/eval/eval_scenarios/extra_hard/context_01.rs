//! Context — Test 01: Needle-in-a-haystack (JavaScript/Node)
//!
//! A ~1200-line `bigfile.js` utility module with 30 `// TODO:` comments
//! scattered through it. Only THREE of those TODOs describe real
//! correctness/safety bugs; the other 27 are harmless future-work notes.
//!
//! The model must locate the three real bugs and patch them WITHOUT
//! rewriting the rest of the file. The rubric enforces this via:
//!   * a test suite that exercises the three bug fixes, and
//!   * `FileDiffLinesAtMost`: the final `bigfile.js` must differ from the
//!     reference snapshot by at most 30 lines (added+removed) — i.e. the
//!     model must localize its edits.
//!
//! The three real bugs:
//!   1. `clampInt(n, lo, hi)` — when `n > hi`, returns `hi - 1` instead of
//!      `hi`. Off-by-one on upper clamp.
//!   2. `parseCsvLine(line)` — naive split on `,`, which corrupts quoted
//!      fields like `a,"b,c",d` → should yield 3 fields.
//!   3. `isPalindrome(s)` — case-sensitive compare; `"Aa"` should be a
//!      palindrome but isn't.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let bigfile_abs = ap(dir, "bigfile.js");
        let bigfile_src = build_bigfile_js();
        std::fs::write(&bigfile_abs, &bigfile_src).unwrap();

        // Reference snapshot for the diff-size check. Writing it under a
        // hidden directory + adding to blocked_files keeps it out of the
        // model's `read` tool surface. The harness passes the absolute path
        // into the FileDiffLinesAtMost check.
        let reference_dir = dir.join(".reference");
        std::fs::create_dir_all(&reference_dir).unwrap();
        let reference_abs = reference_dir.join("bigfile.js");
        std::fs::write(&reference_abs, &bigfile_src).unwrap();

        let test = ap(dir, "test_bigfile.mjs");
        std::fs::write(&test, r#"import * as Big from "./bigfile.js";

function assertEq(actual, expected, name) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        console.error(`FAIL ${name}: expected ${e}, got ${a}`);
        process.exit(1);
    }
}

// Bug 1: clampInt upper bound
assertEq(Big.clampInt(100, 0, 10), 10, "clampInt_upper");
assertEq(Big.clampInt(-5,  0, 10), 0,  "clampInt_lower");
assertEq(Big.clampInt(7,   0, 10), 7,  "clampInt_inside");

// Bug 2: parseCsvLine must respect quoted fields
assertEq(Big.parseCsvLine('a,"b,c",d'),   ["a", "b,c", "d"],      "csv_quoted");
assertEq(Big.parseCsvLine('one,two,three'),["one", "two", "three"], "csv_simple");

// Bug 3: isPalindrome is case-insensitive
assertEq(Big.isPalindrome("Aa"),   true,  "palindrome_case");
assertEq(Big.isPalindrome("Abba"), true,  "palindrome_longer");
assertEq(Big.isPalindrome("abc"),  false, "palindrome_negative");

// Sanity: unrelated helpers must still work (don't over-edit the file).
assertEq(Big.add(2, 3),          5,   "helper_add");
assertEq(Big.doubleIt(21),       42,  "helper_double");
assertEq(Big.clampFloat(99.0, 0.0, 10.0), 10.0, "helper_clampFloat");

console.log("ALL_TESTS_PASSED");
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(format!(
                "`bigfile.js` is a ~1200-line utility module with 30 `// TODO:` \
                 comments. Exactly THREE of those TODOs describe real bugs; \
                 the other 27 are harmless and must not be touched.\n\n\
                 The test harness `test_bigfile.mjs` exercises the three real \
                 bugs. Read `bigfile.js`, identify which three TODOs are \
                 genuine correctness issues, fix ONLY those, and run \
                 `node test_bigfile.mjs` until it prints ALL_TESTS_PASSED.\n\n\
                 Constraint: your final `bigfile.js` must differ from the \
                 original by at most 60 lines (added+removed). The rubric \
                 enforces this — don't rewrite unrelated helpers.\n\n\
                 Files:\n- bigfile.js ({} lines)\n- test_bigfile.mjs",
                bigfile_src.lines().count(),
            )),
            vec![
                complete(),
                succeeded("shell"),
                run_has("node test_bigfile.mjs", &["ALL_TESTS_PASSED"]),
                // Localized-edit rubric: ≤60 changed lines vs the reference.
                // The CSV-parser fix needs a small state machine (~10–15
                // lines) on top of two one-liners. 60 keeps the "don't
                // rewrite the whole file" spirit (file is ~1000 lines)
                // without penalising an honest implementation of
                // parseCsvLine's escape handling.
                diff_at_most(&reference_abs.to_string_lossy(), "bigfile.js", 60),
            ]),
            vec![bigfile_abs]),
            vec![reference_abs.to_string_lossy().into_owned(), test])
    }
    v.push(scen!(
        "xhard_context_01_big_file",
        Category::Context, Difficulty::Hard, I, setup,
        tools = &["node"]
    ));
}

/// Build a large, mostly-trivial JS utility file with 30 TODO comments
/// scattered across it. Three of the TODOs annotate genuine bugs; the rest
/// are harmless.
fn build_bigfile_js() -> String {
    let mut s = String::with_capacity(64 * 1024);
    s.push_str("// Utility module — grab-bag of small helpers accumulated over time.\n");
    s.push_str("// Maintainer note: historically this file has been 'cleaned up'\n");
    s.push_str("// several times and each pass introduced regressions. Please make\n");
    s.push_str("// surgical changes, add tests, and resist the urge to rewrite sections.\n");
    s.push('\n');
    s.push_str("'use strict';\n\n");

    // --- Helper block 1: arithmetic (trivial, many TODOs that are NOT bugs)
    s.push_str("// ---------- Section 1: arithmetic helpers ----------\n\n");

    s.push_str("// TODO: consider adding BigInt variants if we ever need >53-bit inputs.\n");
    s.push_str("export function add(a, b) { return a + b; }\n\n");

    s.push_str("// TODO: could use Math.fround for strict 32-bit floats.\n");
    s.push_str("export function subtract(a, b) { return a - b; }\n\n");

    s.push_str("// TODO: benchmark against bitshift on hot paths.\n");
    s.push_str("export function doubleIt(n) { return n * 2; }\n\n");

    s.push_str("// TODO: consider memoizing if called in a tight loop.\n");
    s.push_str("export function triple(n) { return n * 3; }\n\n");

    s.push_str("// TODO: same as above — memoization candidate.\n");
    s.push_str("export function quadruple(n) { return n * 4; }\n\n");

    s.push_str("// TODO: halve should probably clamp to 0 for negatives in callers.\n");
    s.push_str("export function halve(n) { return n / 2; }\n\n");

    s.push_str("// TODO: fold into a generic nth-power helper someday.\n");
    s.push_str("export function square(n) { return n * n; }\n\n");

    s.push_str("// TODO: same — folding candidate.\n");
    s.push_str("export function cube(n) { return n * n * n; }\n\n");

    // --- Clamp helpers (section 2) — clampInt has a REAL BUG ---
    s.push_str("// ---------- Section 2: clamp helpers ----------\n\n");

    s.push_str("// TODO: BUG — when `n > hi`, this returns `hi - 1` instead of `hi`.\n");
    s.push_str("//   Off-by-one on the upper clamp; lower clamp is fine.\n");
    s.push_str("export function clampInt(n, lo, hi) {\n");
    s.push_str("    if (n < lo) return lo;\n");
    s.push_str("    if (n > hi) return hi - 1;\n"); // <-- bug 1
    s.push_str("    return n;\n");
    s.push_str("}\n\n");

    s.push_str("// TODO: consider renaming arguments to `low`/`high` for symmetry.\n");
    s.push_str("export function clampFloat(n, lo, hi) {\n");
    s.push_str("    if (n < lo) return lo;\n");
    s.push_str("    if (n > hi) return hi;\n");
    s.push_str("    return n;\n");
    s.push_str("}\n\n");

    s.push_str("// TODO: could accept an arbitrary comparator.\n");
    s.push_str("export function min3(a, b, c) {\n");
    s.push_str("    return Math.min(a, b, c);\n");
    s.push_str("}\n\n");

    s.push_str("// TODO: see above — generalize to N-ary.\n");
    s.push_str("export function max3(a, b, c) {\n");
    s.push_str("    return Math.max(a, b, c);\n");
    s.push_str("}\n\n");

    // --- String helpers (section 3) — isPalindrome has a REAL BUG ---
    s.push_str("// ---------- Section 3: string helpers ----------\n\n");

    s.push_str("// TODO: drop trailing punctuation before checking.\n");
    s.push_str("export function wordCount(s) {\n");
    s.push_str("    if (!s) return 0;\n");
    s.push_str("    return s.trim().split(/\\s+/).length;\n");
    s.push_str("}\n\n");

    s.push_str("// TODO: BUG — compare is case-sensitive; 'Aa' should be a palindrome.\n");
    s.push_str("//   Normalize case (and ideally strip non-alphanumerics) before compare.\n");
    s.push_str("export function isPalindrome(s) {\n");
    s.push_str("    const r = s.split('').reverse().join('');\n");
    s.push_str("    return s === r;\n"); // <-- bug 2
    s.push_str("}\n\n");

    s.push_str("// TODO: could accept a locale for Unicode-aware upcase.\n");
    s.push_str("export function upper(s) { return s.toUpperCase(); }\n\n");

    s.push_str("// TODO: locale-aware variant needed eventually.\n");
    s.push_str("export function lower(s) { return s.toLowerCase(); }\n\n");

    s.push_str("// TODO: treat CRLF and LF identically — currently does.\n");
    s.push_str("export function lineCount(s) {\n");
    s.push_str("    if (!s) return 0;\n");
    s.push_str("    return s.split(/\\r?\\n/).length;\n");
    s.push_str("}\n\n");

    s.push_str("// TODO: consider collapsing whitespace runs.\n");
    s.push_str("export function stripWhitespace(s) {\n");
    s.push_str("    return (s || '').replace(/\\s+/g, ' ').trim();\n");
    s.push_str("}\n\n");

    // --- CSV / parsing section 4 — parseCsvLine has a REAL BUG ---
    s.push_str("// ---------- Section 4: parsing helpers ----------\n\n");

    s.push_str("// TODO: BUG — naive split on ',' corrupts quoted fields.\n");
    s.push_str("//   `a,\"b,c\",d` should parse as [\"a\", \"b,c\", \"d\"] (3 fields).\n");
    s.push_str("//   A small state machine respecting double-quote escape is fine.\n");
    s.push_str("export function parseCsvLine(line) {\n");
    s.push_str("    return (line || '').split(',');\n"); // <-- bug 3
    s.push_str("}\n\n");

    s.push_str("// TODO: also parse negative integers.\n");
    s.push_str("export function parseIntStrict(s) {\n");
    s.push_str("    if (!/^-?\\d+$/.test(s)) throw new Error('not an int: ' + s);\n");
    s.push_str("    return parseInt(s, 10);\n");
    s.push_str("}\n\n");

    s.push_str("// TODO: accept a radix.\n");
    s.push_str("export function parseIntLax(s) {\n");
    s.push_str("    const n = parseInt(s, 10);\n");
    s.push_str("    return Number.isNaN(n) ? null : n;\n");
    s.push_str("}\n\n");

    s.push_str("// TODO: consider explicit NaN return vs throwing.\n");
    s.push_str("export function parseFloatStrict(s) {\n");
    s.push_str("    if (!/^-?\\d+(\\.\\d+)?$/.test(s)) throw new Error('not a float: ' + s);\n");
    s.push_str("    return parseFloat(s);\n");
    s.push_str("}\n\n");

    // --- Array helpers (section 5) — all fine, many TODOs ---
    s.push_str("// ---------- Section 5: array helpers ----------\n\n");

    for (name, body, note) in [
        ("sum",        "return xs.reduce((a, b) => a + b, 0);",        "would be nice to accept iterables, not just arrays"),
        ("product",    "return xs.reduce((a, b) => a * b, 1);",        "short-circuit on 0 for slight speedup"),
        ("first",      "return xs.length ? xs[0] : null;",              "maybe return undefined consistently"),
        ("last",       "return xs.length ? xs[xs.length - 1] : null;",  "same — undefined vs null is inconsistent repo-wide"),
        ("uniq",       "return Array.from(new Set(xs));",                "preserve insertion order (Set already does, noted)"),
        ("reversed",   "return xs.slice().reverse();",                   "consider in-place alternative"),
        ("flatten",    "return [].concat(...xs);",                       "deep flatten helper would be nice"),
        ("chunk",      "const out = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out;", "validate n>0 maybe"),
        ("compact",    "return xs.filter(x => x !== null && x !== undefined);", "decide if 0/'' should be dropped"),
        ("zip",        "const n = Math.min(a.length, b.length); const out = []; for (let i = 0; i < n; i++) out.push([a[i], b[i]]); return out;", "generalize to N arrays"),
    ] {
        s.push_str(&format!("// TODO: {}\n", note));
        let args = if name == "zip" { "(a, b)" } else if name == "chunk" { "(xs, n)" } else { "(xs)" };
        s.push_str(&format!("export function {}{} {{\n    {}\n}}\n\n", name, args, body));
    }

    // --- Object helpers (section 6) — all fine ---
    s.push_str("// ---------- Section 6: object helpers ----------\n\n");

    for (name, body, note) in [
        ("hasProp",   "return Object.prototype.hasOwnProperty.call(obj, key);", "consider symbol-keyed inspection"),
        ("keys",      "return Object.keys(obj || {});",                          "sort for stable output?"),
        ("values",    "return Object.values(obj || {});",                        "same sort question"),
        ("entries",   "return Object.entries(obj || {});",                       "sort by key for stable output"),
        ("pick",      "const out = {}; for (const k of ks) if (k in obj) out[k] = obj[k]; return out;", "symbol support"),
        ("omit",      "const out = {}; for (const k of Object.keys(obj)) if (!ks.includes(k)) out[k] = obj[k]; return out;", "same"),
        ("merge",     "return Object.assign({}, a, b);",                         "deep merge someday"),
        ("invert",    "const out = {}; for (const [k, v] of Object.entries(obj)) out[v] = k; return out;", "handle duplicate values"),
    ] {
        s.push_str(&format!("// TODO: {}\n", note));
        let args = match name {
            "pick" | "omit" => "(obj, ks)",
            "merge" => "(a, b)",
            _ => "(obj)",
        };
        s.push_str(&format!("export function {}{} {{\n    {}\n}}\n\n", name, args, body));
    }

    // --- Date helpers (section 7) — all fine ---
    s.push_str("// ---------- Section 7: date helpers ----------\n\n");
    for (name, body, note) in [
        ("nowIso",        "return new Date().toISOString();",     "consider injecting a clock for tests"),
        ("parseIsoDate",  "return new Date(s);",                  "validate format explicitly"),
        ("daysBetween",   "return Math.round((b - a) / 86400000);", "DST-aware variant needed"),
        ("startOfDay",    "const d = new Date(x); d.setHours(0,0,0,0); return d;", "UTC variant"),
    ] {
        s.push_str(&format!("// TODO: {}\n", note));
        let args = if name == "daysBetween" { "(a, b)" } else if name == "nowIso" { "()" } else { "(s)" };
        let args = if name == "startOfDay" { "(x)" } else { args };
        s.push_str(&format!("export function {}{} {{\n    {}\n}}\n\n", name, args, body));
    }

    // Tail padding — keep the file long enough to discourage naive rewrites.
    s.push_str("// ---------- Section 8: internal notes ----------\n\n");
    for i in 0..80 {
        s.push_str(&format!("// Note {}: kept for historical reasons; safe to leave alone.\n", i));
    }
    s.push_str("\n// End of file.\n");
    s
}
