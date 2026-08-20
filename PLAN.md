# PLAN.md — 5-day build plan

Living file. Tick tasks as they finish; re-scope freely, but any real
scope change gets a decisions.md entry.

## Human-only tasks
- [x] GitHub repo
- [ ] Hosting account + deploy authorization (after stack decision)

## Day 0 — decisions & scaffold
- [ ] Resolve open decisions 1–5 (list in CLAUDE.md): options laid
      out, my pick, each logged in decisions.md
- [x] Decision 6 (stack/deploy/tests) — decisions.md #2: Vite+React+TS,
      Express 5, Render + managed Postgres, Vitest
- [x] Scaffold the app per stack decision; fill the Commands section
      in CLAUDE.md
- [ ] First deploy (hello world) so the pipeline exists from day one

## Day 1 — schema core
- [ ] Schema model: tables, columns, types, constraints (per tier
      decision)
- [ ] Schema input per decision (editor / SQL / JSON) + seed example
      schema
- [ ] Create branch + switch branch (minimal model)

## Day 2 — diff engine
- [ ] Diff per decided approach, including the rename-detection path
- [ ] Engine tests: apply(diff(A,B), A) equals B, and friends
- [ ] Diff view v1 in the UI

## Day 3 — merge
- [ ] Three-way merge: auto-merge changes that don't overlap
- [ ] Conflict detection: same column retyped both sides, rename
      collisions, FK added to a table the other branch dropped
- [ ] Merge / conflict-resolution UX v1 + tests

## Day 4 — product pass
- [ ] First-run experience, empty states, human error messages
- [ ] Readability polish on diff and merge views
- [ ] Stretch (only if everything above is green): migration SQL
      output or SQL import — whichever was deferred

## Day 5 — ship
- [ ] README: setup that works in one shot, short architecture sketch
- [ ] decisions.md full read-through: specific, honest, complete
- [ ] Fresh-clone setup test + smoke test of the deployed URL
- [ ] Buffer for whatever slipped
