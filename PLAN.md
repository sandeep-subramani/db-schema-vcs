# PLAN.md — 5-day build plan

Living file. Tick tasks as they finish; re-scope freely, but any real
scope change gets a decisions.md entry.

## Human-only tasks
- [x] GitHub repo
- [x] Hosting account + deploy authorization (Render, Singapore)

## Day 0 — decisions & scaffold
- [ ] Resolve open decisions 1–5 (list in CLAUDE.md): options laid
      out, my pick, each logged in decisions.md
- [x] Decision 6 (stack/deploy/tests) — decisions.md #2: Vite+React+TS,
      Express 5, Render + managed Postgres, Vitest
- [x] Scaffold the app per stack decision; fill the Commands section
      in CLAUDE.md
- [x] First deploy (hello world) — https://db-schema-vcs.onrender.com
      (Singapore, health check /api/health, md-only commits ignored)

### Render notes (from Advanced settings, for later)
- Build command is `npm ci --include=dev && npm run build && npm
  prune --omit=dev` — NODE_ENV=production makes npm skip
  devDependencies (vite), so include them for the build, prune after.
- Set at creation: health check `/api/health` (verifies deploys;
  does NOT keep free tier awake), build filter ignoring `**/*.md`
  (docs-only commits shouldn't trigger builds).
- Pre-deploy command = run Postgres migrations before new code
  boots; paid-only. On free tier: migrate on server boot instead.
- Auto-deploy "after CI checks pass" needs a GitHub Actions
  workflow running our checks — stretch item, day 4–5 if time.

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
