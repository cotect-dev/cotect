# Search

Find specific patterns/issues across a codebase.

## Design principles

- Include **decoys** — matches that look correct but aren't (e.g., "TODO" in variable names vs comments).
- Require precision counting — the exact number matters.
- Spread targets across many files with varying formats.
- At least one scenario where a naive regex gives the wrong count and the model must refine its search.
- Verification: the final number in the model's output must match exactly.
