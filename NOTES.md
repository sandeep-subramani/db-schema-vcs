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
