# Schema Version Control

Version control for database schemas: branch a schema, evolve it
independently, see exactly what diverged, and merge back with
conflict detection. Row data is out of scope — the schema itself
(tables, columns, types, constraints) is the versioned artifact.

**Live:** https://db-schema-vcs.onrender.com — free tier, so the
first load after idle can take ~50s to wake.

**Try it:** there is no password. The login page asks you to pick a
username, and typing one *is* signing in. Sign in as **`explorer`** to
land in an account that already has four repos, each parked in a
different state so nothing has to be built first:

| Repo | Opens on |
|---|---|
| `storefront` | A finished merge — commit history, per-commit diffs, cross-branch compare |
| `analytics` | Two branches that retyped the same column differently — the merge opens on a live conflict |
| `inventory` | A conflict-free merge still to walk: apply, review, commit |
| `first-run` | No commits yet — the entry doors a brand-new repo opens on |

Any other name starts you on an empty account instead.

**Status:** feature-complete on committed scope — visual schema
editor, JSON and Postgres-SQL import, branching, commit history,
diff (including rename detection), three-way merge with pick-a-side
conflict resolution, and an arbitrary any-commit-vs-any-commit
compare. The view-by-view UI redesign is merged. Remaining: stretch
items, in priority order — migration SQL output, column defaults and
indexes, composite unique constraints.

- Reviewing this as a submission? Start at
  [SUBMISSION.md](./SUBMISSION.md)
- Decision log and tradeoffs: [decisions.md](./decisions.md)
- Built with Claude Code; every change is reviewed before commit.

## Setup

Requires Node ≥ 20 and Postgres.

```sh
npm install
npm run dev
```

Client on http://localhost:5173, API on :3000 (proxied — no CORS).

The app needs a database to do anything. Without `DATABASE_URL` the
server still boots and `/api/health` reports `db: "not_configured"`,
but every data route answers 503 — you get a page you can't use. So:

```sh
brew install postgresql@17 && brew services start postgresql@17
/opt/homebrew/opt/postgresql@17/bin/createdb schema_vcs
/opt/homebrew/opt/postgresql@17/bin/createdb schema_vcs_test
cp .env.example .env          # DATABASE_URL is already filled in
```

The app's own tables are created at server boot by a migration
runner, so there's no migrate step to run by hand.

Checks: `npm test`, `npm run typecheck`, `npm run lint`. The engine
and client suites are self-contained; the server suite needs
`schema_vcs_test` to exist (it wipes and re-migrates it per run).

## Architecture

npm workspaces, three packages:

- `engine/` — schema model, diff, merge: pure framework-free
  TypeScript, tested in isolation
- `server/` — Express 5 API; in production also serves the built
  client (one host, one deploy)
- `client/` — Vite + React UI

Two choices explain most of the shape:

**Diff and merge run in the browser.** The engine ships in the
client bundle, so answering a rename question or picking a side in a
conflict re-runs the computation instantly with no round trip. The
server's job is storage plus two small things: one read that hands
a merge everything it needs in a single request, and a merge marker
on the commit endpoint that advances the merged branch's base inside
the same transaction as the commit (decisions.md #19, #22).

**Every version is a whole snapshot**, stored as one JSONB value in
one row — no delta chains to replay, so diffing any two versions is
two reads and a pure function (decisions.md #12).

The engine's tests are the ones that matter: `apply(diff(A,B), A)`
equals `B`, merges of non-overlapping changes equal both changes
applied, and conflict detection gives the same answer regardless of
branch order.
