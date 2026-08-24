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

## The hard part

The prompt's phrasing hides a genuinely difficult sub-problem, and it's
the one I went after.

**A snapshot diff cannot tell a rename from a drop plus an add.** If
you store versions as whole snapshots — which I do — then `customer`
disappearing and `client` appearing is indistinguishable from a column
being dropped and an unrelated one created. The naive answer is to
report drop + add and move on. That's wrong in a way that matters: the
diff lies about intent, and every foreign key pointing at the renamed
thing breaks on merge.

So renames are scored, not guessed. Every dropped/added pair gets a
similarity score across name, type and shape, and lands in one of
three tiers: confident enough to call a rename outright, ambiguous
enough to **ask the user**, or clearly unrelated. When a rename is
confirmed, references follow the object rather than its spelling — the
diff shows one change, not three. `resources/json/02-…` and `03-…`
are the two halves of this: one scores above the bar and is
auto-matched, one scores below it and produces a question.

**Three-way merge, where conflicts can chain.** If change A conflicts
with B and B with C, resolving them independently can produce a schema
that contradicts itself. Colliding changes are therefore grouped into
connected components, and a pick resolves the whole group. Because each
side's change list came from a schema that was already valid, resolving
a group to one side can never contradict itself — that property is what
makes pick-a-side resolution safe no matter how the picks combine.
Conflict detection is order-independent, and two tests pin that down:
swapping which branch is "ours" swaps every conflict's sides and
changes nothing else, and swapping the picks along with them yields an
identical merged schema.

**Input that isn't clean.** SQL import never fails wholesale. Each
statement is split and parsed alone, so anything unreadable or out of
scope becomes a **skip-list line with a plain reason** instead of a
failed import — you see what was taken and what wasn't before you
accept anything. `resources/sql/03-out-of-scope.sql` imports three
tables and produces twenty-three skip lines. Schema validation works
the same way: one gate for every external input, reporting every
problem at once rather than the first.

**Two people at once.** Saves are optimistic — every write carries the
revision it was based on, and a stale save opens a dialog naming who
saved over you and when, rather than silently clobbering their work.

## How it's scoped

The user I built for is someone who changes a schema on a branch and
needs to know, *before* merging, exactly what will happen. So diff and
merge-conflict readability was treated as the product itself, not as a
view onto it.

**Deliberately cut:**

- **Indexes.** The prompt names them, so this is a call rather than an
  oversight. Indexes are a per-table attribute that lengthens a diff
  without creating a new *kind* of conflict, and each such feature
  costs four layers — model, diff, merge rules, UI. Spending that on
  breadth would have come straight out of the rename and merge work
  above, which is where the actual difficulty lives. The snapshot
  format tolerates missing fields and the diff is a list of
  self-describing typed changes precisely so this stays cheap to add
  ([decisions.md #3](./decisions.md)).
- **Migration SQL output.** The merge produces the merged schema, not
  the `ALTER` statements to get there. Correct merging was the hard
  part worth owning; codegen is additive and would have eaten days.
- **Column defaults, composite unique constraints, composite foreign
  keys.** Same reasoning as indexes — each extends the model rather
  than posing a new problem, so they lost to depth on the core.
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
