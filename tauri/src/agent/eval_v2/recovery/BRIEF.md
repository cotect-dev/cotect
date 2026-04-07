# Recovery

Recover from tool failures, ambiguity, and misdirection.

## Design principles

- Files not where expected, ambiguous instructions, broken/corrupted files that need fixing before the real task.
- Redirect chains (file says "look elsewhere"), placeholder files, files with encoding issues.
- The model must demonstrate resilience — not give up on the first unexpected result.
- Verification: the end state must be correct regardless of the obstacles encountered.
