# decisions.md

Running log of the real calls made while building — what I chose,
what else I seriously considered, why, and what I deliberately cut.
Entries are added as decisions happen, newest at the bottom.

---

## 1. Problem choice — version control for database schemas

**The decision:** Build problem #2: branch, diff, and merge for
database schemas.

**The alternatives:** #1 (turn messy documents into structured,
queryable data) and #3 (pick my own problem).

**The reasoning:** The hard part of #2 is deterministic logic — a
snapshot diff can't tell a rename apart from a drop + add, and a
three-way merge has to detect real conflicts like the same column
retyped differently on two branches. That's logic I can own
architecturally and verify with hard assertions, instead of judging
model output by eye. It needs no external APIs or per-request costs,
so the deployed demo can't fail live or get abused. And the diff /
merge-conflict UI has no standard template to copy, which makes the
frontend work original design rather than assembly — that plays to my
strength while the engine stretches me. I rejected #3 because I
didn't walk in with a problem that has a genuine hard part, and
inventing one inside the timebox would burn day 0 on justifying a
premise. Tradeoff accepted: #1 is closer to real document-AI product
territory; #2 shows less of that domain and more systems depth.

**What I deliberately cut:** Nothing yet at this level — the cuts
start with the next decisions (input method, diff approach, feature
tiers).

---

## 2. Stack — Vite/React/TS + Express 5, Render + managed Postgres, Vitest

**The decision:** Classic client-server split: Vite + React +
TypeScript frontend, Express 5 + TypeScript backend. One host, one
deploy — Express serves the built frontend bundle in production
(same origin, so CORS never exists; Vite's dev proxy covers local
dev; SPA fallback as middleware, since bare `*` routes broke in
Express 5). Hosted on Render's free tier with its managed Postgres
for storing schema snapshots/branches. Vitest for tests.

**The alternatives:** (a) Client-only Vite SPA with localStorage —
rejected as too minimal; no server-side persistence at all.
(b) Next.js on Vercel — rejected for framework weight: the
server/client component split and caching magic are overhead to
learn and defend, and none of its features are needed here.
(c) Vite + bare Vercel serverless functions — leanest option, but
serverless has no long-running process and Vercel has no disk;
rejected together with the Vercel path. (d) Railway + SQLite on a
volume — equally viable pairing (~$5, no cold starts, simplest
storage story); the final tiebreak was integration/dev-environment
ease, nothing architectural. (e) Fly.io — best cold starts and
regions, but CLI-first ops and unmanaged Postgres are a week of
learning that doesn't fit the timebox.

**The reasoning:** The split keeps frontend and backend independently
swappable, which matters because hosting is the least certain piece —
a plain Express server is the most portable backend shape and moves
hosts in about an hour. Render was picked over Railway for
push-to-deploy simplicity (no CLI, no config file) on a genuinely
free tier. Postgres over SQLite because Render's free filesystem is
wiped on restart, so a file database can't live there. Vitest because
it's Vite-native: same config and TS pipeline, zero extra setup, and
it covers both the pure engine functions and Express handlers.

**Accepted tradeoffs:** Free-tier cold starts (~50s first hit after
idle) — a demo-day problem with cheap fixes (demo from localhost,
pay ~$7 for the week, or a keep-warm ping), not an architecture
decider. Free Postgres auto-expires after 30 days — fine for the
demo window; upgrade or dump/restore elsewhere if the app must
outlive it.

**What I deliberately cut:** Vercel entirely (no long-running server,
no disk), SQLite (host constraint), Fly.io (ops burden), Jest (buys
nothing over Vitest here, costs its own config layer).

---

## 3. Feature tiers — core + foreign keys now, column extras as roadmap

**The decision:** The engine ships with tables, columns, types,
nullability, primary keys, and foreign keys (tier "B"). Defaults,
unique constraints, and indexes go on the roadmap as incremental
extensions — pushed for if time permits, not committed scope. Two
design commitments made now so those extensions stay cheap: (1) the
stored snapshot format tolerates missing fields (absent = feature
not used), so old branches keep loading when the model grows; (2)
the diff is a list of self-describing typed changes, so a new
feature adds a new change type without touching existing ones.

**The alternatives:** (a) Bare core without FKs — rejected because
FKs are the one feature that changes the merge engine's *core* cases
(cross-table conflicts like "FK added to a table the other branch
dropped") rather than extending a list; retrofitting them after the
merge engine exists means reopening conflict detection and its test
matrix — a day-plus later versus roughly half a day now. (b)
Committing defaults/uniques/indexes upfront — rejected as committed
scope because each feature costs four layers (model, diff, merge
rules, UI) and three more features would eat the day-4 product pass;
they add diff length, not new conflict types. Kept as roadmap since
they're per-column attributes mechanically similar to nullability
(~2–4 hours each, no structural change) and only a bit above
bare-minimum for a credible schema VCS.

**The reasoning:** B is the cheapest tier that produces a conflict
category worth demoing — two branches each valid alone, broken only
in combination. Starting at B also makes every later adaptation
easier: the extensible-snapshot and typed-change-list commitments
mean the roadmap features are additive, not rework.

**What I deliberately cut:** Triggers, views, stored procedures, and
check constraints — their content is arbitrary SQL, so without a
parser diffing them degrades to plain-text "something changed,"
which undercuts the whole pitch; not worth it under the timebox.
Multiple SQL dialects — each one multiplies the type vocabulary and
validation rules; one Postgres-flavored type set keeps the engine
honest.

---

## 4. Schema input — visual editor front door, JSON side door; SQL import deferred as top stretch

**The decision:** Primary input is a visual editor: add table / add
column forms, type dropdown, nullable toggle, PK marker, FK defined
by picking an existing table and column. JSON import/export rides
along as a secondary path since the engine needs a JSON schema
representation internally anyway — import is the same validation the
API already runs on request bodies. Paste-SQL import is deferred but
ranked as the **highest-priority stretch feature**, above the
deferred schema features from decision #3, because "getting a schema
in" is closer to minimum-viable than extra column attributes.

**The alternatives:** (a) Paste-SQL as the primary input — rejected
for day 1 because it needs a SQL parser: hand-writing one risks
parser edge cases eating two of five days, and a library still costs
a new dependency, AST-to-model mapping, graceful handling of
unsupported statements, and an error-message UX for unbounded input.
(b) JSON as the primary input — rejected as hostile: nobody has
their schema in our invented format, so as a front door it amounts
to hand-writing a config file. It stays as the power-user side door
and doubles as the export format for free.

**The reasoning:** The editor makes invalid input structurally
impossible (a dropdown can't produce an unsupported type; the FK
picker only offers tables that exist), eliminating the parse/error
zoo entirely, and it plays to my frontend strength. Deferring SQL
import carries no retrofit tax: it's an adapter at the boundary —
parse SQL, emit the same JSON schema shape, reuse the existing
validation and import path — and never touches engine, diff, merge,
or storage. Its cost (~0.5–1 day with a parser library, dependency
approval required then) is identical whether built on day 1 or day
4. Note: dropping SQL *input* now does not make migration-SQL
*output* (decision #5, still open) harder — generating SQL is string
building; parsing is the hard direction.

**What I deliberately cut:** Nothing beyond the deferral itself;
seed example schema covers the demo gap until SQL import lands.

---

## 5. Diff approach — snapshot comparison + rename heuristics + user confirmation

**The decision:** The diff engine compares two full schema
snapshots, state against state. The ambiguous case (a column or
table disappears and a similar one appears — rename, or drop+add?)
is resolved by heuristics (same table, same type, similar shape →
probably a rename) with a user-confirmation step whenever the
heuristic isn't sure. Recorded editor operations as rename *hints*
(the hybrid's extra layer) are deferred to the future — additive on
top of this engine, not a rework of it.

**The alternatives:** (a) Recorded edit operations as the diff — the
visual editor logs every action ("renamed username → login_name"),
and the diff is the log. Rejected because it only works with
restrictions: it covers editor-made changes only. JSON-imported (and
later SQL-imported) schemas arrive with no operation history, so
snapshot comparison would have to be built anyway — two systems for
one job. The diff is the core of a diff tool and has to work between
any two versions regardless of origin. Also, if history is ever
missing or wrong (import, a logging bug, an undo edge case) an
operation log silently lies, while a snapshot diff at worst asks the
user a question. (b) Hybrid upfront — rejected for now as extra work
layered on A (a hint channel plus reconciliation between two sources
of truth); kept as a future refinement since it's purely additive.

**The reasoning:** Snapshot diff is the foundation in every
scenario — both alternatives still need it. It keeps the engine pure
functions of two states, works with the snapshot storage we already
chose, and is honest about ambiguity instead of hiding it. The
confirmation step doubles as UX: "diff proposes, human confirms
renames" is a readable, demoable moment that fits the "diff view IS
the product" bar.

**What I deliberately cut:** Operation logging entirely for now — no
half-built hint plumbing until the hybrid layer is actually
scheduled.

---

## 6. Merge output — merged schema only; migration SQL as stretch

**The decision:** A successful merge produces the merged schema (the
new state of the target branch). Migration SQL — the `ALTER TABLE`
statements that would turn the pre-merge database into the merged
one — is not committed scope. It sits on the day-4 stretch roadmap,
welcome only if everything committed lands early.

**The alternatives:** (a) Cutting migration SQL entirely — rejected
because the deferral is free: generation consumes the diff's typed
change list and emits strings, touching no engine internals, so it
costs the same on day 4 as on day 1 and there's no reason to close
the door. (b) Committing it as day-3/4 scope — rejected because the
product is the diff and the version history: showing what changed
across every keyword and identifier a schema contains. Migration SQL
is an add-on onto that product, not part of it, and its real cost is
more than the ~0.5–1 day of generation — subtly wrong SQL is worse
than none (people paste it into live databases), so committing it
means committing to proper ordering/FK/type-change tests too. Not
worth it inside a 5-day window.

**The reasoning:** Days 3–4 stay focused on merge correctness and
the conflict UX, which our own UX bar names as the product. The
choice of *which* stretch item fills day 4's realistic single slot
(SQL import, currently ranked first, vs migration SQL) is deferred
to day 4 itself, when we'll know how the week actually went.

**What I deliberately cut:** Any commitment to migration-SQL
correctness testing for now — it's part of the stretch item's cost
if and when it's picked up, not a standing obligation.

---

## 7. Branch model — tree of branches, merge into parent only, explicit commits

**The decision:** Branches form a tree: any branch can be created
from any branch (nesting allowed), and each branch records its
parent plus the snapshot it was created from. Merging goes in one
direction only — a branch merges into its parent (for branches off
main, that's main; a nested branch merges into the branch it came
from, never skip-level into main). Within a branch, versions are
explicit commits: edits accumulate in an auto-saved working state,
and "commit" (with a message) stamps a snapshot into the branch's
linear history. The reverse merge direction — parent into branch,
i.e. "update a stale branch from its parent" — is deferred to the
future roadmap; the merge engine already does that work (same
three-way merge, other direction), the deferred cost is the base
bookkeeping (after absorbing the parent, the branch's base must
advance, or the final merge re-flags already-resolved conflicts).

**The alternatives:** (a) Flat model (branches off main only) —
rejected because branch-off-branch is a required feature. (b) Full
graph (arbitrary merge directions) — rejected after working through
where its cost actually lives. The three-way merge engine itself is
topology-independent (given base + two tips it doesn't care about
the graph), but arbitrary-direction merges force the *base* to be
computed instead of read: the most recent common ancestor of two
tips in a history graph. That means parent pointers on every
snapshot (two for merge commits), an ancestor-search step before
every merge, and the criss-cross case — two equally recent common
ancestors with no right pick, which git solves by recursively
merging the bases themselves. Feeding a robust engine the wrong base
produces confidently wrong answers: changes from before the real
divergence appear in both diffs as phantom changes, renames get
mis-inferred, conflicts get reported that never existed. On top of
the engine: the test matrix roughly doubles (every conflict property
per topology shape) and the branch UI becomes a DAG visualization —
the hardest screen in every git GUI — competing directly with the
diff/merge views our UX bar names as the product. Realistic total:
2–3 extra days. The tree model delivers the visible feature
(nesting) at near-flat cost because the base stays a stored field:
zero ambiguity, no graph search, and history a branch list can show
by simple indentation. (c) For versions: current-state-only rejected
(no history to show — history is half the product's goal);
auto-version-every-save rejected (hundreds of message-less versions
make history noise, undermining the readability it seems to serve).

**The reasoning:** Explicit commits give a real, demoable timeline —
diff between any two versions falls out of the snapshot-diff engine
for free (decisions.md #5), and commit messages make the history
readable. Merge-into-parent-only keeps every merge's base a single
stored snapshot, preserving the correctness guarantees the whole
engine is built on, while still allowing the branch nesting the
product requires.

**What I deliberately cut:** Skip-level merges (nested branch
straight into main) — they reintroduce ancestor computation, the
exact cost the tree model avoids. Rebase in any form — out of scope
entirely, not deferred.
