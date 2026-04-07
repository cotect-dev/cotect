# Needle in Haystack

Require reading a large amount of context from which a subtle detail needs to be figured out.

## Design principles

- Large files (500+ lines) or many files where one specific detail is the answer.
- The relevant information is buried among plausible distractors.
- Cannot be solved by simple grep — requires understanding context to distinguish the real needle from decoys.
- Include scenarios where the "needle" is a semantic property (e.g., "which function can return None under specific conditions?") rather than a textual pattern.
- Verification: output must contain the exact correct answer.
