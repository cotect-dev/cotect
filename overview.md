# Cotect — Vision and Architecture

## What Cotect Is

Cotect is a new type of IDE where the central interface is a **visual architecture graph** (react-flow) of the user's project. Users interact with AI agents through a chat interface, but the key differentiator is that the graph provides **scoping, context, and coordination** for agent work.

**The analogy is an RTS game command center**, not visual programming. The user sees the architecture map, selects specific scopes (nodes/subgraphs), and dispatches focused agents to small tasks — maintaining situational awareness across all concurrent work.

## Core Philosophy: Anti-Vibe-Coding

The product is positioned against the failure mode of current AI coding tools:
1. User asks for a big change → agent makes it plus 15 side effects
2. User can't review everything → loses understanding of their own codebase
3. Next bug is impossible to fix without the agent → user is trapped rolling dice

Cotect's counter: **small scoped tasks + architectural awareness**. The user stays in the loop because they direct work at the architectural level and see changes in context.

## Key Technical Decisions

### Graph Generation
- The graph is **generated from code via tree-sitter**, not manually maintained by users or agents
- Code is the source of truth. Code → tree-sitter → graph. One-directional.
- Agents modify code, tree-sitter re-parses, graph updates
- Agents are asked to write/update **human-readable descriptions** for changed files/modules (semantic layer on top of structural parsing)

### Multi-Level Granularity
- Folders → files → functions, each as nodes
- **Context-dependent visibility**: only nodes relevant to the current selection are shown
- "Related functions" and "files where selected function is used" drive the visible subgraph
- Different views for different tasks (file connections vs implementation inspection)
- Granularity is user-controlled, not fixed

### Agent Coordination
- Multiple agents can work concurrently on different parts of the codebase
- File locking prevents agents from conflicting on the same files
- **Dependency-aware conflict detection** is the goal: the graph edges provide the data structure to warn when Agent B touches something that depends on what Agent A is modifying
- Even imperfect conflict detection is a step change over current tools (which have zero coordination)

### Context for Agents
- What the user selects on the graph determines the context agents receive
- This is a better UX for scoping agent work than listing files in a chat
- Agents become architecture-aware, understanding system topology, not just individual files

## Remaining Engineering Challenges

1. **Context graph quality** — getting from tree-sitter syntax trees to "these functions are closely related" requires import/export analysis, call graph construction, and type flow tracking. LSP servers do much of this. Quality here determines whether the product feels magical or useless.
2. **Feedback loop speed** — tree-sitter re-parse and graph updates must be near-real-time as agents write code, or situational awareness breaks down.
3. **Language coverage** — tree-sitter grammar quality varies by language. Parser layer must degrade gracefully.

## Current Codebase State (as of 2026-03-18)

The shell is built: chat with LLM streaming, react-flow canvas (empty), draggable panel layout, NeutralinoJS desktop wrapper. Core differentiators (tree-sitter parsing, context graph, scoped agent dispatch, conflict detection) are not yet implemented.
