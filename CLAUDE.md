# CLAUDE.md — Schema Version Control

## What this is
Web app: version control for database schemas — branch a schema,
evolve it independently, diff the branches, and merge back with
conflict detection. Row data is out of scope; the schema itself
(tables, columns, types, constraints) is the versioned artifact.
Timebox: 5 days to a deployed URL. Scope decisions follow from that.

## Commands
All from repo root (npm workspaces: engine/, server/, client/):
- `npm run dev` — server (:3000) + client (:5173, proxies /api)
- `npm test` — Vitest across packages (`npm run test:watch` to watch)
- `npm run typecheck` — tsc --noEmit in every workspace
- `npm run lint` — ESLint (flat config at repo root)
- `npm run build` — client production bundle → client/dist
- `npm start` — production server; serves client/dist when
  NODE_ENV=production

## Working agreement — IMPORTANT
- I make every meaningful decision: architecture, scope, product, UX.
  Your job: lay out all realistic options with plain tradeoffs — what
  each costs, what it buys, where it breaks — then stop and wait for
  my pick. If a decision surfaces mid-task, pause and ask. NEVER
  choose for me.
- Once a decision is made, implementation is yours. Small details
  inside an agreed structure (naming, file layout) don't need approval.
- I'm strongest on frontend. Before building backend or algorithm
  pieces, explain the approach in plain language — short sentences,
  an analogy if it helps — so I can verify it and defend it later.
  Nothing ships that I can't explain.
- Work in small steps. Before any multi-file change, show a short
  plan and wait for my go.
- At session start, read PLAN.md to see where we are.
- If our working rules change, update this file so the next session
  knows.

## Decision state
- Made decisions live in decisions.md (repo root) — read it when you
  need history or context. If it's not there, it wasn't decided.
- Still OPEN — never assume these, always ask me:
  1. Schema input: visual editor vs paste-SQL vs JSON import.
  2. Diff approach: snapshot comparison + rename heuristics + user
     confirmation vs recorded edit operations vs hybrid.
  3. Feature tiers: in (tables, columns, types, nullability, primary
     keys, foreign keys?) / cut (triggers, views, multiple dialects?).
  4. Merge output: merged schema only vs also migration SQL.
  5. Branch model: main → branch → merge back only? No nesting or
     rebase?
- When one resolves: full entry in decisions.md, then delete it from
  this list.

## decisions.md format
Every meaningful decision gets logged there as it happens: the
decision / the alternatives seriously considered / the reasoning and
accepted tradeoffs / what was deliberately cut and why. Specific
beats generic. Weak: "Chose a visual editor because it's simpler."
Strong: "Chose a visual editor over SQL parsing for input because
parser edge cases would eat two of five days; accepted that existing
schemas can't be imported yet; kept parsing as a stretch goal."

## Engineering rules
- Core engine (schema model, diff, merge) = pure functions, no UI or
  framework imports, testable in isolation.
- Code a teammate could pick up cold. SOLID as a smell check — single
  responsibility, clear interfaces, no god objects — but no
  speculative abstraction: introduce a design pattern only when the
  problem visibly calls for it, and say which one and why. Simple
  functions beat clever indirection.
- Tests must catch real failures. The kind that matter here:
  apply(diff(A,B), A) equals B; merging branches that touched
  different things equals both changes applied; conflict detection
  gives the same answer regardless of branch order.
- Validate every external input: pasted SQL or JSON, request bodies.
- IMPORTANT: no new dependency without asking — name it, why it's
  needed, one alternative.
- Never invent APIs. Unsure something exists → check docs or say so.
- No secrets in the repo. .env locally, .env.example committed.

## Definition of done — every task
1. Tests green; typecheck and lint clean. Run them yourself before
   reporting done.
2. NOTES.md: append a short plain-language explanation of what was
   built and why it's shaped that way.
3. decisions.md: entry exists for any decision made along the way —
   remind me if one is missing.
4. PLAN.md: tick or update the task.
5. Tell me it's commit time and suggest a message per the commit
   convention in CONTRIBUTING.md. NEVER run git commit — I commit
   myself.

## UX bar
- No blank first run — seed an example schema.
- Design empty states and error messages, not just the happy path.
- Diff and merge-conflict views must be readable at a glance; that IS
  the product.
