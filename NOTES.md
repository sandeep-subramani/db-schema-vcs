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
