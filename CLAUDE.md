# CLAUDE.md — Schema Version Control

## UI restyle rules
- We are refactoring the UI design view by view. The pre-redesign
  state of every view is screenshotted in design/current. Per view,
  I supply reference image(s) of the new look — build to that image;
  don't start a view I haven't given an image for.
- Presentation-only: change the JSX render markup and CSS alone.
  Never touch React component logic or structure — props, state,
  hooks, effects, handlers, context, data fetching, or component
  control flow.
- If matching the image requires a logic change, stop and prompt me
  first. When I approve one, keep it minimal and be careful: no UI
  breaks or bugs, existing behavior (validation, errors, busy/
  disabled states) must survive byte-identical wherever possible.
- After each screen: run tests/typecheck/lint, screenshot the result
  in both themes via browser tooling (Playwright or the DevTools
  MCP), and show it against the reference. New captures go in
  design/new. design/ is working material — never committed.
- Standing choices from pass 1 (login + theme switcher), applying to
  all later views:
  - The new palette is flipped globally in index.css tokens (violet
    accent, magenta --accent-2, near-black ground, --frame chrome,
    filled primary buttons). Style views with these tokens; don't
    reintroduce per-view palettes. Un-restyled views inheriting the
    new colors before their pass is expected.
  - Zoho Puvi is the UI typeface (--font-ui); --font-mono stack
    unchanged. It isn't on Google Fonts, so the @font-face rules at
    the top of index.css pull the woff2 files from Zoho's CDN
    (static.zohocdn.com, preconnected in client/index.html). Zoho
    ships a separate family per weight, each at font-weight: normal;
    we re-declare one family with real weights so the font-weight
    values used across index.css keep working. This replaced Space
    Grotesk, the pass-1 choice.
  - All the ref images may/may not come with the theme picker icon, 
    it shouldn't be skipped - each and every page should have it.

## What this is
Web app: version control for database schemas — branch a schema,
evolve it independently, diff the branches, and merge back with
conflict detection. Row data is out of scope; the schema itself
(tables, columns, types, constraints) is the versioned artifact.
Timebox: 5 days to a deployed URL. Scope decisions follow from that.

## Commands
All from repo root (npm workspaces: engine/, server/, client/):
- `npm run dev` — server (:3000) + client (:5173, proxies /api)
- `npm test` — Vitest across packages (`npm run test:watch` to watch)
- `npm run typecheck` — tsc --noEmit in every workspace
- `npm run lint` — ESLint (flat config at repo root)
- `npm run build` — client production bundle → client/dist
- `npm start` — production server; serves client/dist when
  NODE_ENV=production

## Working agreement — IMPORTANT
- I make every meaningful decision: architecture, scope, product, UX.
  Your job: lay out all realistic options with plain tradeoffs — what
  each costs, what it buys, where it breaks — then stop and wait for
  my pick. If a decision surfaces mid-task, pause and ask. NEVER
  choose for me.
- Once a decision is made, implementation is yours. Small details
  inside an agreed structure (naming, file layout) don't need approval.
- I'm strongest on frontend. Before building backend or algorithm
  pieces, explain the approach in plain language — short sentences,
  an analogy if it helps — so I can verify it and defend it later.
  Nothing ships that I can't explain.
- Work in small steps. Before any multi-file change, show a short
  plan and wait for my go.
- At session start, read PLAN.md to see where we are.
- Keep threads small, context isolated. At every checkpoint
  (task done, commit suggested), check: does the next task depend on
  anything that lives only in this thread's context? If not, say so
  and suggest switching to a fresh chat instance. Before suggesting,
  ensure everything needed across instances is written down where it
  belongs (PLAN.md status, decisions.md entries, NOTES.md
  explanations, rules here); a thread's context must never be the
  only home of something a future thread needs.
- If our working rules change, update this file so the next session
  knows.

## Decision state
- Made decisions live in decisions.md (repo root) — read it when you
  need history or context. If it's not there, it wasn't decided.

## decisions.md format
Every meaningful decision gets logged there as it happens: the
decision / the alternatives seriously considered / the reasoning and
accepted tradeoffs / what was deliberately cut and why. Specific
beats generic. Weak: "Chose a visual editor because it's simpler."
Strong: "Chose a visual editor over SQL parsing for input because
parser edge cases would eat two of five days; accepted that existing
schemas can't be imported yet; kept parsing as a stretch goal."

## Engineering rules
- Core engine (schema model, diff, merge) = pure functions, no UI or
  framework imports, testable in isolation.
- Code a teammate could pick up cold. SOLID as a smell check — single
  responsibility, clear interfaces, no god objects — but no
  speculative abstraction: introduce a design pattern only when the
  problem visibly calls for it, and say which one and why. Simple
  functions beat clever indirection.
- Tests must catch real failures. The kind that matter here:
  apply(diff(A,B), A) equals B; merging branches that touched
  different things equals both changes applied; conflict detection
  gives the same answer regardless of branch order.
- Validate every external input: pasted SQL or JSON, request bodies.
- IMPORTANT: no new dependency without asking — name it, why it's
  needed, one alternative.
- Never invent APIs. Unsure something exists → check docs or say so.
- No secrets in the repo. .env locally, .env.example committed.

## Definition of done — every task
1. Tests green; typecheck and lint clean. Run them yourself before
   reporting done.
2. NOTES.md: append a short plain-language explanation of what was
   built and why it's shaped that way.
3. decisions.md: entry exists for any decision made along the way —
   remind me if one is missing.
4. PLAN.md: tick or update the task.
5. Tell me it's commit time and suggest a message per the commit
   convention in CONTRIBUTING.md. NEVER run git commit — I commit
   myself.

## UX bar
- No blank first run — a new repo opens on a first-commit gate page
  offering every entry door: upload/paste JSON, visual editor, SQL
  import (shown disabled with a "coming soon" tag until built). The
  example schema is never auto-seeded; it loads only via an explicit
  button (decisions.md #14).
- Design empty states and error messages, not just the happy path.
- Diff and merge-conflict views must be readable at a glance; that IS
  the product.
