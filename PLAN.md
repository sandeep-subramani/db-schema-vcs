# PLAN.md — 5-day build plan

Living file. Tick tasks as they finish; re-scope freely, but any real
scope change gets a decisions.md entry.

## Human-only tasks
- [x] GitHub repo
- [x] Hosting account + deploy authorization (Render, Singapore)

## Day 0 — decisions & scaffold
- [x] Resolve open decisions 1–5 (list in CLAUDE.md): options laid
      out, my pick, each logged in decisions.md (#3–#7)
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
- [x] Schema model: tables, columns, types (own generic vocabulary,
      decisions.md #9), nullability, text length, unique constraints
      (decisions.md #10), primary keys (table-level), foreign keys
      pointing at any solely-unique column (decisions.md #3, #10);
      snapshot format tolerates missing fields, diff = list of typed
      changes (diff part lands day 2)
- [x] Schema input: visual editor + JSON import/export
      (decisions.md #4) + seed example schema
- [x] Persistence + multi-user base (decisions.md #12, #13): Postgres
      tables via boot-time migration runner; users (username-only
      identity, no auth), repos, members
- [x] Branching + history (decisions.md #7, #16): create branch from
      any branch with a commit (git semantics: split at last commit,
      carry saved changes), switch branch, explicit commit with
      message onto explicitly-saved working state (save model:
      decisions.md #15)
- [x] First-commit gate page for new repos: JSON upload / visual
      editor / SQL import disabled with "coming soon" tag; "Load
      example schema" button replaces auto-seed (decisions.md #14)

## Day 2 — diff engine
- [x] Diff: snapshot comparison + rename heuristics + user
      confirmation (decisions.md #5), incl. the rename-detection path
- [x] Engine tests: apply(diff(A,B), A) equals B, and friends
      (+ applyDiff itself — needed by day-3 merge, not just tests)
- [x] Diff view v1 in the UI (decisions.md #19): commit-click diff +
      "Review changes" (working vs last commit), client-side diff,
      table-card grid + rename-question banner (ephemeral answers),
      branch-point marker row, GET /commits/:id endpoint

## Day 3 — merge
- [ ] Three-way merge: auto-merge changes that don't overlap
- [ ] Arbitrary version picker — committed scope, not skippable
      (decisions.md #19): any commit vs any commit incl. cross-branch,
      reusing the card grid; label/restrict unrelated pairs
- [ ] Conflict detection: same column retyped both sides, rename
      collisions, FK added to a table the other branch dropped,
      unique removed while the other branch adds an FK targeting it
      (decisions.md #10)
- [ ] Merge / conflict-resolution UX v1 + tests

## Day 4 — product pass
- [ ] First-run experience, empty states, human error messages
- [ ] Readability polish on diff and merge views
- [ ] Paste-SQL import — committed scope, no longer stretch
      (decisions.md #8): parser lib needs dependency approval;
      dialect type audit + mapping rows per decisions.md #9
- [ ] Stretch roadmap, in priority order (decisions.md #3, #4):
      1. migration SQL output (decisions.md #6 — stretch only)
      2. column defaults, indexes (~2–4h each, additive; single-col
         unique already in committed scope, decisions.md #10)
      3. composite unique constraints, UNIQUE(a, b) — needs a
         table-level constraint list, likely pairs with composite
         FKs (decisions.md #10)
      4. editor-operation rename hints layered on snapshot diff
         (decisions.md #5) — re-rank if it should sit higher
      5. update-branch-from-parent merge direction (decisions.md #7)
         — engine reused, cost is base-advance bookkeeping + tests

## Day 5 — ship
- [ ] README: setup that works in one shot, short architecture sketch
- [ ] decisions.md full read-through: specific, honest, complete
- [ ] Fresh-clone setup test + smoke test of the deployed URL
- [ ] Buffer for whatever slipped
