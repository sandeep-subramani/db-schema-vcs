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
- [x] Empty commits refused (decisions.md #28) — a branch whose schema
      hadn't changed could still be committed, and the entry then
      opened on "No schema changes". Now the server diffs the incoming
      snapshot against the branch tip (engine `diffSchemas`, so a pure
      reorder counts as unchanged per #18) and refuses with 400 before
      writing anything; the Commit… button greys out under the same
      rule, with a hint naming which case it is. Merge commits are
      exempt — they carry the base advance of #20. Supersedes #25's
      "UI guard only" cut: an empty first commit is now refused by the
      API too
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
- [x] First-commit gate: door cards with glyph tiles and a centred
      wider grid, mono branch name in the heading, and a new
      line-ring-pill drawing under the doors naming the commit that
      doesn't exist yet. Shared chrome caught up too — gem + avatar in
      the top bar, quiet Undo, group rules, wrapping bar, branch chip
      with a live dot, History count badge. The reference's
      full-strength `Commit…` was not copied: it's disabled here
      (decisions.md #25)
- [x] Schema editor (both states): column grid in a rounded panel with
      a tinted header strip and drawn checkboxes, mono identifiers,
      primary key + add-column on one row, dashed rule before foreign
      keys; sidebar rows with a branch-line tick and a card for the
      add-a-table form; dashed SUGGESTED STARTERS rows on an empty
      schema (the one approved behaviour change — they reuse the Add
      table path); dashed-card glyph on the empty worktop; toast
      restyled as a panel lozenge with an amber dot
- [x] Editor dialogs: one shared shell for all eight (blurred
      overlay, radius-16 panel, 600/700/620 widths, warn/danger glyph
      tile beside the title, prompt fields with the login focus halo,
      recessed paste areas, `::file-selector-button` file row,
      right-aligned action row). Delete-table confirm shows its
      cascade as tinted danger callouts with a mono `−`; Share became
      avatar + mono handle + role pill cards with a violet-tinted Add
      member. OverwriteDialog has no reference but took the amber
      glyph as a sibling warning. Not copied: the reference sets the
      identifiers inside a collateral line in mono — the engine emits
      those lines as finished sentences (NOTES.md)
- [x] Remaining views (diff / commit detail, history rail, merge in
      every state, compare, repo error, pending-merge banner): shared
      screen header with mono side-coloured branch names; table cards
      on a solid panel base with a corner wash instead of a flat fill;
      mono identifiers and amber `±`; rename question as a violet-lit
      sheet; merge conflicts with a ringed `!`, a drawn VS divider,
      violet (not green) for the kept side, amber blocked status and a
      tinted-not-dimmed Apply; conflict reasons set their quoted
      identifiers in mono (safe here — every quoted run the engine
      emits is an identifier, unlike the dialogs-pass collateral
      lines); compare as one FROM/TO sheet with visually-hidden field
      labels; history commits as branch-line cards. The stale-save
      dialog needed nothing — verified against a live conflict, not
      assumed
- [x] Merge view, second pass — reference reshapes it as a branch
      graph: one spine down from a BRANCH POINT marker with each side's
      cards hung off it, a table both branches touched sharing a rung,
      conflicts collapsed to one compact row with the two picks inline.
      Needed one new tested pure function (buildMergeTimeline in
      client/src/diff/view-model.ts, 5 tests) to zip the two sides'
      cards into rungs and record which conflicts touch each table —
      approved mid-task, the only step past JSX-and-CSS in the whole
      redesign. Rungs carry conflict ids rather than a flag so a
      settled conflict stops showing red
- [x] Dropdowns: every native `<select>` replaced by one in-house
      listbox (`client/src/components/Select.tsx`) — same panel,
      border and violet tick as the theme and account popovers, since
      the OS drew the old lists as a white slab no CSS could reach.
      All eight call sites: column type (row + add form), both foreign
      key pickers, branch switcher, Compare's from/to branch and
      commit, new-branch "Starting from". The list portals into
      `<body>` to escape the columns table's overflow clip and flips
      above the trigger when there's no room below. Full keyboard
      parity with a native select (arrows, Home/End, PageUp/Down,
      Enter, Escape, type-ahead) plus combobox/listbox roles. Also new:
      `ColumnTypeIcon.tsx`, seventeen hand-drawn glyphs — one per
      column type, on the closed control as well as in the list, with
      variants of one idea sharing a glyph and differing by a corner
      badge. This is the second step past JSX-and-CSS in the redesign
      (a native select can't be restyled into a popover), approved
      before the work; decisions.md #32
- [x] Identity menu: `Switch user` (was repo-list-only) and `My repos`
      (was the repo screen's top-left `← Repos`) moved into a popover
      under the top-right identity chip, separated by a hairline. Both
      are now reachable from every view in a repo, since the top bar
      renders above all of them; on the repo list `My repos` shows
      disabled and tagged `Current`. Both go through the existing
      `guardDirty` → `UnsavedDialog`, so unsaved edits get the same
      Save / Discard / Cancel choice as a branch switch. The two logic
      changes (App's `switchUser`, RepoScreen's `onSwitchUser` prop)
      were approved before the work
- [x] Repo home: the latest-commit headline card is now clickable and
      opens that commit's diff against its predecessor — the same
      DiffView a History row opens, with `← Repo home` as the way
      back. Partly reverses the "latest commit's contents" cut in
      decisions #27 (the home still doesn't render the diff, it only
      links to it). One new prop
      (`onOpenLatestDiff`) reusing RepoScreen's existing `diffTarget`
      state; approved before the work
- [x] Repo home / editor entry doors consolidated behind one `Edit`
      button, and the commit dialog names its destination. The home's
      `Open in editor` plus the top bar's `Import JSON` / `Import SQL`
      / `Export JSON` were four ways out of one screen; now `Edit`
      (right-aligned beside the repo name, where `Open in editor` was)
      opens the first-commit gate on demand, and its three doors are
      the only route to the editor and both importers. The gate takes
      a second copy set for a branch that already has a schema
      ("Change the schema on X", "Replace from JSON/SQL", no
      first-commit ring, no example-schema shortcut, plus a
      `← Back to the repo home` link the automatic gate doesn't get).
      Export JSON now lives only on the home's rail. The commit
      dialog's submit button reads `Commit into <branch>` instead of
      `Commit` — no branch picker, since committing onto another
      branch would overwrite its working state with a schema never
      based on it. Two view-state flags and one prop rename; the
      commit path itself is untouched. Approved before the work,
      including the drop of the branch-picker idea — needs a
      decisions.md entry
- [x] Undo scoped to the views that can use it. The top-bar `Undo` was
      on every screen, disabled on most; it now renders only in the
      editor and on the repo home — the two views showing the working
      schema, which is the only thing the undo stack holds. Hidden on
      the entry doors, commit/working diffs, Compare and Merge, and its
      separator hairline hides with it. `Ctrl/Cmd+Z` is gated to the
      same views, which fixes a real bug: in Compare and Merge the
      shortcut reverted an edit with nothing on screen to show it, and
      in a diff it rewrote the diff being read. The empty-stack case
      was always a harmless no-op. First logic change of the restyle
      (a guard on the keydown effect, plus three derivations hoisted
      above the `loadError` early return so the hook stays
      unconditional) — approved before the work; decisions.md #30
- [x] Editing a merge before committing it. The pending-merge banner's
      phrase "adjust in the editor" is now a link that opens the editor
      on the merged working state, and while a merge is pending the
      repo home's `Edit` goes straight to the editor instead of the
      entry doors (whose `Replace from JSON/SQL` would have discarded
      the merge). No state change was needed — the merged schema is
      already the branch's working state, and `doCommit` commits what's
      on screen with the merge marker, so adjustments land inside the
      merge commit. Second logic change of the restyle (one handler
      that clears view flags, one conditional callback) — approved
      before the work; decisions.md #31
