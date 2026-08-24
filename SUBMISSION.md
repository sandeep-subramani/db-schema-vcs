# Start here

Project round submission — **Schema Version Control**.

Branch a database schema, evolve the branches independently, see
exactly what diverged, and merge back with real conflict detection.
Row data is out of scope on purpose: the schema itself — tables,
columns, types, constraints — is the versioned artifact.

| | |
|---|---|
| **Live** | https://db-schema-vcs.onrender.com |
| **Repo** | https://github.com/sandeep-subramani/db-schema-vcs |
| **Decision log** | [decisions.md](./decisions.md) — 32 entries |
| **Build log** | [NOTES.md](./NOTES.md) — plain-language, what and why |
| **Sample files** | [resources/](./resources/) — one per feature |

## Before you open it

Two things that will otherwise look like bugs:

- It's on Render's free tier, so **the first load after idle takes
  ~50 seconds** to wake. It isn't broken.
- **There is no password.** The login page asks you to pick a
  username, and typing one *is* signing in. Identity is a claimed
  name — a deliberate cut, explained below.

**Sign in as `explorer`.** That account already holds four repos, each
parked in a different state, so nothing has to be built before there's
something to look at.

## A five-minute path

**1. `storefront` — a finished merge.** Walk the commit history, click
any commit for its diff, and use **Compare** to diff any two commits,
including across branches. Worth a look: the commit *"Rename
reviews.body to comment"*. A snapshot diff can't tell a rename from a
drop-plus-add, so rather than guess, the engine **asks** — and
answering recomputes the diff instantly, with no round trip, because
the engine ships in the browser.

**2. `analytics` — the interesting one.** Two branches retyped the
same column differently. Choose **Merge into "main"…** and it opens
straight into the conflict, with colliding changes grouped so one pick
resolves everything that depends on it. This repo was created by
pasting Postgres DDL, so its import preview also carries a skip list
naming what the importer couldn't take, and why.

**3. `inventory` — a conflict-free merge, left un-applied** so the
whole flow is still walkable: apply, review the result, commit the
merge. It's also shared with a second user, so the Share dialog is
populated. Note that applying it is one-way — save it for last if you
want to see the pending state first.

**4. `first-run` — a repo with no commits**, which opens on the entry
doors a brand-new repo gets instead of a blank screen.

## Sample import files

[`resources/`](./resources/) holds nine files, **one per feature**, and
[a README](./resources/README.md) saying which feature each is for and
what you should see: clean JSON and SQL imports, rename detection that
auto-matches, rename detection that asks, a schema that fails
validation eight ways at once, a two-sided merge conflict, and a
`pg_dump` excerpt that exercises the skip list.

Every outcome described in that README was produced by running the
file through the real engine — measured, not estimated.

`resources/tools/` holds the scripts that build and verify the
`explorer` account, so the demo data is reproducible rather than
hand-made.

## How it's scoped

The user I built for is someone who changes a schema on a branch and
needs to know, *before* merging, exactly what will happen. So diff and
merge-conflict readability was treated as the product itself, not as a
view onto it.

**Deliberately cut:**

- **Migration SQL output.** The merge produces the merged schema, not
  the `ALTER` statements to get there. Correct merging was the hard
  part worth owning; codegen is additive and would have eaten days.
- **Column defaults, indexes, composite unique constraints, composite
  foreign keys.** Each extends the model rather than posing a new
  problem, so they lost to depth on the core.
- **Real auth.** Identity is a claimed username. It still buys a
  genuine multi-user model — users, repos, members, membership
  enforced inside every query — without spending the timebox on login.
- **Merge direction.** Merging runs branch → parent only, never the
  reverse.
- **Column and table order.** Not versioned, so a pure reorder
  correctly diffs as "no change".

One thing went the other way: **SQL import started as a stretch item
and was promoted into committed scope** once a parser had been
measured and I knew it would land ([decisions.md #8](./decisions.md)).

## Engineering

The engine — schema model, diff, merge — is pure functions with no UI
or framework imports, so it's testable in isolation and ships to both
the server and the browser.

**217 tests pass**, and the ones that matter are invariants rather
than examples:

- applying `diff(A, B)` to `A` yields `B`
- merging branches that touched different things equals both changes
  applied
- conflict detection gives the same answer regardless of which branch
  is called "ours"

Typecheck and lint are clean. `npm test`, `npm run typecheck`,
`npm run lint` — setup is in [README.md](./README.md), which also
sketches the two choices that explain most of the architecture.

[decisions.md](./decisions.md) was written as the work happened rather
than reconstructed afterwards. Each entry names the alternatives
seriously considered, the reasoning, the tradeoff accepted, and what
was cut — including the calls I would revisit.
