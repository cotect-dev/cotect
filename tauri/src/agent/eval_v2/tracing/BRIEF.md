# Tracing

Trace execution and compute exact outputs.

## Design principles

- Code contains closures, mutation, aliasing, recursion, or other constructs where the result is **counterintuitive**.
- The model must report an exact numeric or string value — no partial credit.
- Avoid well-known gotchas that are overrepresented in training data (e.g., basic JS closure-in-loop). Compose multiple tricky behaviors together.
- Verification: the last number in the model's output must match the expected value exactly.
