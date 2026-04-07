# Patch

Make targeted surgical edits.

## Design principles

- Edits to one file should **break another file** if done in isolation — multiple coordinated patches are required.
- Include repetitive/generated code where the model must change exactly one occurrence without affecting neighbors.
- Require understanding of cross-file dependencies to know what else must change.
- Verification: code must compile/run and pass tests after all patches are applied.
