// Storage layer: every read and write of users, repos, branches and
// commits lives here, and every repo-scoped function takes the acting
// username and enforces membership inside its own query — a caller
// cannot forget the check because there is no unscoped variant
// (decisions.md #13). Returning null means "not found OR not yours";
// the API turns both into the same 404 so repo ids can't be probed.
//
// Snapshots are opaque JSONB here (decisions.md #12) — validation
// happens at the API boundary with the engine's validateSchema.

import type pg from "pg";
import { diffSchemas, type Schema } from "engine";

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

/**
 * A stale save (decisions.md #15): someone saved a newer working
 * state after `expectedRev` was loaded. Carries what the overwrite
 * dialog needs — who, when, and the rev to resend if the user
 * consciously overwrites.
 */
export interface SaveConflict {
  rev: number;
  savedBy: string | null;
  savedAt: string | null;
}

export type SaveResult =
  | { ok: true; rev: number; savedAt: string }
  | { ok: false; conflict: SaveConflict };

export type CommitResult =
  | { ok: true; commit: CommitMeta; rev: number; savedAt: string }
  | { ok: false; conflict: SaveConflict }
  /** The commit carried a merge marker that doesn't check out — see
   *  commitWorking. Nothing was written. */
  | { ok: false; invalidMerge: true }
  /** The snapshot records the same schema as the branch's last commit
   *  (or, on a first commit, no schema at all), so the commit would
   *  land in history with nothing to show. Nothing was written.
   *  `hadTip` separates the two cases for the message. */
  | { ok: false; empty: true; hadTip: boolean };

/**
 * Bookkeeping a merge commit carries (decisions.md #20): which branch
 * was merged in, and which of its commits was the merged tip. At
 * commit time the source branch's stored base advances to that
 * commit's snapshot, in the same transaction as the commit itself.
 */
export interface MergeMarker {
  sourceBranchId: number;
  mergedCommitId: number;
}

/** True for Postgres unique-constraint violations (duplicate names). */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  );
}

// --- users ------------------------------------------------------------

/** Claim a username: creates it on first sight, no-op after. */
export async function ensureUser(pool: pg.Pool, username: string): Promise<void> {
  await pool.query(
    "INSERT INTO users (username) VALUES ($1) ON CONFLICT (username) DO NOTHING",
    [username],
  );
}

export async function userExists(pool: pg.Pool, username: string): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM users WHERE username = $1", [
    username,
  ]);
  return result.rowCount === 1;
}

// --- repos ------------------------------------------------------------

function rowToRepo(row: {
  id: number;
  name: string;
  owner: string;
  members: string[];
  created_at: Date;
}): Repo {
  return {
    id: row.id,
    name: row.name,
    owner: row.owner,
    members: row.members,
    createdAt: row.created_at.toISOString(),
  };
}

/** SQL fragment: the acting user ($n) owns or is a member of repo r. */
const IS_MEMBER = (param: string) =>
  `(r.owner = ${param} OR ${param} = ANY(r.members))`;

/**
 * Creates a repo and its root branch "main" (empty schema, no
 * commits) in one transaction — a repo without a branch would be an
 * unreachable state for the client.
 */
export async function createRepo(
  pool: pg.Pool,
  owner: string,
  name: string,
): Promise<{ repo: Repo; mainBranchId: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const repoResult = await client.query(
      "INSERT INTO repos (name, owner) VALUES ($1, $2) RETURNING *",
      [name, owner],
    );
    const repo = rowToRepo(repoResult.rows[0]);
    const emptySchema: Schema = { tables: [] };
    const branchResult = await client.query(
      `INSERT INTO branches (repo_id, name, base_snapshot, working_snapshot)
       VALUES ($1, 'main', $2, $2) RETURNING id`,
      [repo.id, JSON.stringify(emptySchema)],
    );
    await client.query("COMMIT");
    return { repo, mainBranchId: branchResult.rows[0].id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listRepos(pool: pg.Pool, username: string): Promise<Repo[]> {
  const result = await pool.query(
    `SELECT * FROM repos r WHERE ${IS_MEMBER("$1")} ORDER BY created_at DESC`,
    [username],
  );
  return result.rows.map(rowToRepo);
}

export async function getRepo(
  pool: pg.Pool,
  repoId: number,
  username: string,
): Promise<Repo | null> {
  const result = await pool.query(
    `SELECT * FROM repos r WHERE r.id = $1 AND ${IS_MEMBER("$2")}`,
    [repoId, username],
  );
  return result.rows[0] ? rowToRepo(result.rows[0]) : null;
}

export type AddMemberResult =
  | { ok: true; repo: Repo }
  | { ok: false; reason: "no-such-user" | "already-member" };

/**
 * Any member can add another member (kept deliberately open — the
 * demo has no roles). The target must have claimed their username
 * first, so the member list never holds names that don't exist.
 */
export async function addMember(
  pool: pg.Pool,
  repoId: number,
  actingUser: string,
  newMember: string,
): Promise<AddMemberResult | null> {
  const repo = await getRepo(pool, repoId, actingUser);
  if (!repo) return null;
  if (!(await userExists(pool, newMember))) {
    return { ok: false, reason: "no-such-user" };
  }
  const result = await pool.query(
    `UPDATE repos r SET members = array_append(members, $2)
     WHERE r.id = $1 AND r.owner <> $2 AND NOT $2 = ANY(r.members)
     RETURNING *`,
    [repoId, newMember],
  );
  if (result.rowCount === 0) return { ok: false, reason: "already-member" };
  return { ok: true, repo: rowToRepo(result.rows[0]) };
}

// --- branches -----------------------------------------------------------

function rowToBranch(row: {
  id: number;
  repo_id: number;
  name: string;
  parent_branch_id: number | null;
  commit_count: string | number;
  created_at: Date;
}): Branch {
  return {
    id: row.id,
    repoId: row.repo_id,
    name: row.name,
    parentBranchId: row.parent_branch_id,
    commitCount: Number(row.commit_count),
    createdAt: row.created_at.toISOString(),
  };
}

const BRANCH_SELECT = `
  SELECT b.id, b.repo_id, b.name, b.parent_branch_id, b.created_at,
         (SELECT count(*) FROM commits c WHERE c.branch_id = b.id) AS commit_count
  FROM branches b JOIN repos r ON r.id = b.repo_id`;

export async function listBranches(
  pool: pg.Pool,
  repoId: number,
  username: string,
): Promise<Branch[] | null> {
  const repo = await getRepo(pool, repoId, username);
  if (!repo) return null;
  const result = await pool.query(
    `${BRANCH_SELECT} WHERE b.repo_id = $1 ORDER BY b.id`,
    [repoId],
  );
  return result.rows.map(rowToBranch);
}

export type CreateBranchResult =
  | { ok: true; branch: Branch }
  | { ok: false; reason: "no-commits" };

/**
 * Branch creation follows git (decisions.md #16). The source must
 * have at least one commit; the new branch splits at the source's
 * latest commit — that snapshot is the stored merge base
 * (decisions.md #7) and a copy of that commit (original message,
 * author, timestamp) becomes the branch's first history entry, so a
 * branch always shows where it split. The source's saved working
 * state carries over as the new branch's working copy, like git
 * carrying your dirty working tree through `git switch -c` — pending
 * work moves to the new branch, ready to commit there.
 */
export async function createBranch(
  pool: pg.Pool,
  repoId: number,
  username: string,
  name: string,
  fromBranchId: number,
): Promise<CreateBranchResult | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const source = await client.query(
      `SELECT b.working_snapshot, b.working_saved_by, b.working_saved_at
       FROM branches b JOIN repos r ON r.id = b.repo_id
       WHERE b.id = $1 AND b.repo_id = $2 AND ${IS_MEMBER("$3")}`,
      [fromBranchId, repoId, username],
    );
    if (source.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const head = await client.query(
      `SELECT message, snapshot, author, created_at FROM commits
       WHERE branch_id = $1 ORDER BY id DESC LIMIT 1`,
      [fromBranchId],
    );
    if (head.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "no-commits" };
    }
    const split = head.rows[0];
    const working = source.rows[0];
    const inserted = await client.query(
      `INSERT INTO branches (repo_id, name, parent_branch_id, base_snapshot,
         working_snapshot, working_saved_by, working_saved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, repo_id, name, parent_branch_id, created_at, 1 AS commit_count`,
      [
        repoId,
        name,
        fromBranchId,
        JSON.stringify(split.snapshot),
        JSON.stringify(working.working_snapshot),
        working.working_saved_by,
        working.working_saved_at,
      ],
    );
    const branch = rowToBranch(inserted.rows[0]);
    await client.query(
      `INSERT INTO commits (branch_id, message, snapshot, author, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [branch.id, split.message, JSON.stringify(split.snapshot), split.author, split.created_at],
    );
    await client.query("COMMIT");
    return { ok: true, branch };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getWorkingState(
  pool: pg.Pool,
  branchId: number,
  username: string,
): Promise<WorkingState | null> {
  const result = await pool.query(
    `SELECT b.id, b.repo_id, b.name, b.parent_branch_id, b.created_at,
            b.working_snapshot, b.working_rev, b.working_saved_by, b.working_saved_at,
            (SELECT count(*) FROM commits c WHERE c.branch_id = b.id) AS commit_count
     FROM branches b JOIN repos r ON r.id = b.repo_id
     WHERE b.id = $1 AND ${IS_MEMBER("$2")}`,
    [branchId, username],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    branch: rowToBranch(row),
    snapshot: row.working_snapshot,
    rev: row.working_rev,
    savedBy: row.working_saved_by,
    savedAt: row.working_saved_at ? row.working_saved_at.toISOString() : null,
  };
}

/**
 * The staleness check of decisions.md #15 in one statement: the write
 * only lands when working_rev still equals what the client loaded.
 * Zero rows updated + branch still visible = someone saved in
 * between; the caller gets who/when and the fresh rev, and a
 * conscious overwrite is just a resend with that rev.
 */
async function saveWorkingOnClient(
  client: pg.Pool | pg.PoolClient,
  branchId: number,
  username: string,
  snapshot: Schema,
  expectedRev: number,
): Promise<SaveResult | null> {
  const result = await client.query(
    `UPDATE branches b
     SET working_snapshot = $3, working_rev = b.working_rev + 1,
         working_saved_by = $2, working_saved_at = now()
     FROM repos r
     WHERE b.id = $1 AND r.id = b.repo_id AND ${IS_MEMBER("$2")}
       AND b.working_rev = $4
     RETURNING b.working_rev, b.working_saved_at`,
    [branchId, username, JSON.stringify(snapshot), expectedRev],
  );
  const row = result.rows[0];
  if (row) {
    return {
      ok: true,
      rev: row.working_rev,
      savedAt: row.working_saved_at.toISOString(),
    };
  }
  const current = await client.query(
    `SELECT b.working_rev, b.working_saved_by, b.working_saved_at
     FROM branches b JOIN repos r ON r.id = b.repo_id
     WHERE b.id = $1 AND ${IS_MEMBER("$2")}`,
    [branchId, username],
  );
  const branch = current.rows[0];
  if (!branch) return null;
  return {
    ok: false,
    conflict: {
      rev: branch.working_rev,
      savedBy: branch.working_saved_by,
      savedAt: branch.working_saved_at
        ? branch.working_saved_at.toISOString()
        : null,
    },
  };
}

export async function saveWorking(
  pool: pg.Pool,
  branchId: number,
  username: string,
  snapshot: Schema,
  expectedRev: number,
): Promise<SaveResult | null> {
  return saveWorkingOnClient(pool, branchId, username, snapshot, expectedRev);
}

// --- commits ------------------------------------------------------------

function rowToCommit(row: {
  id: number;
  branch_id: number;
  message: string;
  author: string;
  created_at: Date;
}): CommitMeta {
  return {
    id: row.id,
    branchId: row.branch_id,
    message: row.message,
    author: row.author,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Commit = save + stamp in one transaction (decisions.md #7, #15):
 * the working state is saved (staleness-checked like any save) and
 * the same snapshot becomes a commit row. One round trip, no gap
 * where a concurrent save could slip between them.
 *
 * A merge commit (decisions.md #20) additionally advances the merged
 * branch's stored base to the merged tip's snapshot — same
 * transaction, so history never says "merged" without the base
 * moving. The marker must check out — the source branch must be a
 * direct child of this branch and the merged commit must be on it —
 * or the whole commit is refused and nothing is written. The merged
 * commit need not still be the source's newest one: if the source
 * gained commits since the merge was computed, what was merged is
 * still exactly that older tip, and the base must say so.
 *
 * A commit that changes nothing is refused (decisions.md #28): the
 * incoming snapshot is diffed against the branch's last commit first,
 * and an empty diff means nothing is written at all — not even the
 * working save. Merge commits are the one exception: their job is the
 * bookkeeping above, which still has to happen when the merged result
 * matches what the branch already had.
 */
export async function commitWorking(
  pool: pg.Pool,
  branchId: number,
  username: string,
  message: string,
  snapshot: Schema,
  expectedRev: number,
  merge?: MergeMarker,
): Promise<CommitResult | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!merge) {
      // Compared with the engine's diff, not raw JSON equality, so the
      // rule is exactly the one the diff view shows: if that view
      // would say "no schema changes", this is not a commit. Missing
      // tip = first commit, which is measured against nothing.
      const tip = await client.query(
        `SELECT c.snapshot FROM commits c
         JOIN branches b ON b.id = c.branch_id
         JOIN repos r ON r.id = b.repo_id
         WHERE c.branch_id = $1 AND ${IS_MEMBER("$2")}
         ORDER BY c.id DESC LIMIT 1`,
        [branchId, username],
      );
      const previous: Schema = tip.rows[0]?.snapshot ?? { tables: [] };
      if (diffSchemas(previous, snapshot).changes.length === 0) {
        await client.query("ROLLBACK");
        return { ok: false, empty: true, hadTip: tip.rowCount === 1 };
      }
    }
    const saved = await saveWorkingOnClient(
      client,
      branchId,
      username,
      snapshot,
      expectedRev,
    );
    if (!saved || !saved.ok) {
      await client.query("ROLLBACK");
      return saved;
    }
    const result = await client.query(
      `INSERT INTO commits (branch_id, message, snapshot, author)
       VALUES ($1, $2, $3, $4) RETURNING id, branch_id, message, author, created_at`,
      [branchId, message, JSON.stringify(snapshot), username],
    );
    if (merge) {
      const advanced = await client.query(
        `UPDATE branches b
         SET base_snapshot = c.snapshot
         FROM commits c
         WHERE b.id = $2 AND b.parent_branch_id = $1
           AND c.id = $3 AND c.branch_id = b.id`,
        [branchId, merge.sourceBranchId, merge.mergedCommitId],
      );
      if (advanced.rowCount === 0) {
        await client.query("ROLLBACK");
        return { ok: false, invalidMerge: true };
      }
    }
    await client.query("COMMIT");
    return {
      ok: true,
      commit: rowToCommit(result.rows[0]),
      rev: saved.rev,
      savedAt: saved.savedAt,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** One commit with its stored snapshot — the diff view's raw material. */
export interface CommitDetail {
  commit: CommitMeta;
  snapshot: Schema;
}

export async function getCommit(
  pool: pg.Pool,
  commitId: number,
  username: string,
): Promise<CommitDetail | null> {
  const result = await pool.query(
    `SELECT c.id, c.branch_id, c.message, c.author, c.created_at, c.snapshot
     FROM commits c
     JOIN branches b ON b.id = c.branch_id
     JOIN repos r ON r.id = b.repo_id
     WHERE c.id = $1 AND ${IS_MEMBER("$2")}`,
    [commitId, username],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { commit: rowToCommit(row), snapshot: row.snapshot };
}

export async function listCommits(
  pool: pg.Pool,
  branchId: number,
  username: string,
): Promise<CommitMeta[] | null> {
  const visible = await pool.query(
    `SELECT 1 FROM branches b JOIN repos r ON r.id = b.repo_id
     WHERE b.id = $1 AND ${IS_MEMBER("$2")}`,
    [branchId, username],
  );
  if (visible.rowCount === 0) return null;
  const result = await pool.query(
    `SELECT id, branch_id, message, author, created_at
     FROM commits WHERE branch_id = $1 ORDER BY id DESC`,
    [branchId],
  );
  return result.rows.map(rowToCommit);
}

// --- merge ------------------------------------------------------------

/** One branch's side of a merge: the branch, its latest commit, and
 *  its saved working state (rev included, so the client can land the
 *  merge with the ordinary staleness-checked save). */
export interface MergeSideState {
  branch: Branch;
  tip: CommitDetail;
  working: {
    snapshot: Schema;
    rev: number;
    savedBy: string | null;
    savedAt: string | null;
  };
}

/**
 * Everything a merge needs, read in one request: the stored base
 * (decisions.md #7) plus both sides' tips and working states. The
 * merge itself runs in the client (same reasoning as the diff,
 * decisions.md #19 — rename answers and conflict picks are
 * interactive); the server just hands over the three snapshots and
 * the facts needed to check the git-strict preconditions (#20).
 */
export interface MergeContext {
  source: MergeSideState;
  parent: MergeSideState;
  base: Schema;
}

export type MergeContextResult =
  | { ok: true; context: MergeContext }
  | { ok: false; reason: "no-parent" };

const MERGE_BRANCH_SELECT = `
  SELECT b.id, b.repo_id, b.name, b.parent_branch_id, b.created_at,
         b.base_snapshot, b.working_snapshot, b.working_rev,
         b.working_saved_by, b.working_saved_at,
         (SELECT count(*) FROM commits c WHERE c.branch_id = b.id) AS commit_count
  FROM branches b`;

interface MergeBranchRow {
  id: number;
  repo_id: number;
  name: string;
  parent_branch_id: number | null;
  commit_count: string | number;
  created_at: Date;
  base_snapshot: Schema;
  working_snapshot: Schema;
  working_rev: number;
  working_saved_by: string | null;
  working_saved_at: Date | null;
}

async function mergeSideFor(
  pool: pg.Pool,
  row: MergeBranchRow,
): Promise<MergeSideState> {
  const tip = await pool.query(
    `SELECT id, branch_id, message, author, created_at, snapshot
     FROM commits WHERE branch_id = $1 ORDER BY id DESC LIMIT 1`,
    [row.id],
  );
  const head = tip.rows[0];
  if (!head) {
    // A branch with a parent is born with the copied split-point
    // commit and commits are never deleted, so this can't happen
    // without the data being broken — fail loudly over guessing.
    throw new Error(`branch ${row.id} has no commits — merge context is impossible`);
  }
  return {
    branch: rowToBranch(row),
    tip: { commit: rowToCommit(head), snapshot: head.snapshot },
    working: {
      snapshot: row.working_snapshot,
      rev: row.working_rev,
      savedBy: row.working_saved_by,
      savedAt: row.working_saved_at ? row.working_saved_at.toISOString() : null,
    },
  };
}

export async function getMergeContext(
  pool: pg.Pool,
  branchId: number,
  username: string,
): Promise<MergeContextResult | null> {
  const sourceResult = await pool.query(
    `${MERGE_BRANCH_SELECT} JOIN repos r ON r.id = b.repo_id
     WHERE b.id = $1 AND ${IS_MEMBER("$2")}`,
    [branchId, username],
  );
  const sourceRow = sourceResult.rows[0] as MergeBranchRow | undefined;
  if (!sourceRow) return null;
  if (sourceRow.parent_branch_id === null) {
    return { ok: false, reason: "no-parent" };
  }
  // Membership is proven above and parent/child always share a repo,
  // so the parent read needs no second membership check.
  const parentResult = await pool.query(
    `${MERGE_BRANCH_SELECT} WHERE b.id = $1`,
    [sourceRow.parent_branch_id],
  );
  const parentRow = parentResult.rows[0] as MergeBranchRow | undefined;
  if (!parentRow) {
    throw new Error(`branch ${branchId} points at a missing parent — data invariant broken`);
  }
  const [source, parent] = await Promise.all([
    mergeSideFor(pool, sourceRow),
    mergeSideFor(pool, parentRow),
  ]);
  return {
    ok: true,
    context: { source, parent, base: sourceRow.base_snapshot },
  };
}
