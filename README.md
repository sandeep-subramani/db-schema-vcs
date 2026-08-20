# Schema Version Control

Version control for database schemas: branch a schema, evolve it
independently, see exactly what diverged, and merge back with
conflict detection. Row data is out of scope — the schema itself
(tables, columns, types, constraints) is the versioned artifact.

**Live:** https://db-schema-vcs.onrender.com — free tier, so the
first load after idle can take ~50s to wake.

**Status:** day 0 — stack scaffolded (Vite + React + TS, Express 5,
Postgres on Render) and deployed; schema features land next.

- Decision log and tradeoffs: [decisions.md](./decisions.md)
- Built with Claude Code; every change is reviewed before commit.

## Setup

Requires Node ≥ 20.

```sh
npm install
npm run dev
```

Client on http://localhost:5173, API on :3000 (proxied — no CORS).
No database needed to run; to use one, copy `.env.example` to `.env`
and set `DATABASE_URL`. Checks: `npm test`, `npm run typecheck`,
`npm run lint`.

## Architecture

npm workspaces, three packages:

- `engine/` — schema model, diff, merge: pure framework-free
  TypeScript, tested in isolation
- `server/` — Express 5 API; in production also serves the built
  client (one host, one deploy)
- `client/` — Vite + React UI
