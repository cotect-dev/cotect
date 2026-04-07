# Analysis

Identify vulnerabilities, patterns, and complexity.

## Design principles

- Include security vulnerabilities (injection, SSRF, path traversal), design pattern identification, and complexity analysis.
- Vulnerabilities should be **non-textbook** — not just `f"SELECT {x}"` but realistic patterns with partial sanitization that's insufficient.
- The model must identify specific issues and explain why they're dangerous.
- Verification: output must mention specific vulnerability types, affected code locations, and attack vectors.
