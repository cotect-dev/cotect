# Refactor

Restructure code without changing behavior.

## Design principles

- Require **multiple steps** — not just a single rename or extract.
- Include code that **looks** like dead weight but is actually crucial to correctness. At least one scenario should tempt the model into removing something that breaks the code.
- At least one scenario where the code is already optimal — nothing can be materially improved without breaking behavior. The model should recognize this and make minimal or no changes.
- Verification: a pre-existing test suite must still pass after refactoring.
