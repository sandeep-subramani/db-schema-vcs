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
