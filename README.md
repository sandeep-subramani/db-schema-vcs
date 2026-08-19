# Schema Version Control

Version control for database schemas: branch a schema, evolve it
independently, see exactly what diverged, and merge back with
conflict detection. Row data is out of scope — the schema itself
(tables, columns, types, constraints) is the versioned artifact.

**Status:** day 0 — project scaffold. Setup instructions land here
once the stack is in place.

- Decision log and tradeoffs: [decisions.md](./decisions.md)
- Built with Claude Code; every change is reviewed before commit.

## Setup

TBD — target is a one-command local run.

## Architecture

TBD — the core engine (schema model, diff, merge) is kept as pure,
framework-free functions with the UI layered on top.
