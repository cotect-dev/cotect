# Architecture Replanning

Require material structural changes to code without changing functionality, fulfilling explicit constraints.

## Design principles

- Constraints like "no file longer than 200 lines", "no function longer than 50 lines", "no circular dependencies".
- The model must reorganize code across files while keeping all tests passing.
- Include code that is tightly coupled in ways that make naive splitting break things.
- Shared state, cross-cutting concerns, and initialization order must all be preserved.
- Verification: all original tests must pass AND the structural constraints must be met.
