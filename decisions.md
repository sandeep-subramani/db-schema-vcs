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
