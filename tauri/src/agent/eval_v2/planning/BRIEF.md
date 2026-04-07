# Planning

Create implementation plans from code analysis.

## Design principles

- Must read existing code to discover implicit constraints before planning (not just regurgitate patterns).
- Hidden constraints spread across multiple files (e.g., SQLite limitations, sync-only frameworks, threading locks, cron workers).
- Plans must be specific, numbered, and reference actual files/functions in the codebase.
- Include scenarios where naive planning would violate discovered constraints.
- Verification: output must contain numbered steps that address all discovered constraints.
