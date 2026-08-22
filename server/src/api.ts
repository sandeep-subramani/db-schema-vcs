// HTTP boundary: parses and validates every external input (request
// bodies, URL params, the identity header), maps store results to
// status codes, and nothing else — all storage logic lives in
// store.ts, all schema validation in the engine's validateSchema.
//
// Identity (decisions.md #13): the client sends its claimed username
// in an x-username header on every request — no cookies, no sessions.
// Every data route requires it and store queries enforce membership.

import express from "express";
import type pg from "pg";
import { validateSchema, type Schema } from "engine";
import {
  addMember,
  commitWorking,
  createBranch,
  createRepo,
  ensureUser,
  getRepo,
  getWorkingState,
  isUniqueViolation,
  listBranches,
  listCommits,
  listRepos,
  saveWorking,
  userExists,
} from "./store.ts";

// Usernames travel in an HTTP header and double as display names, so
// they stay ASCII-simple: 1–32 chars of a-z 0-9 - _ (case-folded).
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const USERNAME_RULES =
  "1–32 characters: lowercase letters, digits, dashes or underscores, starting with a letter or digit";

export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const username = raw.trim().toLowerCase();
  return USERNAME_PATTERN.test(username) ? username : null;
}

// Ids and revs are int4 in Postgres; anything bigger must be rejected
// here or pg raises "value out of range" and the request 500s.
const MAX_INT4 = 2_147_483_647;

// NUL bytes and lone surrogate halves are valid JSON but unstorable in
// Postgres text columns — reject them like any other bad input.
// eslint-disable-next-line no-control-regex -- matching control chars is the point
const CONTROL_OR_BROKEN = /[\u0000-\u001f\u007f]|\p{Surrogate}/u;

/** Trimmed, storable 1–`max` char string from a request body, else null. */
function readName(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length < 1 || value.length > max) return null;
  return CONTROL_OR_BROKEN.test(value) ? null : value;
}

function readId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 && id <= MAX_INT4 ? id : null;
}

/** Positive int4 from a JSON body value, else null. */
function readIdValue(raw: unknown): number | null {
  return typeof raw === "number" &&
    Number.isInteger(raw) &&
    raw > 0 &&
    raw <= MAX_INT4
    ? raw
    : null;
}

/** Body must carry a valid snapshot and the rev it was loaded at. */
function readSnapshotAndRev(
  body: unknown,
  res: express.Response,
): { snapshot: Schema; expectedRev: number } | null {
  const { snapshot, expectedRev } = (body ?? {}) as Record<string, unknown>;
  if (
    !Number.isInteger(expectedRev) ||
    (expectedRev as number) < 0 ||
    (expectedRev as number) > MAX_INT4
  ) {
    res.status(400).json({
      error: "expectedRev must be the rev number this state was loaded at",
    });
    return null;
  }
  const result = validateSchema(snapshot);
  if (!result.ok) {
    res.status(400).json({
      error: "That schema isn't valid",
      details: result.errors,
    });
    return null;
  }
  return { snapshot: result.schema, expectedRev: expectedRev as number };
}

export function createApi(pool: pg.Pool): express.Router {
  const api = express.Router();

  // The one identity-free route: claiming a username IS logging in.
  api.post("/users", async (req, res) => {
    const username = normalizeUsername((req.body ?? {}).username);
    if (!username) {
      res.status(400).json({ error: `That username won't work — ${USERNAME_RULES}.` });
      return;
    }
    await ensureUser(pool, username);
    res.status(201).json({ username });
  });

  // Everything below requires a known user.
  api.use(async (req, res, next) => {
    const username = normalizeUsername(req.header("x-username"));
    if (!username || !(await userExists(pool, username))) {
      res.status(401).json({ error: "Unknown user — claim a username first" });
      return;
    }
    res.locals.username = username;
    next();
  });

  // --- repos ----------------------------------------------------------

  api.get("/repos", async (_req, res) => {
    res.json({ repos: await listRepos(pool, res.locals.username as string) });
  });

  api.post("/repos", async (req, res) => {
    const username = res.locals.username as string;
    const name = readName((req.body ?? {}).name, 64);
    if (!name) {
      res.status(400).json({ error: "Give the repo a name (1–64 characters)" });
      return;
    }
    try {
      res.status(201).json(await createRepo(pool, username, name));
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: `You already have a repo named "${name}"` });
        return;
      }
      throw error;
    }
  });

  api.get("/repos/:repoId", async (req, res) => {
    const username = res.locals.username as string;
    const repoId = readId(req.params.repoId);
    const repo = repoId ? await getRepo(pool, repoId, username) : null;
    if (!repo || !repoId) {
      res.status(404).json({ error: "No such repo (or you're not a member)" });
      return;
    }
    const branches = await listBranches(pool, repoId, username);
    res.json({ repo, branches });
  });

  api.post("/repos/:repoId/members", async (req, res) => {
    const username = res.locals.username as string;
    const repoId = readId(req.params.repoId);
    const newMember = normalizeUsername((req.body ?? {}).username);
    if (!newMember) {
      res.status(400).json({ error: `That username won't work — ${USERNAME_RULES}.` });
      return;
    }
    const result = repoId
      ? await addMember(pool, repoId, username, newMember)
      : null;
    if (!result) {
      res.status(404).json({ error: "No such repo (or you're not a member)" });
      return;
    }
    if (!result.ok) {
      const message =
        result.reason === "no-such-user"
          ? `No user named "${newMember}" yet — ask them to open the app and claim it first`
          : `"${newMember}" already has access to this repo`;
      res.status(409).json({ error: message });
      return;
    }
    res.json({ repo: result.repo });
  });

  // --- branches ---------------------------------------------------------

  api.post("/repos/:repoId/branches", async (req, res) => {
    const username = res.locals.username as string;
    const repoId = readId(req.params.repoId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = readName(body.name, 64);
    const fromBranchId = readIdValue(body.fromBranchId);
    if (!name || !fromBranchId) {
      res.status(400).json({
        error: "A branch needs a name (1–64 characters) and a fromBranchId",
      });
      return;
    }
    try {
      const result = repoId
        ? await createBranch(pool, repoId, username, name, fromBranchId)
        : null;
      if (!result) {
        res.status(404).json({ error: "No such repo or source branch" });
        return;
      }
      if (!result.ok) {
        res.status(409).json({
          error:
            "That branch has no commits yet — make its first commit before branching from it",
        });
        return;
      }
      res.status(201).json({ branch: result.branch });
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: `This repo already has a branch named "${name}"` });
        return;
      }
      throw error;
    }
  });

  api.get("/branches/:branchId", async (req, res) => {
    const username = res.locals.username as string;
    const branchId = readId(req.params.branchId);
    const state = branchId
      ? await getWorkingState(pool, branchId, username)
      : null;
    if (!state) {
      res.status(404).json({ error: "No such branch (or you're not a member)" });
      return;
    }
    res.json(state);
  });

  api.put("/branches/:branchId/working", async (req, res) => {
    const username = res.locals.username as string;
    const branchId = readId(req.params.branchId);
    const input = readSnapshotAndRev(req.body, res);
    if (!input) return;
    const result = branchId
      ? await saveWorking(pool, branchId, username, input.snapshot, input.expectedRev)
      : null;
    if (!result) {
      res.status(404).json({ error: "No such branch (or you're not a member)" });
      return;
    }
    if (!result.ok) {
      res.status(409).json({ conflict: result.conflict });
      return;
    }
    res.json({ rev: result.rev, savedAt: result.savedAt });
  });

  api.post("/branches/:branchId/commits", async (req, res) => {
    const username = res.locals.username as string;
    const branchId = readId(req.params.branchId);
    const message = readName((req.body ?? {}).message, 200);
    if (!message) {
      res.status(400).json({
        error: "A commit needs a message (1–200 characters)",
      });
      return;
    }
    const input = readSnapshotAndRev(req.body, res);
    if (!input) return;
    const result = branchId
      ? await commitWorking(pool, branchId, username, message, input.snapshot, input.expectedRev)
      : null;
    if (!result) {
      res.status(404).json({ error: "No such branch (or you're not a member)" });
      return;
    }
    if (!result.ok) {
      res.status(409).json({ conflict: result.conflict });
      return;
    }
    res.status(201).json({ commit: result.commit, rev: result.rev, savedAt: result.savedAt });
  });

  api.get("/branches/:branchId/commits", async (req, res) => {
    const username = res.locals.username as string;
    const branchId = readId(req.params.branchId);
    const commits = branchId
      ? await listCommits(pool, branchId, username)
      : null;
    if (!commits) {
      res.status(404).json({ error: "No such branch (or you're not a member)" });
      return;
    }
    res.json({ commits });
  });

  return api;
}
