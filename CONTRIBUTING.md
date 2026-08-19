# Contributing

## Commit messages — Conventional Commits 1.0.0

Every commit message follows Conventional Commits
(https://www.conventionalcommits.org):

    <type>(<optional scope>): <description>

    <optional body — the why, wrapped at 72 chars>

- Types used here: feat, fix, test, docs, refactor, chore
  (tooling/scaffold/config), perf, ci. Breaking change: `!` after
  the type, explained in the body.
- Subject: imperative mood ("add", not "added"), lower-case start,
  no trailing period, aim ≤50 chars (hard cap 72).
- Body only when the change isn't self-evident: what and why, not
  how. Blank line between subject and body; bullets are fine.
- Scope names the area when useful: `feat(diff): ...`,
  `fix(merge): ...`.
