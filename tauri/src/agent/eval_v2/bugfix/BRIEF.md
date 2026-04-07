# Bugfix

Find and fix bugs in existing code.

## Design principles

- Bugs should be **non-obvious** — never a single typo or missing keyword that's immediately visible.
- Fixes should require **multiple steps**: reading multiple files, understanding context, then making coordinated changes.
- Include red herrings: code that looks suspicious but is actually correct, while the real bug is elsewhere.
- At least one scenario should have the bug in a file that is NOT mentioned in the prompt.
- Verification: code must compile/run and pass a provided test suite after the fix.
