# AI workflow

This workflow is tool-agnostic and applies to Codex, Claude Code, other coding agents, and contributors using assistance.

For each implementation task:

1. Inspect relevant repository state.
2. Read applicable product, architecture, roadmap, ADR, development, and testing documentation.
3. Identify the exact requested scope and constraints.
4. Make the smallest coherent change.
5. Preserve architectural boundaries and hard invariants.
6. Add or update appropriate tests.
7. Run relevant build, test, lint, and formatting commands.
8. Inspect the diff.
9. Report what changed, verification performed, remaining limitations, and files changed.

Do not perform unrelated refactors, change architecture without explicit approval, introduce libraries without justification, claim unrun tests passed, hide failures, or commit automatically. Never silently alter an invariant or promote a post-MVP idea into MVP work.
