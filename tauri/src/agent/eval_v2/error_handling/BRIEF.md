# Error Handling

Add or fix error handling in existing code.

## Design principles

- Exception hierarchy ordering issues, async error propagation, silently swallowed errors.
- Tests should actually run the code and verify that errors are properly caught, reported, and don't crash the program.
- Include scenarios where the "obvious" error handling is wrong (e.g., catching too broadly, missing finally blocks, unhandled promise rejections).
- Verification: run the code with error-inducing inputs and check it handles them correctly.
