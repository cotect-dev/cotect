# Testing

Write tests for existing code.

## Design principles

- The code under test contains **real bugs** — the model's tests should catch them.
- Tests must verify what the code is **supposed to do** (per docstrings/comments), not what it actually does.
- Verification: run the model's tests against both the buggy code (should fail) and a corrected version (should pass). If tests pass on buggy code, they're not testing real behavior.
- Tests must actually run (syntactically valid, correct imports, proper assertions).
