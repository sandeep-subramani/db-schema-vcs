# Sample imports

Ten minutes of guided exploration. Every file here is one feature —
import it, look at what the app says, move to the next. All of them
were run through the real engine before being written down, so the
outcomes described below are what you will actually see.

**Live app:** https://db-schema-vcs.onrender.com — sign in as
`explorer`; there is no password, claiming a username *is* logging in.
See [SUBMISSION.md](../SUBMISSION.md) for the four demo repos waiting
there and a five-minute path through them.

Both importers accept a **file upload or a paste**, and both live
behind the same entry-door screen: on a fresh branch it opens by
itself, otherwise use **Edit** on the repo home.

---

## JSON files → `resources/json`

### `01-bookstore.json` — JSON import, and the visual editor
The baseline everything else builds on: four tables, a composite
primary key on `loans`, unique columns, text length limits, a nullable
column, and foreign keys that pair a plain whole number with its
auto-number twin (`books.author_id` → `authors.id`).

Import it, commit it, then open a table in the editor to see the same
schema as something you can hand-edit. Every other JSON file assumes
this one is the committed starting point.

### `02-bookstore-renamed.json` — rename detection
Two renames, no other change: the table `members` → `memberships`, and
the column `books.published_on` → `published_at`.

Import over `01` and open the diff. The engine matches both on its own
and reports them as **renames**, not as four separate drops and adds —
so the foreign key that pointed at `members` follows the table to its
new name instead of breaking.

### `03-bookstore-ambiguous.json` — rename questions
Two more renames, but deliberately less obvious: `loans` →
`lending_records`, and `authors.country` → `authors.country_code`.

Import over `01`. Neither clears the auto-match bar, so instead of
guessing, the diff opens with a **question banner**: two questions,
each answerable "yes, renamed" or "no, dropped and added". Answer them
differently and watch the diff below recompute — that recomputation is
local, no round trip, because the engine ships in the browser.

### `04-broken.json` — validation
Structurally fine JSON describing an impossible schema. Import it and
the gate refuses with **eight errors at once**, each naming the exact
table and column:

- a duplicate table (`loans` twice) and a duplicate column
  (`authors.name` twice)
- a primary key naming `isbn`, a column that doesn't exist
- a nullable column sitting inside a primary key
- a foreign key at `authors.name`, which isn't unique
- a foreign key at table `shelves`, which doesn't exist
- a foreign key at one column of a *composite* primary key — unique
  as a pair, not on its own
- a foreign key pairing a `unique-id` with an `auto-number`

Nothing is written. Fix one and re-import to watch the list shrink.

### `05-merge-main-side.json` + `06-merge-branch-side.json` — merge and conflicts
The pair that produces a real three-way merge. Starting from a repo
whose `main` has `01` committed:

1. Branch off `main` — call it anything.
2. On the branch, import `06`, commit. It retypes `books.price` to a
   whole number (minor units) and adds a `reviews` table.
3. Switch to `main`, import `05`, commit. It retypes `books.price` to
   floating point and adds `authors.website`.
4. From the branch, choose **Merge into "main"…**.

Both sides changed `books.price`, differently — that's the conflict,
and it is the only one. `reviews` and `authors.website` touched
different things, so they merge silently and both survive. Pick a side
for `price`, apply, and commit the merge: the merge commit records
which branch came in, and the branch's base advances with it, so
merging again immediately has nothing left to do.

---

## SQL files → `resources/sql`

Postgres DDL. The import previews what it read **and lists what it
skipped, with a reason per line**, before you accept anything.

### `01-ecommerce.sql` — clean SQL import
Five tables, `serial` and `bigserial` primary keys, a composite key on
`order_lines`, four foreign keys. Everything here is inside what the
app models, so the preview reports **5 tables / 24 columns and an
empty skip list**. This is the happy path.

### `02-pg-dump-excerpt.sql` — real-world dump noise
The shape `pg_dump --schema-only` actually emits. All **3 tables
import**, and **15 skip-list lines** explain the rest: session `SET`s,
the sequence and its `OWNED BY`, `OWNER TO`, two `CREATE INDEX`es, a
`COMMENT`, `numeric(12,2)` precision, and `ON DELETE CASCADE` actions.

Worth noticing: the app never sees the word `serial` here. It infers
`teams.id` is auto-numbered from the `nextval` default, and
`projects.id` / `tasks.id` from `GENERATED ALWAYS AS IDENTITY`.

### `03-out-of-scope.sql` — the limits, stated out loud
Deliberately full of things this app does not version. **3 tables
still import**, and **23 skip lines** cover every category: `jsonb`,
arrays, `real`, `char(2)`, `interval`, an enum type and the column
using it, a multi-column `UNIQUE`, a multi-column foreign key, a view,
a function, a trigger, `GRANT`, `INSERT`, a `CREATE INDEX`, a `\connect`
psql command, defaults and `CHECK`s.

One skip is a nudge rather than a refusal: `CREATE TABLE watchers`
uses `REFERENCES accounts` without naming a target column, and the
skip line tells you to write `REFERENCES accounts(id)` and paste again.

---

## Where these fit

The demo repos on the live app came through these same two doors:
`analytics` was entered by pasting Postgres SQL, `inventory` by pasting
JSON. [SUBMISSION.md](../SUBMISSION.md) walks all four of them.
