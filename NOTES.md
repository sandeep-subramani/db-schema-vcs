# NOTES.md — how this thing works, in plain language

Running log. After each significant piece is built, a short entry
lands here: what it does, how it works in everyday words, and why
it's shaped that way. This is the file to reread before explaining
the project to anyone.

Entry format:
- **[date] Component** — what it does / how it works / why this shape.

---

- **[2026-08-20] Project scaffold** — Three-package npm workspace:
  `engine/` (the future diff/merge brain — pure TypeScript functions,
  no framework imports, so it can be tested like math), `server/`
  (Express 5, owns the API and, in production, serves the built
  frontend so everything lives on one host with no CORS), `client/`
  (Vite + React; in dev it proxies /api calls to the server so both
  halves feel like one app). The server boots with or without a
  database: if DATABASE_URL is set it connects to Postgres, otherwise
  /api/health honestly reports "not_configured" — this lets
  hello-world deploy before any database exists. The landing page
  calls /api/health and shows a green "server is up" line, or a
  friendly red line telling you how to start it if it can't be
  reached. Why this shape: the engine-in-its-own-package rule is
  enforced by structure, not discipline — the UI physically can't
  leak into the diff/merge logic without it being obvious.

- **[2026-08-22] Schema model + validation** — The engine now defines
  what a schema *is*: tables holding columns (name, type from our own
  generic vocabulary, nullable flag, optional text length), a
  table-level primary-key column list (so composite keys work), and
  foreign keys (own column → target table.column). One function,
  `validateSchema`, is the bouncer at the door: it takes unknown JSON
  and returns either a trusted, normalized schema or a list of
  human-readable errors naming the exact table/column at fault. It
  checks in two passes — structure first (right shapes, types from
  the vocabulary, length only on text), then semantics (duplicate
  names, PK columns that exist and aren't nullable, FKs that point at
  a real primary-key column of matching type) — and semantic messages
  can therefore assume well-formed data. Missing optional fields are
  tolerated (absent nullable = false, absent PK/FK = feature unused),
  which is the forward-compatibility promise from decisions.md #3;
  unknown fields are rejected so a typo like "nullible" errors
  instead of silently dropping a constraint. Why this shape: every
  later piece (editor, storage, diff, merge, SQL import) either
  produces or consumes this one validated format, so correctness
  checks live in exactly one place.

- **[2026-08-22] Unique constraints + corrected FK rule** — Columns
  gained a `unique` boolean (stored only as true; "false" is
  normalized to absent so every snapshot spells "not unique" one
  way, which keeps the diff simple). The foreign-key rule was
  replaced with what real databases enforce: an FK target must be
  unique *by itself* — the target's whole primary key being exactly
  that column, or the column marked unique. The old FK-must-target-PK
  rule was wrong twice over: it forbade the legitimate pattern of
  referencing a unique column like users.email, and it quietly
  allowed pointing at one column of a composite primary key, which
  doesn't identify a row (real databases reject that). Error
  messages distinguish the two failure modes so the fix is obvious.
  Why now: unique is nullable's structural twin, so it cost ~45
  minutes and proves the "extensions are additive" design promise
  from decisions.md #3.

- **[2026-08-22] Visual schema editor + JSON import/export + seed** —
  The app now opens on a real editor instead of a health check: a
  seeded web-shop schema (users, products, orders, order_items —
  chosen because it exercises every model feature: composite PK,
  FKs, a unique non-PK column, text lengths, a nullable column).
  Layout is master–detail: tables in a sidebar, the selected one
  edited in a grid — name, type dropdown (our own vocabulary), PK /
  nullable / unique checkboxes, text length, plus a foreign-key
  section whose target dropdown only ever offers legal targets
  (same type, unique on its own). That's the "invalid input is
  structurally impossible" promise from decisions.md #4: dropdowns
  and checkboxes can't spell a broken schema, and the two toggles
  that could combine illegally (PK + nullable) disable each other.
  Every edit is a pure function in `client/src/schema/edits.ts`
  that takes the current snapshot and returns a new valid one;
  destructive edits also return a plain-language list of collateral
  (foreign keys they had to remove), which the UI shows in a
  confirm dialog *before* applying — and because snapshots are
  immutable, an undo stack (Ctrl/Cmd+Z + a toast with an Undo
  button) is just keeping the old ones. One sweep function
  re-checks all FKs after any edit using the same rules as the
  engine validator, so there's a single place that decides what a
  broken FK is; the tests assert every edit's output re-validates.
  JSON import runs the engine's `validateSchema` and shows its
  errors verbatim; export is the exact stored snapshot format, so
  import(export(x)) is trivially x. The schema lives only in client
  memory for now — the branching task (next) owns server-side
  persistence, so nothing temporary was built (decisions.md #11).

- **[2026-08-22] Persistence + users/repos + branching & commits** —
  The app became multi-user and permanent in one move. Server side,
  three layers. (1) A ~60-line migration runner: numbered `.sql`
  files build the app's own Postgres tables at every boot, tracked in
  a bookkeeping table so each runs once — the filing cabinet builds
  its missing drawers before anything gets filed, identically on a
  laptop and on Render (decisions.md #12). (2) `store.ts`, the only
  file that talks SQL. Every repo-scoped function takes the acting
  username and does the membership check inside its own query — there
  is no unscoped variant to call by mistake, and "not found" and "not
  yours" are the same null so repo ids can't be probed. The staleness
  guard is one integer: a save says "I loaded rev N", the UPDATE only
  lands if the row still is rev N, and a miss returns who saved and
  when (decisions.md #15). Commit reuses that same save inside a
  transaction and stamps the snapshot into `commits` — save and stamp
  can't be split by a concurrent writer. Branching follows git
  (decisions.md #16): the source needs a commit, the new branch
  splits at that latest commit (which is copied in as its first
  history entry and stored as the merge base of decisions.md #7),
  and the source's saved-but-uncommitted changes carry over into the
  new branch's working copy — like git carrying your dirty working
  tree through `git switch -c`, so pending work can be committed on
  the branch it belongs to. (3) `api.ts`, the boundary: parses ids,
  names, revs,
  runs every incoming snapshot through the engine's `validateSchema`,
  and maps store results to honest status codes and human error
  messages. Client side, three screens with no router (who you are ×
  which repo is open, both remembered in localStorage): the username
  gate (identity = a claimed name sent as a header on every call —
  no cookies, decisions.md #13), the repo list (+ New repo up top),
  and the repo screen — branch bar, the existing editor, and a
  history panel. Dirty is "the schema object on screen is not the
  object we last saved" (snapshots are immutable, so reference
  equality is exact — undo back to the saved one and you're clean
  again). Saving, switching with unsaved edits, committing, and the
  someone-saved-first case each get their own dialog; tab close with
  unsaved edits triggers the browser's native prompt, and nothing
  auto-writes, ever (decisions.md #15). A brand-new branch with no
  commits and no tables opens on the first-commit gate — editor /
  JSON / disabled "coming soon" SQL door, example schema one explicit
  click away (decisions.md #14). The whole flow was driven end to end
  in a real headless browser (screenshots in the session log) on top
  of 75 unit/API tests against real Postgres. A multi-agent
  adversarial review then hardened the edges: ids/revs are capped at
  Postgres's integer range and names reject NUL bytes and broken
  unicode (so no "valid" input can 500 a save), oversized bodies get
  an honest 413, branch loads carry a ticket so a slow response can
  never put one branch's schema on screen labeled as another, undo is
  frozen while any dialog is up, and every way of leaving unsaved
  edits — including creating a branch from a different source — asks
  save/discard/cancel first.

- **[2026-08-23] Diff engine (`diffSchemas` + `applyDiff`)** — The
  diff compares two schema snapshots the way you'd compare two
  printed pages side by side: tables matched up by name, then columns
  inside them, and every difference becomes one typed change ("column
  email: maxLength 255 → 500"). The tricky part is that a snapshot
  can't tell a rename from a drop-plus-add — both leave the same two
  pages. So dropped and added things are scored against each other
  (name similarity via edit distance, same type, same shape): a pair
  that matches on everything and has clearly similar names becomes a
  rename automatically; a plausible-but-unsure pair becomes a
  *question* the UI asks the user; a poor pair stays an honest
  drop+add. Crucially, the change list is a complete recipe even
  while questions are open (pending pairs ride as drop+add), and
  answers flow back in as plain data — `diffSchemas(A, B, decisions)`
  — keeping the engine a pure function. Confirmed renames cascade
  like they do in a real database: primary keys and foreign keys that
  point at the renamed thing follow it silently instead of showing up
  as fake changes. `applyDiff` is the other half: it replays a change
  list onto a schema, and the test suite's core guarantee is
  apply(diff(A,B), A) equals B — for every scenario, whichever way
  each rename question was answered, in both directions. `applyDiff`
  isn't a test helper: three-way merge (day 3) is "diff both branches
  against the base, keep what doesn't collide, apply it" — this is
  the apply in that sentence. Deliberate limits: renames are only
  detected within one table (a column moving between tables is a
  drop+add), a rename that also changed type/shape always asks rather
  than auto-matches, and column order is not versioned — reordering
  produces an empty diff.

- **[2026-08-23] Diff view v1** — The diff engine got its screen
  (decisions.md #19). Two entry doors: click any commit in the history
  panel to see what it changed against the commit before it, or the
  new "Review changes" button in the branch bar to see what the schema
  on screen changed since the last commit — the look-before-you-commit
  moment. Both render the same way: every affected table is a card.
  An added table is one whole green card, a dropped table one whole
  red card (every column, key and foreign key it took with it), a
  changed table lists just its changes as marked lines ("± total —
  Now nullable"), a renamed table wears a "was <old name>" badge, and
  tables nothing happened to shrink to a single "Unchanged: …" line so
  they never drown the signal. When the engine isn't sure whether
  something was renamed or dropped-and-replaced, a banner above the
  cards asks in plain words ("In users: was email renamed to
  contact_email?") — answering re-draws the diff on the spot, no
  network involved, because the diff is computed in the browser by the
  same engine the tests run; the server's only new part is one
  endpoint that hands over a commit's stored snapshot (members only,
  like everything). Answers are deliberately throwaway: they shape the
  view you're looking at and vanish with it. One honest edge: a
  branch's first commit is the copied split-point (#16), where nothing
  was authored, so its row wears a "branch point" badge and opens a
  marker page pointing at the parent instead of pretending the whole
  inherited schema was "added". The card grid itself is a dumb
  component fed by a pure view-model module (tested against the real
  engine diff, not hand-built change lists) — day-3 merge composes two
  of these side by side without touching it. Verified end to end in a
  headless browser: question asked and answered, working review with a
  dropped table, first-commit-vs-empty, and the branch-point marker —
  zero console errors.

- **[2026-08-23] Merge engine (`mergeSchemas`)** — The three-way merge,
  pure functions like the rest of the engine. Picture two people
  marking up photocopies of the same original page: you don't compare
  the copies to each other, you hold each against the original and
  list what each person changed. The original is the branch-point
  snapshot we stored when the branch was created (decisions.md #7), and
  the listing is `diffSchemas` run twice — rename questions included,
  each labeled with the side it came from, and answered first because
  an unanswered rename still reads as drop+add. Then every change is
  sorted three ways: touching different things → both apply; the same
  change on both sides → applies once (agreement, not conflict); the
  same thing changed differently → a conflict the user resolves by
  picking a side. "Differently" includes combinations only the
  validator would catch: an FK added to a table the other side
  dropped, unique removed under a new FK (with the honest exception:
  no conflict if the target's sole primary key still justifies the
  FK), a column retyped away from text while the other side set a text
  length (decisions.md #9's case), nullable-vs-primary-key, and rename
  collisions. Colliding changes are bundled into connected groups so
  one pick decides each tangle — and because each side's list came
  from a valid schema, any combination of picks yields a valid schema
  (a test literally tries every combination). To compare "the same
  thing" across sides, both change lists are respelled into the base's
  names first; to build the result, survivors are respelled again
  through both sides' surviving renames and replayed with `applyDiff`
  (renames first), so an edit from one side lands on a column the
  other side renamed — references follow the object, decisions.md #17.
  The merged schema runs through `validateSchema` before anyone sees
  it; the suite also pins symmetry (swap the sides: same conflicts,
  mirrored) and that untouched-side merges equal the touched side.
  48 tests. The API/UX flow around this (working-state landing,
  git-strict inputs, base advance — decisions.md #20) is the next
  step; nothing server-side changed yet.

- **[2026-08-23] Merge flow: API + screen, and the version picker** —
  The merge math existed after the last entry; this wires it into the
  product. Words used below: a branch's *working state* is its desk
  copy — the schema as it currently stands, saved but not yet stamped
  into history; its *tip* is its newest commit; its *base* is the
  snapshot stored on the branch at creation, the version both sides
  split from; a branch is *clean* when its desk copy equals its tip.
  The server grew exactly two things. First, one read:
  `GET /branches/:id/merge-context` returns in a single request
  everything a merge needs — the base, both branches' tips, and both
  desk copies (with the revision numbers a later save must quote).
  The merge itself runs in the browser, like the diff (#19), so
  answering a rename question or picking a conflict side updates the
  screen instantly. Second, the commit endpoint accepts an optional
  *merge marker*: two ids saying "this commit finishes a merge — this
  branch was merged in, and this commit of it is what was merged".
  Why it exists: to the server, the commit that finishes a merge
  looks like any ordinary commit, and the marker is how the client
  asks for the merge bookkeeping — inside the same database
  transaction as the commit, the merged branch's stored base is moved
  forward to the merged commit's snapshot. Why the base must move:
  after feature merges into main, feature's changes live in main; if
  feature's base stayed at the old branch point, the next merge would
  measure from there and re-report — maybe re-conflict — work already
  merged once. Moving it means the next merge sees only new work (a
  test merges and immediately re-merges: nothing found). One
  transaction means history can never say "merged" while the base
  stayed behind. A marker whose ids don't check out (branch not a
  direct child; commit not on it) rejects the whole commit with a
  plain 400 and writes nothing. The screen follows #20: "Merge into
  main…" sits on the branch being merged. It first requires both
  branches clean — checked with the diff engine, so a pure column
  reorder still counts as clean (#18) — and shows a full-screen
  pointer to Commit (or to the parent branch) when they aren't.
  Then: rename questions labeled with the branch they're about; each
  conflict as a card — the clash named in a sentence, both sides'
  changes listed with table-qualified names, one keep-this-side
  button per group — and two side-by-side card grids (the day-2 diff
  components, reused unchanged) showing what each branch changed
  since the split. Apply merge does not commit: it saves the merged
  schema as the parent's desk copy and moves you there, where a
  banner offers Review changes (the existing diff), Commit merge…
  (message prefilled; the commit carries the marker — as does any
  commit made while the banner is up, even after hand edits, which
  are the intended escape hatch), and Abandon (puts the last
  committed schema back on screen as an ordinary undoable edit;
  saving stays your explicit act, #15). The pending merge is browser
  memory only: it survives switching branches and back; a reload
  loses it — #20's accepted corner, nothing corrupts, a later merge
  may just re-ask rename questions. The Compare screen (#19/#21) is
  the same card grid behind two branch+commit pickers: any commit vs
  any commit. When the two sit on one line of history (same branch,
  or one branch an ancestor of the other), every diff line is an
  edit someone actually made, and rename questions work as usual.
  When they don't — sibling branches, say — the versions were built
  independently: the differences are real but no one performed them
  as edits, so a banner says so, and rename questions are off
  (they'd ask about an action nobody took); renames there show as
  plain dropped + added. Relatedness is a cheap walk up the stored
  parent pointers. Verified: 173 tests green (new: the merge API
  round trip including rejected markers and stale saves; the
  branch-relatedness walk), plus a scripted end-to-end run against a
  real server and database: conflict → resolve → land on the parent →
  merge commit → base moved → re-merge finds nothing.

- **[2026-08-23] Paste-SQL import (Postgres)** — The third door on the
  gate page is now real: paste `CREATE TABLE` statements or a whole
  `pg_dump --schema-only` file, preview, import. Words used below: a
  *parser* turns SQL text into a structured tree (the way a browser
  turns HTML text into elements); the *translator* is our code that
  walks that tree and fills in our own snapshot shape; the *skip list*
  is the report of everything in the paste we chose not to carry over.
  The parser is a library, `pgsql-ast-parser` (decisions.md #23) — we
  measured it against every common DDL form before adopting it. The
  translator (engine/src/sql-import.ts, pure function, engine-side)
  consumes exactly three statement kinds — CREATE TABLE, ALTER TABLE
  ADD CONSTRAINT, ALTER TABLE ADD COLUMN — and everything else becomes
  a skip-list line with a plain reason ("indexes aren't versioned
  yet"), never a failed import. That resilience comes from splitting
  first: our own splitter (sql-split.ts) cuts the paste into
  statements while respecting strings, comments, and dollar-quoted
  bodies, so each statement parses alone and one unreadable statement
  costs one line, not the paste. Two Postgres habits needed special
  care. First, pg_dump never writes the word `serial` — it writes a
  plain integer column plus a separate "fill this from a sequence"
  default; the translator recognizes that pattern (and the newer
  GENERATED AS IDENTITY form) and upgrades the column to the new
  "Auto number" type (decisions.md #24). Second, real schemas point
  plain-integer foreign keys at serial primary keys, so the validator
  learned one compatibility: a whole number may reference its
  auto-number twin of the same width — nothing else changed. Types
  map through a fixed table (#9's audit, logged in #24): equal types
  map, near-misses don't — a column whose type has no home (jsonb,
  char(n), real, interval, arrays, custom types) is skipped with a
  reason while its table still imports, and any key that leaned on a
  skipped column is dropped loudly, not silently. The import screen
  enforces see-then-accept: Import only arms after Preview, which
  shows table/column counts and the grouped skip list. The output
  passes the same validateSchema gate as JSON import and lands the
  same way (working state, undoable, not saved). Verified: 205 tests
  green — splitter edge cases, the full type table, FK resolution
  across statement order, dropped-key reasons, and a realistic
  pg_dump fixture asserting both the schema and the skip list.
