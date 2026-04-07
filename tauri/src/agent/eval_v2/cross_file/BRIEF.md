# Cross-File

Edits that span multiple files consistently.

## Design principles

- Changes in one file must cascade to 3+ other files to maintain consistency.
- Include type/interface changes, renames, moved constants, and schema changes.
- At least one scenario where forgetting to update a single file causes a runtime or compile error.
- Verification: all files must compile/run together and pass integration tests.
