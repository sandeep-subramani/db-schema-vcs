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

## Day 4 — product-pass audit: one real bug, one readability fix

Walked the whole app in a real browser as a brand-new user (empty
repo list, first-commit gate, all three import doors with garbage
input, commit → branch → conflicting edits → merge → compare) to
audit the day-4 checklist: first-run experience, empty states, error
messages, and diff/merge readability. The good news: most of it was
already in shape — every empty state has words and a next step, and
the error messages (invalid JSON, wrong-shape JSON, unparseable SQL,
duplicate names, stale saves) are specific and human.

Two things needed code. First, a real bug: opening Compare left both
commit pickers stuck on "loading…" forever. The fetch effect had a
"component unmounted, discard the result" flag, plus a longer-lived
"this request is already running, don't start another" note. React's
dev mode mounts every component twice on purpose (to catch exactly
this kind of mistake), and the two interacted badly: mount one
started the fetch and then threw away its result, mount two saw the
"already running" note and never fetched again — so nobody ever
filled the list. The same trap could bite a fast branch switch in
production. Fix: keep the "already running" note but stop discarding
results — these fetches fill a cache keyed by branch/commit id, so a
result that arrives late is still correct, and React 18 makes the
late state write harmless. CompareView was the only component pairing
those two patterns; the others refetch on remount, so their discarded
first result gets replaced naturally.

Second, readability: in narrow diff cards (the 3–4-column compare
grid, the merge view's side-by-side grids), long change lines wrapped
badly — the +/− mark could end up alone on its own row, and the
wrapped text landed flush-left under the mark instead of under the
words. Every change line is now "mark in a fixed gutter + one body
that wraps inside itself", which reads like a hanging indent: the
second line of a long foreign-key description starts under the first
line's text, and the mark always stays put. Same structure applied in
the card grid (shared by diff, review, and compare) and the merge
conflict cards.

## Day 4 — gate polish: Commit… now waits for a schema

Follow-up to the audit, per Sandeep's picks: on a brand-new branch
(no commits, empty schema) the Commit… button is now disabled with a
hint, matching how Review changes and Compare… already behave. Before
this, clicking it would commit a zero-table schema — its only visible
effect was dismissing the first-commit gate, which read like a bug.
The guard is UI-only and as narrow as possible: bring in any schema
(editor, JSON, SQL, example) and Commit… lights up immediately, and
once a branch has history, committing an empty schema as a deliberate
change is still allowed. Repo/branch name validation stays as-is by
decision (#26) — they're display labels, not identifiers.

## Day 5 — theme toggle (light / dark / system)

The app always had both themes: every color in index.css is declared
with the CSS light-dark() function, which means "use the first value
in light mode, the second in dark mode" — the browser picked one
automatically from the OS setting. What was missing was a way to
override that from inside the app.

The override is one mechanism: a small theme.ts writes a data-theme
attribute on the <html> element and remembers the choice in
localStorage (same place the session already lives). Two new CSS
rules say "when that attribute is 'light', force light; when 'dark',
force dark" — and because every color routes through light-dark(),
forcing the scheme flips the entire app at once. No attribute means
"follow the OS", which stays the default.

The control is deliberately a placeholder: one plain button at the
top right of both top bars, cycling System → Light → Dark and showing
the current choice. No styling effort spent — the UI refactor will
replace it. The username gate screen has no top bar and so no button,
but a saved choice still applies there because it's set at startup,
before anything renders.

## UI redesign — pass 1: login page + theme switcher

First view of the view-by-view redesign (branch ui-redesign), built
against the reference images in design/. Three things changed, and
only the last one touches behavior:

The design tokens flipped app-wide. Same token names in index.css
(--bg, --panel, --accent…), new values: near-black neutral ground
instead of navy, violet accent instead of cyan, plus a magenta
partner color (--accent-2) for "the other branch" in diagrams. A new
--frame token paints the dark chrome border that now rounds the whole
app like a sheet on a desk, and primary buttons became solid violet
fills instead of outlines. Headings and body now use Space Grotesk,
loaded from Google Fonts in index.html. Un-redesigned views inherit
the new palette immediately; each gets its own pass later.

The login page went from one centered card to a two-column hero:
left side is the pitch (title, a decorative branch/merge diagram
drawn with absolutely-positioned chips over a gradient rail, and
three one-line feature explanations), right side is the same claim
form as before — identical state, validation, error and busy
handling, just re-arranged markup.

The theme switcher is the one real rebuild (the old cycling button
was an explicit placeholder): now an icon button opening a panel
with three preview cards — Dark, Light, System — checkmark on the
active one. Picking applies instantly and keeps the panel open so
you can compare; outside click or Escape closes. theme.ts (the
actual mechanism) is untouched.

### Login page — three refinements

Focus feedback: the username field now draws a soft violet halo
(a 4px box-shadow ring in the accent color at 22% opacity) instead of
the browser's own focus ring, with a 120ms transition so it fades in
rather than snapping.

Identity preview: a "You'll appear as <avatar> name" row sits between
the hint and the Continue button, and it animates in with a small
hop — up, slight overshoot, settle — on a spring-ish easing curve.
The row is rendered only while the field has non-whitespace content,
so the animation plays on mount and an empty field simply has no row
(nothing to animate away, and no reserved gap). The trigger is the
same value.trim() test the submit button already uses, so the row and
the enabled button appear and disappear together. The chip reuses the
existing .user-chip / .user-chip-avatar treatment from the top bar,
so the same person looks the same before and after signing in. Users
with prefers-reduced-motion get the row without the hop.

Non-selectable showcase: the left column is a poster, not a document,
so .gate-hero sets user-select: none and cursor: default. Both
inherit to every heading, diagram chip and feature line inside it —
dragging across the artwork selects nothing and the pointer never
becomes a text caret. The theme switcher lives outside .gate-hero, so
it stays fully interactive.

### Repo listing — restyle pass

The home screen (the list of your repos) was a narrow 46rem column of
outlined rows. It's now a wider 65rem body split in two: the repo
cards on the left, a slim identity rail on the right holding one card
— your avatar, your name, how many repos you have, and the line
explaining that repos follow that name. Below the heading sits a
count pill, so "Your repos" reads with its tally attached. Each repo
card is a solid panel with the name set in the mono face (repo names
are identifiers, and the mono face is what the rest of the app uses
for identifiers), the "yours · created 2h ago" meta under it, and an
arrow on the right that slides and turns violet on hover.

The empty state is a dashed card centred in the body. Above the
heading there's a small glyph — a filled violet dot, a line, a hollow
magenta ring, a line, a grey dot. It's a branch about to fork: the
commit you don't have yet is the hollow ring, the branch you haven't
cut is the grey dot. Same vocabulary as the login page diagram.

Two things in the reference image were deliberately not built. The
branch pills on each card (`main`, `feature`) need each repo's branch
names, and `GET /repos` returns only id, name, owner, members and
createdAt — the branches are in the database but nobody asks for
them. The RECENT ACTIVITY rail needs a feed endpoint that doesn't
exist at all. Both are server changes plus, for the activity rail, a
second fetch inside RepoList; the restyle rule for this branch is
presentation-only, so they were put to the side rather than smuggled
in. If they're wanted later: branch pills are one grouped query and
one field on the Repo type; activity is a new endpoint unioning repo
creations with branch saves.

Two shared bits of chrome changed with it. The top bar's title now
carries the same gem mark as the login hero, and the username chip
now holds an avatar circle before the name. The avatar fill is a new
`--avatar-fill` token rather than plain `--accent`, because `--accent`
flips light in dark mode and white initials would sit on it illegibly;
the token is a deepened violet→magenta that keeps white text readable
in both themes. The same class now backs the login page's "You'll
appear as" chip, so one person looks the same before and after
signing in. RepoScreen shares `.user-chip` and inherits the new
padding and ink color, but its markup wasn't given an avatar or a gem
— that's for its own pass.

One layout bug was fixed on the way. The sheet has no global
`box-sizing: border-box`, so `.repo-home`'s `width: min(65rem, 100%)`
plus its 1.5rem side padding overflowed the frame horizontally once
the viewport was narrow enough for the 100% branch to win. Both the
body and the empty card are now `border-box`, and the rail drops below
the list under 54rem.

## First-commit gate restyle (UI redesign, pass 3)

The page a brand-new repo lands on. Same three doors as before, same
handlers — what changed is how they read.

The doors are now cards on the panel colour with a glyph tile above
the title: `+` for the editor, `{ }` for JSON (magenta, the second
branch colour), `>_` for SQL. Text is centred, the grid is wider
(66rem, three across on a desktop, two then one as it narrows), and
hover/keyboard-focus paint the border violet with a faint accent
wash. The heading now sets the branch name in mono violet inside its
quotes, because a branch name is an identifier and the rest of the app
already sets identifiers in mono.

Under the doors there's a new bit of drawing: a short line down into a
hollow violet ring, with a mono pill reading YOUR FIRST COMMIT ON
<branch>. It's the same vocabulary as the login diagram and the repo
list's empty state — a hollow ring is the commit you don't have yet.
It says what the doors are *for*, which the old page left implicit.

The block centres itself on the worktop with auto margins on the first
and last child rather than `justify-content: center`, so a short window
can still scroll up to the heading instead of clipping it.

Two pieces of shared chrome caught up with the repo list (NOTES.md
above left them for "its own pass"): the top bar's repo name now
carries the gem mark, and the username chip has its avatar circle.
Undo became a quiet button (borderless until hovered) since it's
dormant most of the time, and hairline rules group the bar into
history | schema I/O | you. The bar also wraps now, so the theme
picker and the chip stay on screen on a narrow window instead of being
clipped by the frame.

In the branch bar, "Branch" became a small mono label and the select
became a chip: a violet live-branch dot, the name in mono, and a
CSS-drawn caret (the select itself is chromeless, `appearance: none`;
the caret is a `::after` on the chip with `pointer-events: none` so
clicking it still opens the menu). `History (0)` became `History` plus
a round count badge, which is why `.btn` is now `inline-flex` — that
also stops the POSTGRES pill inside Import SQL from riding low.

Two things in the reference image were not copied. The `Commit…`
button is shown at full strength there, but on an empty gate it is
disabled (decisions.md #25) and dimming it is how you can tell; a
solid violet button that does nothing would undo that decision. And
the username chip keeps its faint pill border so it matches the repo
list page, where the same class was signed off last pass.

## UI redesign — the schema editor (sidebar + table editor)

The editor is the screen you spend the most time on, so this pass was
mostly about giving its parts edges. Three things got a container they
didn't have: the column grid, the add-a-table form, and the empty
worktop.

The column grid now sits inside a rounded panel (`.columns-panel`)
with a tinted header strip and hairlines between rows, so a table
reads as one sheet instead of loose text on the dot grid. The wrapper
also earns its keep on a narrow window: it scrolls sideways rather
than squeezing the type dropdowns into nothing. Checkboxes are drawn
by us now (`appearance: none`, a rounded box, violet fill plus a CSS
tick when on) because the native ones ignored the palette. Column
names, type values, max lengths and the primary-key summary are all
mono — they're identifiers, same rule as everywhere else.

Under the sheet, "Primary key: id" and the add-a-column form share one
row (`.columns-foot`), the form pushed to the right edge. Foreign keys
are separated by a dashed rule rather than a solid one: the section
below is about links, not more of the same table.

In the sidebar, the table list rows got a branch-line tick before the
name — dim on the closed tables, violet on the open one — plus a
bordered, tinted card for the row you're on. The add-a-table form is
now a small card of its own so it stops reading as another list item.
Its button is the violet primary while the schema is empty (it's the
only thing to do) and a quiet neutral fill once tables exist.

On an empty schema the sidebar also offers three dashed rows —
`users`, `products`, `orders` — under a SUGGESTED STARTERS label.
That's the one behaviour change in this pass, approved before it was
written: each row calls exactly what the Add table form calls
(`addTable` then select), so undo, dirty state and name validation
behave identically. They only render while the schema has no tables,
so a starter can never collide with an existing name.

The empty worktop got the drawing it was missing: a dashed card with
three placeholder column bars above "Nothing here yet", which is now
set as a real heading rather than muted body text.

The toast changed colour scheme. It used to be an inverted black
lozenge; it's now the panel colour with a border, an amber dot for
"not saved yet", and Undo as a violet-tinted pill instead of
underlined text — a floating sheet like everything else on the
worktop, rather than a system notification.

One CSS note worth knowing: the table name input uses
`field-sizing: content` so the `4 columns` chip can sit right beside
the name. Browsers without it (Safari) fall back to the default input
width, which just means the chip sits further right.

## The editor's dialogs, restyled

Eight dialogs were still wearing the old chrome: unsaved changes,
import JSON, import SQL, export JSON, share, new branch, commit and
the delete-table confirm. They now share one shell — the same panel
colour, border and rounded corner as the editor's cards — floating
over a scrim that dims *and* slightly blurs the page behind it, so a
dialog reads as a sheet lifted off the worktop rather than a box
pasted on top of it.

Inside the shell, four pieces are shared:

- A title row that can carry a small square glyph tile before the
  words. Amber for "careful, you'll lose work" (unsaved changes, and
  the stale-save dialog which had no reference image but is the same
  kind of warning), red for "this destroys something" (delete table).
  The tile means you know the temperature of a dialog before reading
  it.
- Prompt fields — branch name, commit message, username to add — are
  a small label over a full-width mono box with the same violet focus
  halo the login field uses.
- The paste areas (JSON, SQL) are one recessed mono panel each,
  roughly a screenful tall, and the file picker under them is now a
  proper row: "…or choose a file:", a neutral filled *Choose file*
  button, then the file name. That button is the browser's own,
  restyled through `::file-selector-button` — no markup or logic
  involved.
- Actions sit right-aligned in one row: violet fill for the action
  the dialog is named after, plain outline for cancel, and a red
  outline for the destructive choice (Discard changes, Remove them
  and continue).

Two dialogs got more than the shell. The delete-table confirm turns
the cascade list into tinted danger callouts, one per line, each
marked with a mono `−` — the same minus the diff view uses for a
removal — under a bold "This also removes:". Sharing turns each
person into a card with a gradient avatar, their handle in mono and a
role pill, violet for the owner; its *Add member* button is
violet-tinted rather than filled so the solid violet stays on *Close*,
the way the reference has it.

One thing the reference does that we can't: it sets the identifiers
inside a collateral line (`orders.user_id → users.id`) in mono while
the rest of the sentence stays in the UI face. Those lines arrive from
the engine as finished sentences, so picking the identifier out would
mean parsing strings in the view or changing what the engine emits —
logic, not presentation. The line stays in one face for now.
