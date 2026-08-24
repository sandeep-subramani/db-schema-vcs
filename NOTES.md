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

Follow-up to the audit, per Owner's picks: on a brand-new branch
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

## UI restyle, pass 7 — the read-only screens: diff, history, merge, compare

The last batch of views. Everything here is presentation: render
markup and CSS.

The screens are all built from the same three pieces, so restyling
them was mostly restyling those pieces once.

**The screen header.** Diff, merge and compare share one head: a
panel-coloured *← Editor* button, then the title at empty-state size
(1.85rem, tight) with a muted line under it. Merge names its branches
in mono and colours them by side — magenta for the branch being
merged, violet for the branch it lands in — so the direction of the
merge is legible before you read the sentence.

**The table card.** Every table that moved is a card. Cards now sit on
a solid panel base instead of being transparent, which stops the
worktop's dot-grid showing through and competing with the change
lines. The verdict is carried by the border plus a light diagonal wash
from the top-left corner, never a flat fill. Table names are mono, the
ADDED / DROPPED / RENAMED badges are small mono uppercase, and inside
a change line the identifier is mono at weight 600 while its
description stays muted — so `id` reads as a name and `Unique ID` as a
description. The `±` changed-mark moved from violet to amber, which
gives the diff three non-overlapping meanings: green added, red
dropped, amber changed, and leaves violet to mean "interactive".

**The rename question.** A violet-lit sheet with a diagonal wash,
because answering it is the one interactive thing on an otherwise
read-only screen. *Yes, renamed* is the violet-tinted button, *No* is
plain.

Then the per-screen work.

**Merge.** The conflict count wears a ringed `!` in the danger red.
Each conflict is a red-washed card; the two sides sit either side of a
drawn divider carrying a round `vs` token, which says "alternatives,
pick one" in a way two adjacent boxes don't. Both sides show their
branch dot in the side colour. Picking a side gives that side a
*violet* tint, not green — green means "added" everywhere else, and a
kept side isn't an addition, it's a choice you made; the green stays
on the KEPT badge where it means outcome. The dropped side fades, and
the card loses its red once the conflict is settled. In the footer the
status line goes amber while the merge is still blocked and plain ink
when it's ready, and the Apply button is violet-*tinted* rather than
dimmed while it can't be pressed.

Conflict reasons now set their quoted identifiers in mono —
`both sides changed maxLength of "users.email"`. This is the thing the
dialogs pass said we couldn't do, done safely: every quoted run in
every reason the engine emits is an identifier (checked in
`engine/src/merge.ts`), so a four-line formatter can style quoted runs
at render time without parsing prose and without changing what the
engine says.

**Compare.** Both ends live on one sheet: `FROM` and `TO` as mono
uppercase labels over each pair of selects, the swap button between
them. The reference draws no "Branch" / "Commit" labels, and on screen
they are redundant — but two unlabelled selects per side is a dead end
for a screen reader, so they're still there, just visually hidden. The
swap button gained an `aria-label` for the same reason.

**History rail.** Each commit is a rounded card on a branch line: a
node dot, the message, then who and when. The open commit fills its
dot violet and tints its card. No connecting line between the dots —
the reference doesn't draw one, and one would imply parentage the rail
doesn't render (a branch point is a badge here, not a line). Width
stayed at 17rem; see the decisions file for why it isn't 18.

**Pending-merge banner.** A violet strip under the branch bar. The
sentence flexes and wraps inside whatever room is left so the three
ways out — Review changes, Commit merge…, and *Abandon* in red — keep
their row on the right at any width.

**Repo error.** `Can't open this repo` now opens with a red-tinted
rounded `!` tile, the same glyph-tile family the dialogs use. Empty
states in general got air above their action button.

The stale-save dialog was in the batch but needed nothing — it already
matched, having come out of the dialogs pass. Confirmed against a live
conflict rather than assumed.

### Two follow-up fixes in the editor

**The checkbox that moved when you ticked it.** Reported as: clicking a
PK/NULLABLE/UNIQUE box nudges it down, unticking nudges it back, while
boxes that load already ticked look fine.

The drawn checkbox is `display: inline-grid`, and the tick is a
`:checked::before` pseudo-element. An inline-grid with no in-flow
items takes its baseline from its bottom margin edge; the moment the
tick appears the container inherits *that item's* baseline instead, so
the box shifts against the text line. Default-checked boxes had the
same offset all along — nothing animated, so nobody saw it.

Fix is one line: `vertical-align: middle` on the box, which aligns it
to the line's middle instead of a content-dependent baseline. Position
is now independent of whether the tick exists. Verified by measuring
`getBoundingClientRect().top` across a row before and after a real
click: all three boxes level, zero movement on toggle.

**"Unsaved changes" now reads as a warning.** It was a line of muted
text with a violet dot, sitting quietly next to *+ New branch* — which
undersells it, because unsaved work is the one thing on that bar you
can actually lose. It is now an amber pill: a rounded border, a
half-transparent amber fill, amber text and an amber dot. Same
"needs you" amber as the blocked merge status, so the app has one
colour for "there is something here you have to deal with".

The clean state (`Saved 3h ago by hairy-morth`) stays plain muted text —
nothing is at risk there, so it shouldn't compete.

### The identity menu — two navigations that follow you around

Leaving where you are had two doors, and each existed on exactly one
screen. `Switch user` lived only in the repo-list top bar; `← Repos`
lived only in the repo top bar, at the far left. So from inside a repo
you could not change identity at all without first backing out to the
list, and neither door was where you would look for it — the thing
that says *who you are* was the identity chip in the top right, and it
did nothing.

Both are now items inside that chip. The chip became a popover
trigger, and the panel under it holds `My repos`, a hairline, then
`Switch user`. The old top-bar buttons are gone.

Why this is more than tidying: the chip renders in the top bar, and
the top bar renders above *every* view in a repo — editor, first-commit
gate, diff, compare, merge, all states. Putting the two navigations
there gets them into all of those at once, without adding a button to
each. The repo-list screen shows the same panel with `My repos`
disabled and tagged `Current`, so the menu has one shape everywhere
rather than a different set of items per screen.

**Unsaved work.** Both items leave the repo, so both take the same
route a branch switch takes: `guardDirty`, which shows the existing
three-way `UnsavedDialog` — *Save & continue*, *Discard changes*,
*Cancel* — when the schema on screen isn't the one we last saved. No
new warning UI was invented for this; the dialog already phrased
itself around whatever you were trying to do, so switching user reads
"Save them before you switch user". Nothing new can be lost silently:
if `dirty` is false the guard just goes.

Switching user clears the open repo along with the name, which is what
the repo-list button already did — the next person lands on their own
list, not on someone else's branch.

Two logic changes were needed and are the only ones: `App` grew a
`switchUser` function it now also passes to `RepoScreen`, and
`RepoScreen` grew the matching `onSwitchUser` prop. Everything else is
markup and CSS. Behaviour that already existed — the guard, the native
tab-close prompt, the save model — is untouched.

### Merge view, second pass: the branch graph

The side-by-side merge screen became a branch graph. Same data, read a
different way.

**What changed shape.** Before: a conflict card carrying two side
boxes, then two independent card grids below it. Now: one spine running
down from a BRANCH POINT marker, with each side's cards hung off it
left and right — and a table *both* branches touched shares a single
rung, so a disagreement reads across one line instead of down two
columns. Conflicts collapse to one compact row each: what disagrees on
the left, the two ways out on the right.

**The one new piece of machinery.** `buildMergeTimeline` in
`client/src/diff/view-model.ts` — a pure function that zips the two
sides' card lists into rungs. Same table name = same rung. Order comes
from walking both lists in step (ours first at each index), which keeps
each side's own diff order intact rather than imposing an alphabet on
it. It also collects, per table, the ids of every conflict group
touching it, so a card can say CONFLICT and the view can tell an open
conflict from one you've already settled. Five tests.

Ids rather than a boolean is the part that matters. Once you pick a
side, the conflict row goes quiet — and a card still shouting CONFLICT
in red next to a calm row would make the screen untrustworthy. With
ids, a rung knows whether *its* conflicts are all picked: settled rungs
keep the badge (the conflict did happen) but drop the alarm colour.

**Colour.** The spine is a violet-to-magenta gradient, the two branch
colours meeting on it. Each node takes the spine's colour where it
sits — done by handing the row its position down the spine (0–1) as a
CSS custom property and letting `color-mix` interpolate, so it stays a
sampled gradient rather than a hardcoded list. Conflict nodes override
to red and grow. Each card gets a brighter 2px edge on whichever side
the spine is on, so the branch line reads as feeding into the card
rather than stopping short of it. Pick buttons wear their own branch's
colour — violet for the parent, magenta for the branch being merged —
and fill when chosen.

**What the conflict card gave up.** It used to list, per side, exactly
which changes were bundled in the group. That's gone by choice: the
detail now lives on the CONFLICT-badged cards. The honest cost is that a card shows *all* of
that table's changes, not only the conflicting ones, and a group
spanning two tables badges both without saying they're one bundle.

**Narrow windows.** A three-column graph needs room. Under 62rem the
spine, nodes and leader lines go away, the rungs become one stacked
list, and each card gains a small mono label naming its branch —
because once the columns collapse, the headings above stop telling you
which side you're looking at.

## Dropdowns: one listbox of our own, and a glyph per column type

**The problem in one sentence.** A native `<select>` lets you style the
box but not the list — the list is drawn by the operating system, so on
macOS it opened as a white slab with blue rows in the middle of a
near-black app. Six of them, on four screens.

**What replaced it.** `client/src/components/Select.tsx`: a button that
shows the current value, and a list that opens under it. Same panel,
border, shadow and violet tick as the theme and account popovers in the
top bar, because it is built the same way. All eight call sites now use
it — the column-type picker (per row and in the add-column form), both
foreign-key pickers, the branch switcher, Compare's from/to branch and
commit pickers, and the new-branch dialog's "Starting from".

Three details are load-bearing rather than decorative:

- **The list is portalled into `<body>`.** Two of the call sites sit
  inside scroll containers — the columns table scrolls sideways, the
  compare bar sits in the scrolling page — and a list positioned
  relative to its trigger would be clipped by that overflow. A
  fixed-position portal escapes every ancestor, and the price is that
  the list has to be re-measured on scroll and resize, which a layout
  effect does. The same measurement decides whether the list drops down
  or flips up: it flips when there isn't room below and there is more
  room above, which is what the foreign-key pickers at the bottom of
  the editor do.
- **Escape stops at the menu.** Every dialog listens for Escape on
  `window`. Without `stopPropagation` in the menu's own handler, one
  press would close the dropdown *and* the dialog behind it. Caught by
  driving it in the browser, not by reading it.
- **Hover follows `pointermove`, not `pointerenter`.** With
  `pointerenter`, opening the list with the keyboard while the cursor
  happened to be parked over where the list appears would instantly
  yank the highlight off the row the keyboard had landed on. Listening
  for actual movement fixes it.

Keyboard behaviour matches what a native select gives you: ↑↓, Home,
End, PageUp/PageDown, Enter or Space to pick, Escape to cancel, and
type-ahead (press `u` in the type list and it goes to Unique ID;
pressing the same letter again walks through the options sharing it).
The trigger is a `combobox`, the list a `listbox` of `option`s, with
`aria-activedescendant` tracking the highlight — so focus can stay in
one place while the highlight moves, the way a listbox is supposed to
work.

**The type glyphs.** `client/src/components/ColumnTypeIcon.tsx` — one
small drawing per column type, shown in the list and on the closed
control, so a table's column types can be scanned down the Type column
without opening anything. They're hand-drawn rather than pulled from an
icon set because the type vocabulary is our own invention
(`engine/src/types.ts`): no off-the-shelf set has a "whole number
(large)".

Two conventions keep seventeen drawings looking like one family. Every
base glyph lives in the same square of the canvas, so none reads
heavier than its neighbours. And variants of one idea share a glyph and
differ only by a badge in the bottom-right corner — the base shrinks to
make room, with its stroke width scaled back up so it stays the same
hairline. So the three integer widths are one `#` with one, two or
three dots; auto-number is a climbing staircase with the same dots;
"with time zone" is the plain clock or calendar plus a small globe; and
"date & time" is the calendar plus a small clock.

**What the CSS lost.** The global `select` rules are gone, along with
`select option` (which existed only to stop the OS list inheriting
white-on-white) and the `.branch-pill::after` caret (the control draws
its own now, and it rotates when open). `.visually-hidden` went too:
Compare's two off-screen field labels were its only users, and those
labels are now the dropdowns' `aria-label`s.

## The latest-commit card on the repo home opens its diff

The repo home already showed a one-line headline for the branch's last
commit — who committed, the message, how long ago. It was a label and
nothing more: decision #27 had explicitly cut "the latest commit's
contents" from the home, because rendering the changes inline means
fetching two snapshots (this commit and the one before it) and diffing
them, and the home's rule was "nothing that costs an extra request".

That rule still holds for what the home *draws*, but not for what it
*links to*. Clicking the card now opens the diff screen for that
commit — the same screen a History row opens, comparing the commit
with its predecessor. The cost only lands when someone asks for it,
and it's a screen that already exists, so nothing new was built.

The wiring is three lines: `RepoOverview` takes an `onOpenLatestDiff`
callback and renders the card as a `<button>` when there is a commit
(no commits means nothing to open, so the empty state stays inert
text); `RepoScreen` answers by setting the `diffTarget` state it
already owns to `commits[0]`. Because `DiffView` is rendered above the
home in `RepoScreen` and `showOverview` stays true underneath, the
diff's back button reads `← Repo home` and closing it lands you back
where you clicked. No new state, no new endpoint, no new fetch path.

Two inherited corners, both identical to clicking the same commit in
the History panel: if that commit is a branch's copied split point
(decisions #16) the diff renders the "nothing was authored here"
marker, and if it's main's very first commit it diffs against an empty
schema. The CSS is a button reset plus the `.repo-row` hover/focus
treatment, so the card looks unchanged at rest and picks up a violet
border and a soft shadow under the pointer.

## Empty commits are refused

A branch you hadn't touched since its last commit could still be
committed. The entry landed in History looking like any other, and
clicking it opened the diff screen showing "No schema changes" — a
version that records nothing, sitting in the middle of the story of
the branch. Worse, a diff is always computed against the commit
before it, so a run of no-op commits pushes the last real change
further out of reach.

The fix is one rule, enforced where it can't be bypassed. Before a
commit writes anything, the server compares the incoming schema with
the branch's last commit. If nothing differs, it answers 400 and
writes nothing at all.

Two details make it behave:

**It compares with the engine's diff, not with the raw JSON.** The
same `diffSchemas` the diff screen draws with. That's what makes the
rule airtight rather than approximate — the condition for refusing a
commit is *literally* the condition under which the diff screen would
say "no schema changes", so the two can't disagree. It also means a
pure reorder of tables or columns counts as unchanged, which is
already the answer decision #18 gives everywhere else.

**The check runs first, before anything is written.** A commit is
normally "save the working state, then stamp it" in one transaction.
The emptiness check happens before the save, so a refused commit
leaves the working state exactly where it was — you can still Save,
you just can't stamp a version that says nothing.

Merge commits are the exception, and they have to be. A merge commit
does bookkeeping beyond the schema: it advances the merged branch's
stored base, which is what lets that branch keep going without
re-reporting the changes it already handed over (decision #20). If the
merged result happens to match what the target branch already had —
the source's changes were already there, or you undid them while
reviewing — refusing the commit would leave the merge unrecordable.
So a commit carrying a merge marker skips the check.

On the client, the Commit… button now greys out under the same rule
instead of only on the old "is there a schema at all" test, and the
tooltip says which case it is: nothing committed yet, or nothing
changed since the last commit. To know that, the screen needs the last
commit's schema, which the branch load didn't have — the commit list
carries messages and authors, not snapshots. So the load makes one
extra request for the tip commit, and after each commit the schema
just committed becomes the new tip with no fetch at all. If that
request fails the button stays live and the server has the last word;
the worst case is a slightly less helpful message, never a stuck
button.

Files: `commitWorking` in [server/src/store.ts](server/src/store.ts)
(the check and a new `empty` result), the commit route in
[server/src/api.ts](server/src/api.ts) (400 plus the two messages),
`RepoScreen` (tip snapshot state, `canCommit`) and `BranchBar` (one
new prop for the disabled tooltip). Three server tests cover it: the
refusals write nothing, a reorder counts as unchanged, and a no-op
merge commit still lands and still advances the base.

## One `Edit` button instead of four ways out of the repo home

The repo home had grown four exits: `Open in editor` beside the repo
name, and `Import JSON`, `Import SQL`, `Export JSON` in the top bar —
with a second copy of all three imports/exports down in the home's
right-hand rail. Two complaints, both fair. The screen was a wall of
buttons, and the two schema editors were split across the layout: JSON
and SQL up in the chrome, the hand editor somewhere else entirely.

The fix reuses a page we already had. A brand-new branch opens on the
**first-commit gate** — three door cards saying "build it by hand",
"paste JSON", "paste SQL". That page already *is* the list of ways to
get a schema in; it was just unreachable once the branch had one. So
`Edit` on the repo home now opens it on demand, and the doors are the
only route to the editor and to either importer. The top bar keeps
Undo, Share, theme and identity; Export JSON moved to the home's rail
and lives in exactly one place.

**The gate needed two voices.** Its copy was written for an empty
branch: "This branch is empty", "Start from zero", a hollow ring
labelled "your first commit on main", and a "Load the example schema"
shortcut. Every one of those is wrong or destructive on a branch with
eight tables in it. So the component takes a `hasSchema` flag and
switches copy: "Change the schema on *main*", doors that say **Replace
from** JSON/SQL and warn that they replace what's there, no
first-commit ring, no example-schema link. The on-demand doors also
get a `← Back to the repo home` link; the automatic gate doesn't,
because it's a branch's landing page and there is nothing behind it.
The automatic gate is otherwise unchanged, verified side by side.

**Where the doors sit in the view stack.** RepoScreen picks its middle
view from a handful of flags. The new `doorsOpen` sits in the same slot
as the repo home — *below* merge, compare and diff — so opening a diff
from the branch bar still takes over the screen, and closing it comes
back to the doors rather than dumping you in the editor. The automatic
gate keeps its old position at the top of the chain, so an empty
branch still can't be navigated away from by accident. Both render
through one `renderDoors(showBack)` helper, so there's one copy of the
door wiring, not two.

**The commit dialog names its target instead of asking for one.** The
ask was a branch dropdown, pre-filled with main. I pushed back and it
was dropped, for a reason worth writing down: a commit here is "save
the schema on screen into this branch's working state, then stamp it",
and that save is guarded by a per-branch revision number that only the
branch on screen holds. Committing onto a *different* branch would
overwrite that branch's saved-but-uncommitted work with a schema never
based on it, using a revision we don't have. Git can't do it either —
you switch branch, then commit. And pre-filling `main` while standing
on `feature` would make the dialog's default action the destructive
one. So the dialog's submit button just says what will happen:
**`Commit into main`**. Same code path, one label.

Files: [FirstCommitGate.tsx](client/src/components/FirstCommitGate.tsx)
(the `hasSchema` copy split and the optional back link),
[RepoOverview.tsx](client/src/components/RepoOverview.tsx) (`Edit` in
place of `Open in editor`, import buttons gone from the rail),
[RepoScreen.tsx](client/src/components/RepoScreen.tsx) (`doorsOpen`,
`renderDoors`, the trimmed top bar, the commit submit label), plus one
CSS rule for the back link. No engine, server or API change, and no
test change — the suites here cover the engine, the server and the
pure client helpers, none of which this touches.

## App frame removed — the sheet now runs edge to edge

The dark border around every screen wasn't the browser or the
screenshot: it was ours. From the pass-1 restyle, `.app` sat inside a
12px margin with a 14px corner radius, and `body` was painted
`--frame` (`#08080c`) so that gutter read as a chrome bezel — "a
drafting board on a desk". It applied everywhere because `.app` is the
single wrapper `App.tsx` renders around every screen, and because
`--frame` is a flat hex rather than a `light-dark()` pair, the black
band stayed black in the light theme too.

That's now gone. `.app` loses the margin and the radius and takes
`min-height: 100vh` instead of `calc(100vh - 24px)` (the old value was
only there to pay back the 12px top and bottom). `body` is repainted
`var(--bg)` so an overscroll bounce reveals the same ground as the
sheet rather than a different one. The `--frame` token stays — half a
dozen box-shadows mix against it, and those are unaffected.

Files: [index.css](client/src/index.css) (the `body` and `.app` rules
only). CSS-only: no JSX, no logic, nothing else in the sheet moved,
and no other rule depended on the 12/24px inset.

## Undo now appears only where it can actually do something

The `Undo` button sat in the top bar on every screen, greyed out on
most of them. Here is what it actually controls, which is what decided
where it belongs.

There is one undo stack, and it holds nothing but past versions of the
*schema on screen* — the working copy you're editing, before you save
or commit it. It starts empty every time you open a branch, so it is
never live until you've changed something in that sitting. Seven
actions push onto it: adding, renaming or deleting a table; any column
or key edit; importing JSON; importing SQL; loading the example
schema; "load their version" when a save collides with someone else's;
and abandoning a pending merge. Nothing that reaches the server is on
it — a commit, a save, a new branch, a completed merge and a share are
all one-way.

So the button is only ever useful on the two screens that put that
working schema in front of you: the editor, where six of those seven
edits are made, and the repo home, where the table summary changes
under you when an undo lands and where "abandon merge" drops you. On
the entry doors, a diff, Compare and Merge it could only be dead
chrome, so it isn't drawn there — and its little separator hairline
goes with it, or it would dangle in front of the theme picker.

The keyboard shortcut moved with it, and that part fixed a bug rather
than tidying one. `Ctrl/Cmd+Z` was a window-level listener, live on
every screen. Compare and Merge don't render the working schema at
all, so hitting it there reverted your last edit and *nothing on the
page moved* — the change was gone and there was no way to tell. (In
the working diff it was gentler but still wrong: the diff you were
reading quietly rewrote itself.) The empty-stack case was never a
problem — `undo()` hands React back the same history object and React
skips the re-render — which is why this only bit after an
edit-then-go-review round trip inside one branch. The shortcut is now
bound to exactly the views that show the button, so the keystroke and
the control can't disagree.

One structural wrinkle worth knowing if you touch this file: the
listener is a hook, hooks can't sit after a conditional return, and
`RepoScreen` returns early when the repo failed to load. So
`currentBranch`, `showGate` and the new `showUndo` moved above that
early return. They're plain derivations off top-level state, so the
move is positional only.

Files: [RepoScreen.tsx](client/src/components/RepoScreen.tsx) — the
`showUndo` derivation, the guard and dependency on the `Ctrl/Cmd+Z`
effect, the three hoisted derivations, and the conditional around the
button and its hairline in the top bar. No CSS, no other component, no
engine, server or API change. No test change: the suites cover the
engine, the server and the pure client helpers, and this is view
state.

## Adjusting a merge before you commit it

A merge rarely lands a schema that's ready as-is, so the pending-merge
banner needed a way to keep working on the result. It turned out the
way already existed and was just hidden.

Here is what actually happens when a merge is applied. `MergeView`
computes the merged schema in the browser and writes it into the
*parent branch's working state* — the scratch copy the editor edits,
not history. `landMerge` then switches you to that branch and reloads
it, so the schema on screen is the merged one. Everything downstream
reads that same object: the home's table list, `Review changes`, and
the editor. So `Edit` during a pending merge was never showing you the
last commit — it was showing the merge. It just took two clicks to get
there, through the entry-doors page whose other two doors are
`Replace from JSON` and `Replace from SQL`, either of which would have
thrown the merge away.

Two changes, both about the route rather than the state:

- The banner's own sentence already said "adjust in the editor". That
  phrase is now a link that does it — one click from the banner to the
  editor, on the merged working state. It stays in the prose instead of
  becoming a fourth button because the banner's job is to lead to
  `Commit merge…`, and a fourth control in that row works against it.
- While a merge is pending on the branch you're on, `Edit` on the repo
  home now goes straight to the editor too, skipping the doors. With no
  merge pending it opens the doors exactly as before.

The banner renders above the layout rather than inside any one view, so
it stays pinned while you edit — `Commit merge…` and `Abandon` are
always one click away. And the commit path needed nothing: `doCommit`
already commits the schema currently on screen and attaches the merge
marker, so adjustments made before committing land *inside* the merge
commit. One commit, merge plus fixes, and the source branch's base
still advances in the same transaction.

Files: [RepoScreen.tsx](client/src/components/RepoScreen.tsx) — the new
`openMergeEditor` handler (it only clears the view-state flags stacked
on top of the editor; no loading, because the merged schema is already
the working state), the banner sentence, and the `onOpenDoors` callback
passed to `RepoOverview`. [index.css](client/src/index.css) — the link
inside the banner takes ink weight and an accent underline, since the
usual accent link colour sinks into the banner's accent-tinted ground.
No engine, server or API change, and no test change: the suites cover
the engine, the server and the pure client helpers, and this is view
state. Decision recorded as decisions.md #31.

## Pre-merge audit of the UI-redesign branch

Before merging `ui-redesign` into `main`, the whole branch got a full
sweep: the three test suites, typecheck, lint, a production build, the
production server serving that build, every API route driven by hand
including its error paths, and every screen driven in a browser in both
themes at 1440px, 720px, 600px and 420px wide.

The suites, typecheck and lint were already clean and stayed clean —
214 tests across engine, server and client. The API came back correct
on every probe: bad ids, oversized names, malformed bodies, non-members
reading and writing other people's repos, bogus merge markers, and the
new empty-commit rule (including the case where a commit is refused and
must therefore *not* leave a working save behind — verified by reading
the row back afterwards). Nothing needed fixing on the server.

Four things were wrong in the browser, all presentation, all fixed:

**The dropdown sheet was measured in the wrong box.** `Select.tsx`
works out how much room is left in the viewport, sets that as the
menu's `max-height`, then positions the menu exactly that far above or
below its trigger. That arithmetic assumes `max-height` *is* the
rendered height — but the sheet was `content-box`, so its padding and
border added about 12px on top. A menu clamped by the bottom of the
window overhung it, and a menu that flipped upward sat 6px *over* its
own trigger instead of 6px under it. One line: `box-sizing: border-box`
on `.uiselect-menu`. Measured before and after — a clamped drop-down
overhung by 3.6px and now clears by 10px; a drop-up overlapped the
trigger and now leaves the intended 6px gap.

**The un-chosen side of a merge conflict was unreadable.** Its CSS
comment says "the road not taken stays legible but recedes", but it
receded with `opacity: 0.45` on top of a 12%-tinted fill, which lands
at about 2:1 against its own background — and 0.45 is the exact opacity
this app spends on *disabled* buttons everywhere else. So the one
control you'd click to change your mind looked switched off and couldn't
be read. It now recedes by losing its fill and its weight instead of by
going transparent: 6.3:1 in both themes, no borrowed disabled look.

**The repo-error screen had no top bar**, so no theme picker — against
the standing rule that every page carries one — and no way to switch
user. It now renders the same chrome as every other screen, with the
app name as static text (there is no repo to go home to) and both exits
wired straight through, since nothing was loaded that could be dirty.

**The table name painted over its column-count chip** in a narrow
editor column. The name field is `field-sizing: content` with
`min-width: 3rem` and `max-width: 100%` — but it was `content-box`, so
the 3rem floor rendered at nearly 4rem, and `max-width` can never
rescue that because `min-width` always wins in CSS. The input therefore
refused to shrink past ~62px while its flex parent shrank to 37px, and
overflowed by 15px across the chip. Fixed by making the field
`border-box` so both limits mean what they say, plus `flex-wrap` on the
title row so the chip drops below the name rather than sharing a strip
with it. Wide layouts are unchanged; a deliberately absurd table name
now wraps the chip instead of overflowing the page.

Everything else held up. Zero JavaScript errors and zero React warnings
across the entire session; the only console noise was the 4xx responses
from error paths that were being tested on purpose. No horizontal page
overflow at any width — the columns table scrolls inside its own box,
which is what should happen. Contrast was swept over every visible text
run in both themes: after the fixes, dark is clean, and light leaves two
marginal items (the amber "Unsaved changes" pill at 4.18:1 and the small
count badges at 4.45:1, both against a 4.5 bar) that are palette calls
rather than defects.

Files: [index.css](client/src/index.css) and
[RepoScreen.tsx](client/src/components/RepoScreen.tsx). No engine,
server, API or component-logic change, so no test changes.

## The foreign-key picker no longer offers a column itself

Two follow-ups from the audit above.

**A column can't be its own foreign key any more.** On `users` the FK
form offered `id → users.id`. That schema is one the engine validator
happily accepts — it only asks that the target exists, is unique on its
own, and has a matching type, and a column trivially satisfies all
three against itself. But as a *constraint* it says nothing: "every
value in this column must exist in this column" is true of every row by
definition. So it can't be caught by validation; the picker has to be
the one that declines to offer it.

The care needed here is that self-referencing foreign keys in general
are perfectly ordinary — `employees.manager_id → employees.id`, the
parent-id shape of any tree. Only the *exact same column* is
meaningless. So the exclusion is one column, not one table.

`validFkTargets` couldn't express that: it took a column *type*, which
says nothing about where the key starts. It now takes the starting
column itself — `{ table, column }` — and reads the type off it. That
kills a second problem on the way: with the type passed separately, a
caller could hand over a type that disagreed with the column it claimed
to be for. Now there's one source of truth and nothing to keep in sync.
An unknown starting column yields no targets rather than guessing.

What you see: on `users`, starting from `id` now says "no valid target"
with the same explanation it already gave for other dead ends, because
`users.id` was the schema's only Unique ID column. On `reviews`,
starting from `product_id` still offers `reviews.id` — same table,
different column, a real constraint — while starting from `id` offers
`products.id` and `orders.id` and no longer itself. Three new tests
cover the exclusion, the same-table-different-column case (asserting the
FK it produces still validates), and the unknown-column case.

**CLAUDE.md's typeface rule matched the plan, not the code.** It still
named Space Grotesk from Google Fonts; the app has been on Zoho Puvi
from Zoho's CDN. The rule now records what's actually there, including
why the `@font-face` block re-declares one family with real weights
(Zoho ships a family per weight, all at `font-weight: normal`, which
would have broken every weight value in index.css).

Files: [edits.ts](client/src/schema/edits.ts) — the new signature and
the skip; [TableEditor.tsx](client/src/components/TableEditor.tsx) — the
one call site; [edits.test.ts](client/src/schema/edits.test.ts) — the
existing target tests rephrased around a starting column, plus three new
ones. No engine, server or API change.

## Ship-day verification: the deploy, a fresh clone, and a docs pass

Day 5's job wasn't to build anything — it was to find out whether the
thing we built is actually shippable, and to make the documents tell
the truth about it.

**The deploy was the real unknown.** Merging the redesign to `main`
triggered a Render build that had never run there, and the redesign
brought something new with it: the Zoho Puvi webfont, pulled at
runtime from Zoho's own CDN rather than bundled. If that CDN were
blocked or slow from Render, every screen would quietly fall back to
system fonts and the whole restyle would look wrong — the kind of
failure that doesn't show up in any test.

It's fine. The two asset filenames the live site serves are
byte-identical to a production build of `main` on this machine, which
is a stronger check than "the site loads": Vite puts a hash of the
file's contents in its name, so matching names mean matching bytes,
and the deploy is provably the merge commit rather than something
older. All four font files answer with the header a cross-origin font
needs (`access-control-allow-origin: *`) and a two-month cache, and
the browser confirms three weights actually loaded and that the page's
headings are drawn in Puvi, not a fallback.

**Then the whole product, once, on the live site.** Claim a username,
create a repo, land on the entry doors, load the example schema,
commit, branch, retype the same column differently on each side,
merge, hit the conflict, pick a side, apply, commit the merge. All of
it worked against the real database, and three fixes from the last few
commits were visible doing their jobs: the foreign-key picker refusing
to offer `users.id` to itself, `Commit…` greying out because the
schema matched the last commit, and `Undo` absent on a diff. No
console errors or warnings anywhere in the session.

**A fresh clone one-shots.** Cloned from GitHub into a scratch
directory, `npm install`, then all three checks — 217 tests, typecheck,
lint — clean, and a production build succeeds. Nothing in the repo
depends on state that only exists on this machine.

**One thing the fresh clone did catch, in the README rather than the
code.** The setup section said "No database needed to run", which is
true in a way that's useless: the server does boot without
`DATABASE_URL`, and `/api/health` cheerfully reports `ok`, but every
route that touches data answers 503. You get a page that looks alive
and can't do a single thing. `.env.example` had always been honest
about this; the README hadn't. It now says the app needs Postgres,
gives the four commands that provide it, and notes that the server
suite needs the test database while the engine and client suites don't.

The README's status paragraph also still claimed the redesign was "in
progress on `ui-redesign`", and its architecture sketch listed the
three packages without mentioning the most distinctive thing about the
design: diff and merge run in the browser, not on the server. That's
the first question anyone reading the code asks, so it's now stated
up front, next to the other choice that explains the shape — every
version is stored as one whole snapshot, so comparing any two versions
is two reads and a pure function.

**The decision log was read end to end** — all 32 entries — and the
findings reported rather than edited, since the log is the product
owner's to change. The short version: the entries themselves hold up,
and one predicted threshold was checked against the code and still
holds (#29 warned that a third view-state flag in `RepoScreen` would
mean it needs a real view union; no third flag was ever added). What's
missing is history, not honesty — the UI redesign that entries #30,
#31 and #32 all refer to has no entry of its own, and a few small
approved logic changes during the redesign went unlogged. Those gaps
are recorded here and were raised at the time; whether they become
entries is the owner's call.

Files: [README.md](README.md) — status, setup and architecture;
[PLAN.md](PLAN.md) — day-5 ticks. No source change.

## Recruiter handover pack — sample imports and a live demo account

Two things a stranger needs that the code itself can't provide: files
to feed the app, and an account that already has something in it. Both
now exist.

**`resources/`** holds nine sample files, one per feature, and a
README that says which feature each one is for and what you should
see. Six JSON, three SQL. They aren't
decorative — each was run through the real engine before its outcome
was written down, and the numbers in the README are measured, not
estimated: `sql/01-ecommerce.sql` imports 5 tables and 24 columns with
an empty skip list; `sql/02-pg-dump-excerpt.sql` imports 3 tables and
produces 15 skip lines; `sql/03-out-of-scope.sql` imports 3 and
produces 23, covering every skip category the importer knows.

Two of them are worth explaining because their shape isn't obvious.

`json/04-broken.json` breaks the schema *semantically* only — a
duplicate table, a primary key naming a column that doesn't exist, a
foreign key pointing at a non-unique column, and so on. That is
deliberate. `validateSchema` runs its structural pass first and only
reaches the semantic checks when the structure is completely clean, so
slipping in a misspelled field name would have hidden the seven
interesting relational errors behind one boring typo. As written, the
gate refuses with all eight errors at once, which is the thing worth
showing.

`json/02-…-renamed.json` and `json/03-…-ambiguous.json` are the two
halves of rename detection, and they were tuned against the actual
thresholds in `diff.ts` rather than guessed. `members` → `memberships`
scores 0.64, above the auto-match bar, so the engine just reports it as
a rename. `authors.country` → `country_code` scores 0.58, below it, so
the engine refuses to guess and asks. Same feature, two behaviours, one
file each.

**A live `explorer` account** now exists on the deployed database, with
four repos left in four different states, so every view is reachable
without building anything first: `storefront` is a finished merge with
history to browse, `analytics` opens straight into a live conflict,
`inventory` has a clean merge still waiting to be walked (and a second
member, so the Share dialog isn't empty), and `first-run` has no
commits at all, so it opens on the entry doors.

It was built through the deployed HTTP API rather than by writing SQL,
for two reasons. The office network can't reach the database directly —
port 5432 times out — and going through the API means the fixture
passed the same validation, the same empty-commit rule and the same
merge bookkeeping as anything a real user creates, so it can't be in a
state the app itself would never produce. The build script and a
verifier live in `resources/tools/`; the verifier reports, per branch,
whether the working state still equals the tip (nothing should open
dirty) and what the merge view would say. Both were dry-run against a
local server under a throwaway username before production was touched,
and the production result matches the dry run line for line.

One sharp edge, recorded so it isn't rediscovered: `inventory`'s
pending merge is one-shot. Once applied, `main`'s working state no
longer equals its tip and the merge view refuses with "main has
uncommitted work". There's no discard button, and no delete-repo
endpoint either (decisions #27), so re-arming means a working-state
reset through the API.

**`SUBMISSION.md`** is the reviewer's entry point, added so the email
carrying this work could stay short: the links, the two things that
otherwise look like bugs (a ~50s cold start on Render's free tier, and
a login page with no password), a five-minute path through the four
demo repos, how the work was scoped and what was deliberately cut, and
what the tests actually assert. Everything a reviewer needs is in the
repo rather than in a mail thread they'd have to scroll back through.

Files: [SUBMISSION.md](SUBMISSION.md) — new, the entry point;
[README.md](README.md) — a "Try it" section, since the live URL was
landing people on a bare "Pick a username" screen with no hint that
`explorer` is the interesting door; [eslint.config.js](eslint.config.js)
— `resources/` ignored, as sample and tooling material rather than app
source; [PLAN.md](PLAN.md) — day-5 entry. No source change; the app
itself is untouched.
