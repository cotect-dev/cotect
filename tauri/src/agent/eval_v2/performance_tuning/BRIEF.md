# Performance Tuning

Require material improvements to code performance, verified by actual execution.

## Design principles

- Provide code that is functionally correct but slow (O(n^2) where O(n) is possible, repeated allocations, missing caching, etc.).
- The model must identify the bottleneck and fix it without breaking functionality.
- Improvements must be measurable — tests run the code and verify it completes within a time limit.
- Include scenarios where the "obvious" optimization is wrong (e.g., caching something that shouldn't be cached because it's mutable).
- Verification: code must produce correct output AND complete within a specified time limit.
