// API client: every call attaches the claimed username (decisions.md
// #13) and normalizes errors into ApiError, so screens deal in typed
// results instead of fetch plumbing. The response shapes mirror
// server/src/store.ts — duplicated on purpose, the client can't
// import server code.

import type { Schema } from "engine";
import { session } from "./session.ts";

export interface Repo {
  id: number;
  name: string;
  owner: string;
  members: string[];
  createdAt: string;
}

export interface Branch {
  id: number;
  repoId: number;
  name: string;
  parentBranchId: number | null;
  commitCount: number;
  createdAt: string;
  /** Last save on that branch's working state — null before the first
   *  one. Rides along with the branch list, so the repo home can show
   *  every branch's recency without a request per branch. */
  savedBy: string | null;
  savedAt: string | null;
}

export interface WorkingState {
  branch: Branch;
  snapshot: Schema;
  rev: number;
  savedBy: string | null;
  savedAt: string | null;
}

export interface CommitMeta {
  id: number;
  branchId: number;
  message: string;
  author: string;
  createdAt: string;
}

/** One branch's side of a merge (mirrors server MergeSideState). */
export interface MergeSideState {
  branch: Branch;
  tip: { commit: CommitMeta; snapshot: Schema };
  working: {
    snapshot: Schema;
    rev: number;
    savedBy: string | null;
    savedAt: string | null;
  };
}

/** Everything a merge needs in one read (decisions.md #20): the
 *  stored base plus both sides' tips and working states. */
export interface MergeContext {
  source: MergeSideState;
  parent: MergeSideState;
  base: Schema;
}

/** Rides on a commit to record a merge: the merged branch and the tip
 *  that was merged. The server advances that branch's base with the
 *  commit, in one transaction (decisions.md #20). */
export interface MergeMarker {
  sourceBranchId: number;
  mergedCommitId: number;
}

/** A stale save: someone saved rev `rev` after we loaded ours (decisions.md #15). */
export interface SaveConflict {
  rev: number;
  savedBy: string | null;
  savedAt: string | null;
}

export type SaveOutcome =
  | { ok: true; rev: number; savedAt: string }
  | { ok: false; conflict: SaveConflict };

export type CommitOutcome =
  | { ok: true; commit: CommitMeta; rev: number; savedAt: string }
  | { ok: false; conflict: SaveConflict };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: string[],
  ) {
    super(message);
  }
}

async function rawRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const username = session.getUsername();
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(username ? { "x-username": username } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the server — is it running?", 0);
  }
  if (response.status === 401) {
    // The stored username is unknown to the server (e.g. a reset dev
    // database). Start over at the gate instead of erroring forever.
    session.clear();
    window.location.reload();
  }
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, payload };
}

function toError(status: number, payload: Record<string, unknown>): ApiError {
  return new ApiError(
    typeof payload.error === "string" ? payload.error : "Something went wrong",
    status,
    Array.isArray(payload.details) ? (payload.details as string[]) : undefined,
  );
}

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const { status, payload } = await rawRequest(method, path, body);
  if (status >= 400) throw toError(status, payload);
  return payload;
}

/**
 * Like request, but a 409 carrying a `conflict` body is data — the
 * stale-save signal of decisions.md #15 — not an error.
 */
async function requestAllowingConflict(
  method: string,
  path: string,
  body: unknown,
): Promise<
  | { conflict: SaveConflict; payload?: undefined }
  | { conflict?: undefined; payload: Record<string, unknown> }
> {
  const { status, payload } = await rawRequest(method, path, body);
  if (status === 409 && payload.conflict) {
    return { conflict: payload.conflict as SaveConflict };
  }
  if (status >= 400) throw toError(status, payload);
  return { payload };
}

export const api = {
  async claimUser(username: string): Promise<string> {
    const payload = await request("POST", "/users", { username });
    return payload.username as string;
  },

  async listRepos(): Promise<Repo[]> {
    return (await request("GET", "/repos")).repos as Repo[];
  },

  async createRepo(name: string): Promise<{ repo: Repo; mainBranchId: number }> {
    const payload = await request("POST", "/repos", { name });
    return payload as unknown as { repo: Repo; mainBranchId: number };
  },

  async getRepo(repoId: number): Promise<{ repo: Repo; branches: Branch[] }> {
    const payload = await request("GET", `/repos/${repoId}`);
    return payload as unknown as { repo: Repo; branches: Branch[] };
  },

  async addMember(repoId: number, username: string): Promise<Repo> {
    const payload = await request("POST", `/repos/${repoId}/members`, { username });
    return payload.repo as Repo;
  },

  async createBranch(
    repoId: number,
    name: string,
    fromBranchId: number,
  ): Promise<Branch> {
    const payload = await request("POST", `/repos/${repoId}/branches`, {
      name,
      fromBranchId,
    });
    return payload.branch as Branch;
  },

  async getBranch(branchId: number): Promise<WorkingState> {
    return (await request("GET", `/branches/${branchId}`)) as unknown as WorkingState;
  },

  async saveWorking(
    branchId: number,
    snapshot: Schema,
    expectedRev: number,
  ): Promise<SaveOutcome> {
    const result = await requestAllowingConflict(
      "PUT",
      `/branches/${branchId}/working`,
      { snapshot, expectedRev },
    );
    if (result.conflict) return { ok: false, conflict: result.conflict };
    return {
      ok: true,
      rev: result.payload.rev as number,
      savedAt: result.payload.savedAt as string,
    };
  },

  async commit(
    branchId: number,
    message: string,
    snapshot: Schema,
    expectedRev: number,
    merge?: MergeMarker,
  ): Promise<CommitOutcome> {
    const result = await requestAllowingConflict(
      "POST",
      `/branches/${branchId}/commits`,
      { message, snapshot, expectedRev, ...(merge ? { merge } : {}) },
    );
    if (result.conflict) return { ok: false, conflict: result.conflict };
    return {
      ok: true,
      commit: result.payload.commit as CommitMeta,
      rev: result.payload.rev as number,
      savedAt: result.payload.savedAt as string,
    };
  },

  async listCommits(branchId: number): Promise<CommitMeta[]> {
    return (await request("GET", `/branches/${branchId}/commits`)).commits as CommitMeta[];
  },

  async getCommit(
    commitId: number,
  ): Promise<{ commit: CommitMeta; snapshot: Schema }> {
    const payload = await request("GET", `/commits/${commitId}`);
    return payload as unknown as { commit: CommitMeta; snapshot: Schema };
  },

  async getMergeContext(branchId: number): Promise<MergeContext> {
    const payload = await request("GET", `/branches/${branchId}/merge-context`);
    return payload as unknown as MergeContext;
  },
};
