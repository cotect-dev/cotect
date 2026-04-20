//! Implement — Test 03: Arithmetic-expression parser from scratch (Python)
//!
//! The model must implement `evaluate(expr: str) -> float` that parses and
//! evaluates infix arithmetic expressions with the usual precedence rules:
//!
//!   * Binary operators: `+`, `-`, `*`, `/`.
//!   * Unary minus (and unary plus): `-3`, `+3`, `- -2`, `3 - -2`.
//!   * Parentheses: `(1 + 2) * 3`.
//!   * Integer and decimal literals: `3`, `3.14`, `.5`, `10.`.
//!   * Whitespace between tokens is ignored.
//!
//! Precedence: `+ -` (left-associative) < `* /` (left-associative) <
//! unary < parentheses. So `10 - 3 - 2 == 5` (not `9`). No exponent
//! operator — `1 ** 2` is a parse error.
//!
//! Errors: malformed inputs (mismatched parens, trailing operator, empty,
//! non-numeric gibberish) must raise `ParseError` — a class already
//! defined in the stub. Division by zero must raise `ZeroDivisionError`.
//!
//! Constraint: NO shortcuts. `eval`, `compile`, `ast.*`, `numexpr`,
//! `asteval`, and similar are banned — the test tokenises `parser.py`
//! and fails the run if any appear outside string literals or comments.
//!
//! Why this is genuinely hard:
//!   * Multiple sub-problems (tokeniser + parser + evaluator + error
//!     handling) that must all compose correctly.
//!   * Left-associativity is easy to get wrong with naive recursive-descent.
//!   * Unary minus has a subtle precedence interaction with binary minus.
//!   * The ban on `eval` / `ast` forces real parser construction, not a
//!     one-line wrapper.
//!   * A 200-expression fuzz against Python's own `eval` catches any
//!     precedence or associativity mistake.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let stub = ap(dir, "parser.py");
        std::fs::write(&stub, r#""""Arithmetic-expression parser.

Implement `evaluate(expr)` so that it returns the numeric value of an
infix arithmetic expression string. Supported grammar:

    expr    = term (('+' | '-') term)*
    term    = factor (('*' | '/') factor)*
    factor  = ('+' | '-') factor | primary
    primary = NUMBER | '(' expr ')'

Precedence: + - < * / < unary < parens. Binary operators are
left-associative.

Raise `ParseError` (defined here) on malformed input. Raise
`ZeroDivisionError` (stdlib) on `x / 0`.

Forbidden: `eval`, `compile`, `ast`, `numexpr`, `asteval`. The test
grader scans this file and fails the run if any appear outside string
literals or comments.
"""


class ParseError(Exception):
    pass


def evaluate(expr):
    # TODO: implement.
    raise NotImplementedError
"#).unwrap();

        let test = ap(dir, "test_parser.py");
        std::fs::write(&test, r##""""Parser rubric: shortcut check + unit suite + random-expression fuzz."""

import io
import math
import pathlib
import random
import tokenize

import parser


# ---------- banned-imports check ----------

def test_no_evaluation_shortcuts():
    """Grading guard: no eval / compile / ast / numexpr / asteval.
    `parser.py` is tokenised so docstring mentions don't false-positive.
    """
    src = pathlib.Path(__file__).parent.joinpath("parser.py").read_text()
    banned = {"eval", "compile", "exec", "asteval", "numexpr"}
    banned_modules = {"ast"}
    toks = tokenize.tokenize(io.BytesIO(src.encode()).readline)
    for tok in toks:
        if tok.type == tokenize.NAME and tok.string in banned:
            raise AssertionError(
                f"Forbidden name `{tok.string}` found in parser.py on line "
                f"{tok.start[0]}. Implement without shortcut evaluators."
            )
    # `from ast import ...` style imports — substring check on
    # non-comment lines as a belt-and-braces pass.
    lowered = "\n".join(
        line for line in src.splitlines()
        if not line.strip().startswith("#")
    )
    for mod in banned_modules:
        if (f"import {mod}" in lowered) or (f"from {mod} " in lowered):
            raise AssertionError(
                f"Forbidden module `{mod}` imported in parser.py."
            )


# ---------- fixed unit tests ----------

def _assert_eq(expr, expected):
    got = parser.evaluate(expr)
    if not math.isclose(got, expected, rel_tol=1e-9, abs_tol=1e-9):
        raise AssertionError(f"{expr!r}: got {got!r}, expected {expected!r}")


def test_literal_integers():
    _assert_eq("0", 0)
    _assert_eq("42", 42)
    _assert_eq("  7  ", 7)


def test_literal_floats():
    _assert_eq("3.14", 3.14)
    _assert_eq(".5", 0.5)
    _assert_eq("10.", 10.0)


def test_binary_ops():
    _assert_eq("1 + 2", 3)
    _assert_eq("5 - 2", 3)
    _assert_eq("4 * 3", 12)
    _assert_eq("8 / 2", 4)


def test_precedence():
    _assert_eq("2 + 3 * 4", 14)
    _assert_eq("(2 + 3) * 4", 20)
    _assert_eq("10 - 2 * 3", 4)
    _assert_eq("20 / 4 - 1", 4)


def test_left_associativity():
    # Right-associative eval would return 10 - (3 - 2) = 9.
    # The correct left-associative answer is 5.
    _assert_eq("10 - 3 - 2", 5)
    _assert_eq("100 / 5 / 4", 5)
    _assert_eq("1 - 1 - 1 - 1", -2)


def test_unary_minus():
    _assert_eq("-3", -3)
    _assert_eq("+3", 3)
    _assert_eq("- -2", 2)
    _assert_eq("3 - -2", 5)
    _assert_eq("-(4 + 1)", -5)
    _assert_eq("- - - 1", -1)


def test_nested_parens():
    _assert_eq("((((1))))", 1)
    _assert_eq("((1 + 2) * (3 + 4))", 21)
    _assert_eq("(1 + (2 * (3 + 4)))", 15)


def test_division_by_zero_raises():
    try:
        parser.evaluate("1 / 0")
    except ZeroDivisionError:
        return
    raise AssertionError("'1 / 0' must raise ZeroDivisionError")


def test_malformed_expressions_raise_ParseError():
    malformed = [
        "",         # empty
        "   ",      # whitespace only
        "1 +",      # trailing operator
        "* 3",      # leading binary operator
        "1 2",      # two numbers in a row
        "(1 + 2",   # unbalanced open
        "1 + 2)",   # unbalanced close
        "abc",      # not a number
        "1 ** 2",   # no exponent operator
    ]
    for expr in malformed:
        try:
            result = parser.evaluate(expr)
        except parser.ParseError:
            continue
        raise AssertionError(
            f"{expr!r} must raise ParseError; instead got {result!r}"
        )


# ---------- random-expression fuzz against Python's own eval ----------

def _random_expr(depth=4):
    """Generate a random arithmetic expression and its ground-truth value."""
    if depth <= 0 or random.random() < 0.3:
        n = random.choice([random.randint(1, 20), round(random.uniform(0.1, 9.9), 2)])
        return f"{n}", n
    op = random.choice(["+", "-", "*", "/"])
    a_str, a_val = _random_expr(depth - 1)
    b_str, b_val = _random_expr(depth - 1)
    # Avoid divide-by-zero in the fuzz corpus.
    if op == "/" and abs(b_val) < 0.01:
        b_str, b_val = "2", 2
    roll = random.random()
    if roll < 0.2:
        a_str = f"-{a_str}"
        a_val = -a_val
    if roll >= 0.8:
        combined_str = f"({a_str} {op} {b_str})"
    else:
        combined_str = f"{a_str} {op} {b_str}"
    # `eval` in the test is fine; only parser.py is restricted.
    return combined_str, eval(combined_str)  # noqa: S307


def test_fuzz_against_python_eval():
    random.seed(0xC0FFEE)
    for _ in range(200):
        expr, expected = _random_expr()
        try:
            got = parser.evaluate(expr)
        except Exception as exc:
            raise AssertionError(
                f"Fuzz failure on {expr!r}: parser raised {exc!r}, "
                f"expected {expected!r}"
            )
        if not math.isclose(got, expected, rel_tol=1e-6, abs_tol=1e-6):
            raise AssertionError(
                f"Fuzz failure on {expr!r}: got {got!r}, expected {expected!r}"
            )


if __name__ == "__main__":
    # Run cheapest guard (no-shortcuts) first, then fixed suite, then fuzz.
    test_no_evaluation_shortcuts()
    test_literal_integers()
    test_literal_floats()
    test_binary_ops()
    test_precedence()
    test_left_associativity()
    test_unary_minus()
    test_nested_parens()
    test_division_by_zero_raises()
    test_malformed_expressions_raise_ParseError()
    test_fuzz_against_python_eval()
    print("ALL_TESTS_PASSED")
"##).unwrap();

        with_blocked(with_scope(with_checks(pf(
            "Implement an arithmetic-expression parser in `parser.py`. The \
             stub defines `ParseError` and an `evaluate` function that \
             raises `NotImplementedError`. Fill it in.\n\n\
             Grammar:\n\
             - Binary operators `+ - * /` with conventional precedence \
               (`* /` bind tighter) and LEFT associativity \
               (`10 - 3 - 2 == 5`, not `9`).\n\
             - Unary `+` and `-`.\n\
             - Parentheses for grouping.\n\
             - Integer and decimal literals (`3`, `3.14`, `.5`, `10.`).\n\n\
             Errors:\n\
             - Malformed input raises `ParseError`.\n\
             - Division by zero raises `ZeroDivisionError`.\n\n\
             Constraint: NO shortcuts. You may not use `eval`, `compile`, \
             `exec`, `ast`, `numexpr`, or `asteval`. The grader tokenises \
             `parser.py` and fails if any of those names appear outside \
             string literals or comments. Implement the tokeniser, parser, \
             and evaluator yourself.\n\n\
             Run `python3 test_parser.py` until it prints ALL_TESTS_PASSED. \
             The suite includes 10 fixed cases plus 200 randomly generated \
             expressions compared against Python's own `eval` (the test \
             file may use it; `parser.py` may not)."
            .to_string()
        ),
            vec![
                complete(),
                succeeded("shell"),
                run_has("python3 test_parser.py", &["ALL_TESTS_PASSED"]),
                // Belt-and-braces grep for banned call sites. Only match
                // patterns that can't appear in prose (docstrings,
                // comments, the banned-list recitation we explicitly ask
                // the model to obey). The authoritative guard is the
                // in-test tokeniser check in `test_parser.py`, which
                // correctly excludes string literals and comments — so
                // this secondary grep is deliberately conservative and
                // only catches literal call syntax.
                //
                // Earlier versions included bare `numexpr` / `asteval`
                // here, which false-failed when the model wrote a
                // docstring like "implemented without numexpr, asteval,
                // eval ...".
                file_lacks("parser.py", &[
                    "eval(",
                    "compile(",
                    "ast.parse",
                ]),
            ]),
            vec![stub]),
            vec![test])
    }
    v.push(scen!("xhard_implement_03_expression_parser", Category::Implement, Difficulty::Hard, I, setup));
}
