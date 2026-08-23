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
- [x] Three-way merge engine: auto-merge changes that don't overlap,
      agreements apply once, pick-a-side conflicts in grouped bundles
      (decisions.md #20), rename questions per side, 48 tests incl.
      symmetry + every-resolution-combination-validates
- [x] Conflict detection: same column retyped both sides, rename
      collisions, FK added to a table the other branch dropped,
      unique removed while the other branch adds an FK targeting it
      (decisions.md #10), retype-vs-length (#9), nullable-vs-PK —
      all in the engine test catalogue
- [x] Merge API + flow (decisions.md #20): git-strict preconditions,
      landing in parent working state, merge-commit + base advance in
      one transaction (merge-context read endpoint + marker on the
      commit endpoint; engine runs client-side per #19)
- [x] Merge / conflict-resolution UX v1 (compose two card grids,
      pick-a-side conflict cards, rename-question banner reuse,
      pending-merge banner on the parent with prefilled merge commit)
- [x] Arbitrary version picker — committed scope, not skippable
      (decisions.md #19, #21): any commit vs any commit incl.
      cross-branch, reusing the card grid; unrelated pairs labeled,
      rename questions suppressed there

## Day 4 — product pass
- [x] First-run experience, empty states, human error messages —
      full browser audit (gate, empty states, import errors,
      duplicate names, stale saves: all already human); both open
      decisions resolved: Commit… disabled-with-hint on the empty
      gate (decisions.md #25), repo/branch names stay length-checked
      only (#26)
- [x] Readability polish on diff and merge views — audit found one
      defect: long change lines in narrow cards orphaned the +/− mark
      and lost their indent when wrapping; fixed with a hanging-indent
      line structure shared by diff, compare, and merge conflict
      cards. Bonus bug fixed on the way: Compare's commit pickers
      stuck on "loading…" (fetch result discarded on unmount while
      the in-flight marker blocked the refetch)
- [x] Paste-SQL import — committed scope, no longer stretch
      (decisions.md #8): pgsql-ast-parser approved by measurement
      (#23), Postgres type audit + auto-number family + FK twin rule
      (#24), splitter + translator + skip-list preview dialog, gate
      door enabled; 205 tests incl. pg_dump fixture
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

## UI redesign (branch ui-redesign, view by view)
- [x] Global look: token flip (violet accent, near-black ground,
      magenta branch color, dark rounded app frame), Space Grotesk
      webfont, primary buttons as solid fills
- [x] Login page: two-column hero (branch/merge diagram + feature
      lines) with the claim card on the right; refinement pass added
      the input focus halo, the "You'll appear as" identity preview
      that hops in while the field has content, and a non-selectable
      showcase column
- [x] Theme switcher: popover with Dark / Light / System preview
      cards (replaces the placeholder cycling button)
- [x] Repo listing (both states): wider two-column body — repo cards
      left, identity rail right — mono repo names with a go arrow,
      count pill beside the heading, top-bar gem + avatar chip, and a
      dashed empty-state card carrying a small branch-graph glyph.
      Branch pills and the RECENT ACTIVITY rail in the reference were
      dropped on purpose: both need data the client doesn't have
      (see NOTES.md), so this pass stayed presentation-only
- [ ] Remaining views, one reference image at a time
