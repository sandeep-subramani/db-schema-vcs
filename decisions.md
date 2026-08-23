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

---

## 8. SQL import — promoted from stretch to committed scope

**The decision:** Paste-SQL import moves from top-ranked stretch
item (decisions.md #4) to committed scope: it ships before day 5.
Day-1 design treats it as certain — the engine speaks only our
canonical types, and dialect-type translation is a data table at the
import boundary, so small enabling choices are made now rather than
retrofitted.

**The alternatives:** Keeping it stretch — rejected because "getting
a real schema in" is closer to minimum-viable than any deferred
column attribute; a schema VCS you can't feed an existing schema
demos as a toy.

**The reasoning:** The promotion changes planning, not architecture:
decision #4 already shaped the import as an adapter at the boundary
(parse SQL → emit our JSON shape → reuse existing validation), so
committing to it costs nothing today and roughly 0.5–1 day when
built. The parser-library dependency approval comes due at build
time, per the no-new-dependency rule.

**What I deliberately cut (deferred):** Choosing the target
dialect(s). Postgres-first is the working assumption; the call is
made when the import work is scheduled, and each dialect beyond the
first is its own cost (type audit + mapping rows, per decision #9).

---

## 9. Type system — own generic vocabulary, strict-equivalence dialect mapping

**The decision:** Column types use our own plain-language vocabulary,
copied from no SQL dialect — understandability to the user is the
first priority. Day-1 list: whole number (small / regular / large),
decimal number (exact), floating point (approximate), text (optional
length limit), true/false, date, time, date & time, unique ID,
binary data. Dialect types resolve to canonical types through a
mapping table with a strict rule: two dialect types collapse into
one canonical type only when they are genuinely equal by definition
and properties (MySQL INT and Postgres integer); a type that differs
even slightly gets its own isolated canonical type. The mapping is
extended lazily — each dialect's full type audit happens when that
dialect's SQL import is actually built, not upfront. Text length is
a per-column attribute sitting beside nullable (absent = no limit),
not part of the type value. Primary keys are table-level (a list of
column names), so composite keys work.

**The alternatives:** (a) Postgres-named vocabulary — rejected: ties
the UI's language to one vendor, and buys nothing since a
normalization table is needed anyway (real SQL says INT, int4,
SERIAL). (b) Coarse vocabulary that merges near-equal types —
rejected as lossy: an import that collapses TINYINT and BIGINT into
one "integer" can't re-export faithfully, and cross-dialect diffs
would lie about sameness. (c) Length baked into the type value
(text(255)) — rejected: as a sibling attribute, "length changed" is
its own typed change in the diff, distinct from "type changed" —
finer-grained, and the same additive path defaults/uniques will use
later. (d) Upfront audit of every dialect's types — rejected: days
of research that can't be verified until an import exists to test
against.

**Accepted tradeoffs:** The type dropdown grows as dialects are
audited, since near-duplicates stay distinct — fidelity chosen over
a minimal list. Mixed-origin histories (form commit, then SQL-import
commit) show two types as identical only when the map says they
truly are; near-matches surface as a type difference, which is
honest but may read as noise. The merge engine must catch
cross-attribute invalid combinations (branch A retypes a column away
from text while branch B changes its length) — a named day-3 test
case.

**What I deliberately cut:** Nothing beyond the lazy application —
no mapping rows exist until a dialect import is scheduled.

---

## 10. Unique constraints in scope now; FK rule matches real databases

**The decision:** Single-column unique constraints join committed
scope immediately — pulled out of the deferred trio from decision #3
(defaults and indexes stay deferred). Modeled as a per-column
boolean beside nullable; `unique: false` is normalized to absent so
stored snapshots have one canonical spelling. With uniqueness
available, the foreign-key target rule becomes what real databases
enforce: an FK must point at a column that is unique *on its own* —
either the target table's entire primary key is exactly that column,
or the column is marked unique. One column out of a composite
primary key is not a valid target.

**The alternatives:** (a) Keep the initial FK-targets-PK-only rule —
rejected: it forbids the legitimate FK-to-unique-column pattern
(e.g. referencing users.email), and inspection showed it was also
*looser* than real databases in another direction — it accepted an
FK pointing at one column of a composite PK, which doesn't identify
a row. Wrong in both directions, so "stricter but safe" wasn't true.
(b) Table-level constraint list supporting composite uniques
(UNIQUE(a,b)) — rejected for committed scope now: our FK model is
single-column, so a composite unique has nothing to couple to; it
roughly doubles the cost for a feature nothing else can use yet.

**The reasoning:** Cost measured at ~45 minutes now (model field,
validator rule, tests) plus ~1h riding along work already planned
(diff: one more typed change like nullable's; merge: same-column
conflict machinery plus one new cross-table case; UI: one toggle).
That's the low end of #3's 2–4h-per-feature estimate because unique
is a boolean — defaults and indexes are structurally bigger and stay
deferred. No rework: the tolerant snapshot format means old
snapshots without the field stay valid, proving the extensibility
commitment #3 made.

**Amendment to #3:** its claim that the deferred trio adds "diff
length, not new conflict types" was wrong for unique: the FK
coupling adds one cross-table conflict (branch A removes unique from
a column while branch B adds an FK pointing at it) — named as a
day-3 test case alongside FK-to-dropped-table.

**What I deliberately deferred (not cut):** Composite unique
constraints (UNIQUE(a, b)) — normal databases offer them, so the app
needs them eventually; they go on the stretch roadmap, picked up if
time permits. Deferred rather than committed because they need a
table-level constraint list (a structural addition, not a column
boolean) and our single-column FK model gives them nothing to couple
to yet — when picked up, they likely pair with composite FKs.
Defaults and indexes remain on the stretch roadmap unchanged.

---

## 11. Schema editor — client-held state, master–detail layout, cascade-with-confirm + undo

**The decision:** Three calls shaping the day-1 visual editor. (1) The
working schema lives in client memory for this task — no server
persistence yet. (2) Layout is master–detail: a table list in a
sidebar, the selected table edited in a wide column grid. (3)
Destructive edits that would break references (deleting an FK's target
column, un-uniquing a referenced column, growing a sole PK to
composite) cascade: the dependent foreign keys are removed too, but
never silently — a confirm dialog names each casualty before anything
happens, and afterwards a toast offers Undo (a full undo stack rides
along, Ctrl/Cmd+Z included, since immutable snapshots make it nearly
free).

**The alternatives:** (1) A minimal GET/PUT working-schema API now —
rejected because the very next task (branching) owns "auto-saved
working state" server-side and would rework that API days later;
accepted cost: a refresh loses edits until branching lands. (2) A
table-cards grid (whole schema on one surface, best for seeing FK
relationships) and a single-column document layout (simplest) — both
rejected for editing ergonomics: cards cramp the per-column controls,
the document scrolls badly past a few tables. The cards idea isn't
dead — it fits the diff view better than the editor. (3) Blocking the
edit until the user removes dependents by hand — rejected as busywork
on bigger schemas; allow-and-flag-invalid — rejected because it breaks
decision #4's core promise that the editor cannot produce an invalid
schema (every consumer would need to tolerate broken states).

**The reasoning:** For (3), the cascade mirrors what real databases do
with ON DELETE CASCADE on DDL, keeps every snapshot in the undo
history a valid schema (so undo, diff, and later commit never meet a
broken state), and the confirm + undo pair means the user is told
before and can recover after — the two failure modes of cascading
(surprise and regret) each get an answer.

**What I deliberately cut:** Redo (undo-of-undo) — plain undo covers
the recovery story; redo is bookkeeping with no demo value. Recording
editor operations for rename hints stays cut per decision #5.

---

## 12. Persistence — JSONB snapshots, real Postgres everywhere, hand-rolled boot migrations

**The decision:** Every stored schema version — each commit, and each
branch's working state — is a whole snapshot saved as one JSONB value
in one Postgres row. Local dev and tests run against real Postgres
installed via brew (`schema_vcs` for dev, `schema_vcs_test` for
tests, wiped and re-migrated per run); prod uses Render's managed
Postgres. The app's own tables (users, repos, branches, commits…) are
created by a hand-rolled migration runner: numbered `.sql` files
applied in order at server boot, tracked in a bookkeeping table —
the same path in dev and prod, since Render's free tier has no
pre-deploy step. (Terminology note, because the word collides: these
migrations build the app's own storage tables; the schemas the
product versions are just JSON documents in rows and never migrate.)

**The alternatives:** For commit storage: (a) delta chains — store
diffs, with periodic full snapshots — rejected because reading any
version then means replaying diffs, a second code path where any
apply() bug silently corrupts history, and the diff engine doesn't
exist until day 2, so a day-1 task would block on day-2 work.
(b) Normalized rows (a relational row per table/column/constraint
per version) — rejected: the largest migration surface and
reconstruction code in both directions, bought for SQL queries over
schema internals that no planned feature needs. For the dev/test
database: an in-memory storage interface (rejected — the Postgres
implementation becomes the least-tested code in the app; "works
locally, breaks on Render" becomes real) and pg-mem (rejected —
partial emulation, new dependency). For migrations: node-pg-migrate
was pre-approved as a dependency but declined on dev-time grounds —
its setup, conventions, and tooling cost more than the ~40 lines of
runner it would replace.

**The reasoning:** Snapshots are a few KB; duplicating unchanged
tables across commits is irrelevant at that scale, and whole-snapshot
rows make every read one query — "diff any two versions" is load two
rows and run the engine, with nothing to replay and nothing to
corrupt. Accepted tradeoffs: history storage grows linearly with
commits (fine at this scale), and local dev needs a one-time brew
Postgres install.

**What I deliberately cut:** Delta compression of history in any
form. A storage abstraction with swappable backends — nothing calls
for it; the repository functions talk to pg directly.

---

## 13. Multi-user scope — real users/repos/members model now, username-only identity, auth later

**The decision:** The product is multi-user: each user owns as many
repos as they want; each repo has its own fully isolated branch tree;
repos can be shared, and members of a shared repo work in a shared
workspace (shared branches, shared working states). The data model is
built for this from day one — `users` and `repos` tables, with each
repo carrying its member list in a column on its own row (product
owner's simplification over a separate membership table: one fewer
table to build; the accepted loss, referential integrity on member
ids, is moot while user deletion doesn't exist). Identity, though, is
deliberately lightweight: you claim a username (no password), the
client remembers it and attaches it to every request — cookie/session
machinery deferred entirely — and sharing a repo means appending a
username to the repo's member list.

**The alternatives:** (a) Full auth now — passwords or OAuth,
sessions, signup/login screens, invite flows — rejected: 1.5–2 of the
4 remaining days, colliding head-on with diff (day 2) and merge
(day 3), which the UX bar names as the product. (c) Repos only, no
users — rejected: no ownership or sharing story at demo time, and
retrofitting users later re-migrates everything. The original
single-workspace assumption was rejected by the product owner:
multi-user is the expected product shape.

**The reasoning:** The chosen shape buys the full demoable vision —
users, repos, sharing — for roughly half a day, because the real cost
of auth lives in credential and session security, not in the data
model. Swapping in real auth later touches only the identity layer;
repos, branches, and commits never change. Accepted tradeoff, stated
plainly: there is no security. Anyone who types a username is that
user. Fine for a demo; must be replaced before any real use.

**What I deliberately cut:** Live same-branch co-editing
(Google-Docs style) — CRDT/operational-transform territory, weeks not
days, cut from every option considered. Same-repo collaboration
happens naturally on separate branches; simultaneous edits to the
same branch are governed by the explicit-save model (entry pending).
Also cut: roles or permissions beyond member-or-not.

---

## 14. Seed schema demoted to a button; first run = first-commit gate page

**The decision:** The example web-shop schema stops being auto-loaded
anywhere, in every environment. A brand-new repo opens on a
first-commit gate page offering every entry door: upload/paste JSON,
build in the visual editor, and paste SQL — the SQL button rendered
but disabled with a "coming soon" tag until day 4 delivers it
(deliberately visible: the product owner wants the nag on every
viewing as a reminder that SQL import is committed scope, #8). The
example schema stays exactly one explicit click away — a "Load
example schema" button — for quick testing and worst-case demo
recovery, in dev and prod alike, but never becomes stored data on
its own.

**The alternatives:** Example behind a dev-only env flag — rejected:
kills the "quick confirmation in prod worst cases" use the product
owner explicitly wants. Example as test fixtures only — same
rejection, stronger. Auto-seeding the example as every repo's first
commit (the original reading of the UX bar) — rejected: real dev and
prod data must start from the user's own schema, not demo residue.

**The reasoning:** "No blank first run" is satisfied by design, not
by data: the gate page is a designed first-run with clear next
actions, so the empty state carries the UX weight the auto-seed used
to. CLAUDE.md's UX bar was reworded accordingly; this entry is the
history behind that edit.

**What I deliberately cut:** Auto-seeding in any environment, and any
separate "demo mode" build flavor — one build, one behavior.

---

## 15. Save model — explicit saves, dialogs only at truthful moments

**The decision:** Working state is written to the server only at
explicit moments: the Save button, a branch switch, and a commit
(which saves by definition). No debounced autosave, and no write of
any kind at tab close — closing with unsaved changes triggers the
browser's native "unsaved changes" prompt (the only dialog browsers
permit there), while in-app moments we control (switching branch
with dirty edits) get a real three-way dialog: save & continue /
discard / cancel. A save that would wipe out someone else's newer
save — same branch, another member or another tab — is caught by one
staleness check: the client sends the saved-at marker of the state
it loaded, the server compares it to what's stored, and only a
genuine mismatch raises the overwrite dialog: overwrite theirs /
reload theirs / cancel. Data loss therefore always requires the
user's explicit consent, and the dialog only appears when it is
telling the truth.

**The alternatives:** Debounced server autosave — rejected by the
product owner: saving should be a deliberate act, not chatter.
localStorage mirror + server sync — rejected: two copies of the
truth, the classic sync-bug factory. Confirm-on-every-save (no
staleness check, zero server logic) — seriously considered, rejected
after working through the UX: commits and branch switches are
genuinely rare, but the Save button is muscle memory, and this
model's own crash risk *rewards* saving often — an always-on dialog
punishes the safe habit and trains a click-through reflex that
defeats the warning in the one moment it matters. The feared
"version maintenance" cost of the staleness check dissolved on
inspection: one column and one comparison, no version history. A
custom save-&-close dialog at tab close — impossible: browsers only
show their own generic prompt there, and firing a save call from a
close handler is unreliable, which is exactly why nothing writes at
close.

**The reasoning:** UX is the bar this app is judged on (product
owner's framing), and the dialog rule follows from it: a dialog must
be rare and truthful or it becomes noise. Accepted residual risk,
stated plainly: a crash or power cut loses everything since the last
explicit moment — the price of explicit saves, shrunk by a visible
dirty indicator that nudges frequent saving.

**What I deliberately cut:** Any write at tab close. Autosave in any
form. Version history of working states — commits are the history.

---

## 16. Branch creation follows git: split at the last commit, carry the working changes

**The decision:** Creating a branch requires the source branch to
have at least one commit — git's own rule (you can't branch an empty
repo). The new branch splits at the source's latest commit: that
snapshot becomes the stored merge base (decisions.md #7), and a copy
of that commit — original message, author, timestamp — becomes the
new branch's first history entry, so every branch's history shows
where it split. The source's saved working state, including
saved-but-uncommitted changes, carries over as the new branch's
working copy — exactly like git carrying a dirty working tree
through `git switch -c`: start work on the wrong branch, branch off,
commit it there. The everyday flow the product owner spelled out
when picking this: branch off a branch with pending work, commit,
and the new branch shows two commits — the split point and the
carried work.

**The alternatives:** (a) Branch from the source's saved working
state ("branch from what you see") — built first, then flipped by
the product owner: the tool's audience uses git daily, and branching
should mean what their fingers already expect; the no-edge-case rule
wasn't worth the confusion, and its zero-commit fallback made some
merge bases states nobody ever committed. (b) Showing the source's
full ancestor history in the new branch, as `git log` would —
rejected for now: commits live in per-branch linear lists (#7), so a
combined view means walking parent branches; it's a read-only
feature that can be added later with no schema change. The copied
split-point commit is the honest middle: you see where the branch
started, not the source's whole past.

**The reasoning:** Familiarity beats cleverness — matching git means
nobody relearns what "branch" means in their own repos. The
one-commit requirement composes with the first-commit gate (#14),
which already funnels every new repo toward that first commit; the
UI disables branching until it exists and says why.

**What I deliberately cut:** Branching from a zero-commit branch
(clear 409 from the API; disabled button with the reason in the UI).
The full shared-ancestry history view, as above.

---

## 17. Confirmed renames cascade to PK/FK references — the diff shows one change, not three

**The decision:** When a rename is confirmed (auto-matched or
user-accepted), the diff reports exactly one change — the rename.
Primary keys and foreign keys that point at the renamed table or
column are not reported as changed: the diff compares them *through*
the rename (respelling the old side with the new names first), and
`applyDiff` rewrites those references automatically when it replays
the rename. A PK/FK change only appears in the diff when something
changed beyond the spelling — e.g. the key genuinely gained or lost
a column, or an FK moved to a different target.

**The alternatives:** (a) Report the ripple literally — a column
rename on a PK column also emits "primary key changed" and every
referencing FK as dropped + re-added. Rejected: it reports one edit
as three, and the extra two are lies — nothing about those keys
changed, they still point at the same column; a diff view full of
fake FK churn buries the real changes. (b) Emit the ripple as
explicit-but-flagged "follow-up" changes so apply stays a dumb
replayer. Rejected: two representations of one fact drift apart;
the flag would exist only to be ignored by every reader.

**The reasoning:** This matches what a real database does — renaming
a column doesn't drop your foreign keys, references follow the
object, not its spelling. Diff and apply agree by contract (diff
omits what apply rewrites), and the roundtrip tests
(apply(diff(A,B), A) = B, including FK-target renames) pin that
contract down so neither side can drift alone.

**What I deliberately cut:** Nothing user-visible; the cost is that
diff.ts and apply.ts must stay in step, which is exactly what the
roundtrip test suite exists to enforce.

---

## 18. Column and table order is not versioned — a pure reorder diffs as "no change"

**The decision:** The diff matches tables and columns by name, never
by position. Reordering columns in the editor (or a JSON import that
lists the same tables in a different order) produces an empty diff,
and the merge will therefore never see or conflict on ordering.
Column order is still *kept* — snapshots store arrays and the editor
and applyDiff preserve their order — it just isn't a versioned,
diffable property.

**The alternatives:** (a) Treat order as a diffable property with
"column moved" changes. Rejected: order carries no meaning in the
relational model — no constraint, type, or query result depends on
it — so a reorder "change" would be noise in the diff view and a
source of pointless merge conflicts (both branches touch the same
table, orders differ, conflict over nothing). (b) Canonicalize
storage (sort columns alphabetically) so the question disappears.
Rejected: authors lay out tables deliberately (id first, timestamps
last); destroying that layout to simplify the diff punishes the
editor experience for no diff benefit.

**The reasoning:** Version the things that change what the schema
*means*; preserve but don't diff the things that only change how it
*reads*. Roundtrip equality in the tests is checked order-insensitively
to match ("same schema" = same tables/columns/constraints,
whatever the listing order).

**What I deliberately cut:** "Column moved" as a change type, and
any UI affordance implying a reorder is a commit-worthy edit. If a
future SQL export needs stable column order, snapshots already keep
it — nothing is lost, it's just not compared.

---

## 19. Diff view v1 — commit-click + working review now, arbitrary picker committed to day 3; client-side diff; table cards; ephemeral rename answers

**The decision:** Five calls shaping the diff UI. (1) *Scope now:*
click a commit in the history panel to see what it changed against
its predecessor, plus a "Review changes" view comparing the schema on
screen with the branch's latest commit — the pre-commit moment. (2)
*The arbitrary two-version picker (any commit vs any commit, across
branches) is committed scope for day 3, built alongside merge — not
skippable:* comparing versions is UX support for the product's whole
point. (3) *The diff runs in the client:* the engine is already in
the bundle, so answering a rename question re-runs `diffSchemas`
instantly with zero round trips; the server only gained one read
endpoint, `GET /commits/:id` (snapshot by commit id, same membership
enforcement as every route). (4) *Presentation is a table-cards
grid* — every table a card; added/dropped cards tinted whole, changed
cards list their changes as marked lines, renamed cards badge "was
<old>", untouched tables collapse to one "Unchanged: …" strip. The
card grid is a dumb component that takes a change list, so the day-3
merge view composes two side by side for free. (5) *Rename answers
are ephemeral:* questions render as a banner above the cards, answers
re-render the diff in place and die with the view; nothing persists.
A branch's first commit (the copied split point, #16) renders as a
non-diff marker — "nothing was authored here, see the parent" — plus
a "branch point" badge on its history row, instead of lying that the
whole inherited schema was added.

**The alternatives:** For scope: commit-click only (covers less for
nearly the same cost) and the picker now (rejected after establishing
there is *no rework tax in either direction* — the picker is a leaf
entry point handing the same renderer a different pair, so it costs
the same whenever built; and the merge view never uses it, since
merge-into-parent (#7) fixes both sides by topology — so it competes
with merge for day 3 time instead of feeding it). Building it with
merge also lets its cross-branch case be designed knowing what merge
already covers ("my branch vs its parent" arrives free with merge).
For where the diff runs: a server-side diff endpoint — rejected: every
rename answer becomes a round trip, and it buys nothing since the
client already ships the engine. For presentation: a grouped
change-list (fastest, least visual — the diff view is the product,
per the UX bar) and a side-by-side split view (strong at a glance,
but wide, and collapsing unchanged tables eats the simplicity). For
the first-commit row: showing the inherited schema as all-added
(honest only on main, a lie on branches) or walking into the parent
branch for the true predecessor (the cross-branch history walk #16
already deferred).

**The reasoning:** Scope now covers the two questions users actually
ask — "what did this commit change?" and "what am I about to
commit?" — and leaves day 3 whole for merge, which the UX bar names
as the product. The picker's promotion to committed scope is the
product owner's call: a version-control tool that can't compare
arbitrary versions is missing its point, so it ships with merge
rather than riding the maybe-list.

**Accepted tradeoffs:** Cross-branch picker pairs with no ancestral
relation can present edits nobody made and nonsense rename questions —
the day-3 build must label or restrict those pairs. Two known rename
question behaviors were reviewed and accepted as-is: rejecting a
pairing only rules out that pair (the engine may re-ask against the
next-best candidate — the user said "a isn't x", not "a is nothing"),
and confirming a table rename can surface fresh column questions
inside the newly-paired table (the banner is a queue, not a fixed
checklist).

**What I deliberately cut:** Persisting rename answers anywhere (a
read-only view doesn't earn storage; merge will collect its own at
merge time). Diffing on the gate/empty states. Any caching layer for
commit snapshots — they're KB-sized reads.

---

## 20. Merge model — pick-a-side conflicts in grouped bundles, review-then-commit landing, git-strict inputs, branch survives with base advance

**The decision:** Four calls shaping day-3 merge. (1) *Resolution is
pick-a-side:* every conflict presents what each side did and the user
keeps one side. Colliding changes are bundled into connected groups
(if A collides with B and B with C, one pick decides all three), so
any combination of picks always yields a valid schema — each side's
own change list came from a valid snapshot, so keeping a whole group
from one side can't contradict itself. (2) *Landing:* a finished merge
does not auto-commit; it lands as the parent branch's saved working
state, where the existing "Review changes" diff and the editor are the
review step, and an explicit commit (prefilled message) makes it
history — decisions.md #15's deliberate-commit philosophy extended to
merges, and the editor doubles as the escape hatch when neither side
of a conflict is what the user wants. (3) *Inputs are git-strict:* the
merge merges the branch's latest commit into the parent's latest
commit; both branches' working states must be clean first (the UI
funnels through the existing save/commit dialogs), so "merged commit X
into commit Y" is always a true sentence. (4) *The source branch
survives the merge* and its stored base advances to the tip that was
merged, at the moment the merge commit lands on the parent (one
transaction), so continued work on the branch re-merges cleanly
instead of re-flagging everything already absorbed.

**The alternatives:** (1) Per-collision independent picks — rejected:
picks could combine into an invalid schema (keep a retype from one
side and a new FK from the other and the types no longer match); a
free-form three-pane merge editor — rejected as day-eating, and the
landing choice provides free-form editing anyway. (2) Auto-commit onto
the parent (git-like) — rejected by the product owner: the result
becomes history sight-unseen; accepted cost of the chosen shape is
that a merged-but-uncommitted working state can sit around (mitigated
by the dirty indicator), and that the merge overwrites the parent's
working state — which is why (3) requires it clean. (3) Merging saved
working states — rejected: working states aren't versions, so history
couldn't say what was merged, and the concurrent-edit corners
multiply. (4) Deleting the branch on merge (PR-style) — rejected: kills
the keep-working story and needs deletion plumbing that doesn't exist;
a delete-after-merge checkbox stays a cheap future option. Advancing
the base at merge-*compute* time instead of merge-commit time —
rejected: the parent could still discard the landed working state, and
the base would already have moved.

**The reasoning:** Pick-a-side with grouped bundles is the smallest
resolution model that is both readable and provably safe, and the
working-state landing reuses two screens that already exist (diff
review, editor) instead of building a third. Accepted residual corner,
stated plainly: if the user commits the landed merge without the
merge marker (e.g. after a reload loses the pending-merge context),
the branch's base never advances — nothing corrupts, since identical
changes on both sides merge silently clean, but a later merge may
re-ask rename questions it shouldn't.

**What I deliberately cut:** Any persistence of conflict resolutions
(they die with the merge attempt, like the diff view's rename
answers). Merge of dirty working states in any form.

---

## 21. Version picker — every pair allowed, unrelated pairs labeled, rename questions suppressed there

**The decision:** The day-3 arbitrary version picker (#19) allows any
commit vs any commit, including across branches. Pairs with no
ancestor relation (neither commit's branch is on the other's parent
chain) still render, but under an explicit banner — "different
branches: showing what differs, not what anyone did" — and rename
questions are suppressed for those pairs (differences show as plain
drop+add), because a rename question implies an edit history that
doesn't exist between unrelated versions.

**The alternatives:** Restricting pickable pairs to same-branch or
ancestor-line — rejected: comparing two sibling branches' takes on the
same feature is a legitimate use, and #19 committed to "any commit vs
any commit". Allowing rename questions everywhere — rejected: answers
to a question about a history nobody authored are noise at best.

**The reasoning:** Full comparison power with honest framing; the
relatedness check is a cheap walk over stored parent pointers.

**What I deliberately cut:** Nothing beyond the suppression; the
banner copy is a day-4 polish candidate.

---

## 22. Merge runs in the browser; the server's merge API is one read plus a commit marker

**The decision:** The three-way merge engine runs in the client,
exactly like the diff (#19). The server contributes two things only.
(1) One read, `GET /branches/:id/merge-context`, returning everything
a merge needs in a single request: the stored base, both branches'
latest commits, and both working states with their revision numbers.
(2) The existing commit endpoint accepts an optional *merge marker* —
two ids: the branch that was merged in, and the commit of it that was
merged — and, inside the same transaction as the commit, advances
that branch's stored base to that commit's snapshot (#20). Semantics
riding on this shape: a marker that doesn't check out (the named
branch isn't a direct child of the branch being committed to, or the
named commit isn't on it) rejects the whole commit — 400, nothing
written — instead of committing without the bookkeeping; a marker
naming an *older* tip of the merged branch is accepted, and the base
advances to exactly that commit, because that is what was actually
merged (#20's "the tip that was merged"); and the git-strict
preconditions (#20) are enforced by the UI funnel, not re-checked by
the server at commit time — the server cannot tell a landed merge
from any other working state, by design, since #20 makes the landed
state editable before commit.

**The alternatives:** (a) A server-side merge endpoint (send answers
and picks, get back conflicts or the merged schema) — rejected: every
rename answer and conflict pick becomes a round trip, the exact
interactivity cost #19 refused for the diff; the engine ships in the
client bundle regardless; and the server couldn't verify the final
result anyway, because the user may edit the landed state before
committing. (b) No context endpoint — compose the existing reads
(branch, parent, two commit fetches, two working states) — rejected:
five round trips for one screen, read at slightly different moments;
one read hands over one consistent bundle. (c) A dedicated
merge-commit endpoint instead of a marker on the existing commit
route — rejected: a merge commit *is* an ordinary commit of the
working state (#20), and a second route means duplicating the
save-and-stamp transaction, one more code path for the same write.
(d) When the marker doesn't check out, committing anyway and skipping
the base advance — rejected: that mints a commit whose message says
"merged" while the bookkeeping silently didn't happen; refusing whole
keeps "merged" and "base moved" inseparable.

**The reasoning:** #19 already decided where this kind of interactive
computation lives and why; the merge is the same shape with the same
question-answer loop, so it gets the same answer. The marker rides
the existing commit transaction because #20 demands the commit and
the base advance be one atomic act — bookkeeping anywhere else would
reopen the gap #20 closed. Accepted tradeoffs: the server validates
the committed snapshot like any other but trusts the client that it
is a *merge* result (unverifiable by design once post-landing edits
are allowed), and the cleanliness preconditions are client-enforced
only.

**What I deliberately cut:** Server-side re-checking of the
git-strict preconditions at merge-commit time. Once #20 lets the
user edit the landed state before committing, the server cannot tell
a merge commit's snapshot from any other working state, so a check
there would only pretend to verify; the UI funnel owns the
preconditions, as stated above.

---

## 23. SQL parser — pgsql-ast-parser, chosen by measurement

**The decision:** The paste-SQL import (#8) parses with
`pgsql-ast-parser` v12 (deps: `moo`, `nearley` — its tokenizer and
grammar runtime; ~48 KB gzipped in the client bundle). Postgres is
the first and only dialect for now (#8's working assumption,
confirmed).

**The alternatives:** `node-sql-parser` — the multi-dialect option,
preferred if it could parse Postgres, MySQL, *and* Oracle. Measured
against a corpus of ~40 common features per dialect plus a long-tail
corpus: MySQL 0% common misses (excellent), but **no Oracle grammar
exists** (14 dialects offered, Oracle absent; even the most charitable
best-of-any-grammar run rejected 53% of common Oracle DDL, including
basic `CREATE TABLE (id NUMBER(10))`), and its Postgres grammar
cannot read `timestamp with time zone` / `timestamptz` or
`GENERATED ALWAYS AS IDENTITY` — near-universal forms that pg_dump
emits, so real dumps would break immediately. Writing our own parser
stayed rejected per #4.

**The reasoning:** pgsql-ast-parser measured 0% misses on the common
Postgres corpus — every constraint form, both pg_dump ALTER styles,
serial, timestamptz, identity — and its tree carries exactly the
fields the translator needs (verified before adoption). Long-tail
misses (~38% of rare DDL: partitioned tables, triggers, grants, RLS,
COPY data, deferrable FKs) sit almost entirely outside what the
import consumes, and the split-then-parse-each-statement design turns
them into skip-list lines, not failures.

**Accepted tradeoffs:** Postgres-only — a future MySQL import brings
its own parser then (node-sql-parser would be the candidate, per its
0% MySQL score); each dialect is its own cost per #8/#9. Known gaps
that skip whole statements: bare `REFERENCES table` without a column
(Postgres infers the PK, the parser can't read the form — the skip
line says how to rewrite it), unquoted non-ASCII identifiers,
DEFERRABLE constraints, partitioned tables.

**What I deliberately cut:** Any pre-rewriting of pasted SQL to paper
over parser gaps (e.g. rewriting `timestamptz` for node-sql-parser,
or stripping DEFERRABLE) — text surgery on input we then claim to
have "parsed" is dishonest and fragile; the skip list tells the truth
instead.

---

## 24. Postgres type audit — auto-number family, timezone stamps, twin-type FK rule, consume line

**The decision:** Applying #9's strict-equivalence rule to the
Postgres audit adds five canonical types: **Auto number
(small/regular/large)** — used for serial/smallserial/bigserial *and*
GENERATED AS IDENTITY, and intended for other dialects'
serial-kind mechanisms (MySQL AUTO_INCREMENT) later — plus **Date &
time (with time zone)** (timestamptz) and **Time (with time zone)**
(timetz). The mapping table lives in engine/src/sql-import.ts.
Because pg_dump spells serial as integer + sequence default, the
importer recognizes `DEFAULT nextval(...)` and `ADD GENERATED ... AS
IDENTITY` and upgrades the column's type. One validator change rides
along: an FK may pair a whole number with its auto-number twin of the
same width (serial IS an integer underneath) — otherwise every real
dump (integer FK → serial PK) would fail validation. The editor's FK
target picker and FK sweep follow the same rule.

Types deliberately left homeless — their columns skip with a reason
while the table imports: json/jsonb, char(n) (space-padded), real
(4-byte float), interval, arrays, and all custom/exotic types.
Statements consumed: CREATE TABLE, ALTER TABLE ADD CONSTRAINT, ALTER
TABLE ADD COLUMN, plus the two auto-number patterns; everything else
is skip-listed with a plain reason.

**The alternatives:** (a) One width-less "Auto number" type —
rejected: #9's rule is that differing widths never share a type;
bigserial and smallserial diffing as identical would lie. (b) Strict
FK type equality kept — rejected: real imports break; hand-fixing
types after every import is not an import. (c) Canonical homes for
json/jsonb, char(n), real, interval too — available for later (each
is one mapping row + dropdown entry), declined now to keep the type
dropdown tight; the skip list keeps the omission honest. (d) Broader
ALTER support (DROP COLUMN, SET NOT NULL, RENAME) — declined for
day 4 scope; the consumed set covers pg_dump entirely plus simple
hand-written migrations.

**Accepted tradeoffs:** The dropdown gains five entries (17 total).
Identity columns lose their ALWAYS/BY DEFAULT nuance (both become
Auto number). numeric(p,s) imports as plain Decimal number with a
"precision dropped" note — precision/scale would be new column
attributes, deferred with defaults/indexes (#3). A schema using a
skipped type in a key loses that key, loudly (skip list names it).

**What I deliberately cut:** Nothing silently — every declined type
and every dropped attribute surfaces on the import's skip list, so
the cut is visible in the product, not just in this file.
