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
