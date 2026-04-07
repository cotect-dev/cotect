# Dependency Chain

Trace and fix issues through import/call chains.

## Design principles

- The real bug or issue is **3-4 files deep** in an import/call chain.
- Only the symptom is visible at the surface — the model must trace through re-exports, wrappers, and transformations.
- Include files that are NOT in the initial scope — the model must discover them.
- Verification: the fix must resolve the symptom and pass tests at the surface level.
