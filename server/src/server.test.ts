// Storage + API tests against a real Postgres (decisions.md #12):
// the code that ships is the code under test, no in-memory stand-in.
// Everything lives in this one file on purpose — test files run in
// parallel and share the one test database, so a second file would
// race the schema wipe.
//
// Needs a local test database:
//   brew install postgresql@17 && brew services start postgresql@17
//   /opt/homebrew/opt/postgresql@17/bin/createdb schema_vcs_test
// Override the connection string with TEST_DATABASE_URL if yours
// lives elsewhere.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { EXAMPLE_SCHEMA, mergeSchemas, type Schema } from "engine";
import { createApp } from "./app.ts";
import { migrate } from "./migrate.ts";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/schema_vcs_test";

let pool: pg.Pool;
let baseUrl: string;
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await pool.query("SELECT 1");
  } catch (cause) {
    throw new Error(
      `Test database unreachable at ${TEST_DATABASE_URL} — see the setup ` +
        "comment at the top of server.test.ts",
      { cause },
    );
  }
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(pool);

  const app = createApp(pool);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server has no port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await pool?.end();
});

/** Tiny API client: returns { status, body } and never throws. */
async function call(
  method: string,
  path: string,
  options: { user?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(options.user ? { "x-username": options.user } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, body: await response.json() };
}

const A_TABLE: Schema = {
  tables: [
    {
      name: "notes",
      columns: [{ name: "id", type: "unique-id", nullable: false }],
      primaryKey: ["id"],
    },
  ],
};

describe("identity", () => {
  it("claims a username, idempotently", async () => {
    expect((await call("POST", "/users", { body: { username: "Ada " } })).status).toBe(201);
    const again = await call("POST", "/users", { body: { username: "ada" } });
    expect(again.status).toBe(201);
    expect(again.body).toEqual({ username: "ada" });
  });

  it("rejects usernames that break the rules", async () => {
    for (const username of ["", "has space", "ünïcode", "x".repeat(33)]) {
      const result = await call("POST", "/users", { body: { username } });
      expect(result.status).toBe(400);
    }
  });

  it("rejects requests without a known user", async () => {
    expect((await call("GET", "/repos")).status).toBe(401);
    expect((await call("GET", "/repos", { user: "nobody" })).status).toBe(401);
  });
});

describe("repos and membership", () => {
  beforeAll(async () => {
    for (const username of ["bob", "carol", "mallory"]) {
      await call("POST", "/users", { body: { username } });
    }
  });

  it("creates a repo with a main branch and lists it for the owner only", async () => {
    const created = await call("POST", "/repos", { user: "ada", body: { name: "shop" } });
    expect(created.status).toBe(201);
    const repo = created.body.repo as { id: number; owner: string };
    expect(repo.owner).toBe("ada");

    const detail = await call("GET", `/repos/${repo.id}`, { user: "ada" });
    expect(detail.status).toBe(200);
    const branches = detail.body.branches as Array<Record<string, unknown>>;
    expect(branches).toHaveLength(1);
    expect(branches[0]).toMatchObject({
      name: "main",
      parentBranchId: null,
      commitCount: 0,
    });

    const strangers = await call("GET", "/repos", { user: "bob" });
    expect(strangers.body.repos).toEqual([]);
    expect((await call("GET", `/repos/${repo.id}`, { user: "bob" })).status).toBe(404);
  });

  it("repo names are unique per owner, not globally", async () => {
    expect(
      (await call("POST", "/repos", { user: "ada", body: { name: "shop" } })).status,
    ).toBe(409);
    expect(
      (await call("POST", "/repos", { user: "bob", body: { name: "shop" } })).status,
    ).toBe(201);
  });

  it("members gain access when added; unknown users can't be added", async () => {
    const { body } = await call("POST", "/repos", { user: "ada", body: { name: "blog" } });
    const repoId = (body.repo as { id: number }).id;

    const missing = await call("POST", `/repos/${repoId}/members`, {
      user: "ada",
      body: { username: "nobody-yet" },
    });
    expect(missing.status).toBe(409);
    expect(missing.body.error).toContain("claim");

    const added = await call("POST", `/repos/${repoId}/members`, {
      user: "ada",
      body: { username: "carol" },
    });
    expect(added.status).toBe(200);
    expect((added.body.repo as { members: string[] }).members).toEqual(["carol"]);

    // Carol (a member, not the owner) can now see it and add others.
    expect((await call("GET", `/repos/${repoId}`, { user: "carol" })).status).toBe(200);
    const byCarol = await call("POST", `/repos/${repoId}/members`, {
      user: "carol",
      body: { username: "bob" },
    });
    expect(byCarol.status).toBe(200);

    // Re-adding (or adding the owner) reports it plainly.
    expect(
      (
        await call("POST", `/repos/${repoId}/members`, {
          user: "ada",
          body: { username: "carol" },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("POST", `/repos/${repoId}/members`, {
          user: "carol",
          body: { username: "ada" },
        })
      ).status,
    ).toBe(409);

    // Mallory, never added, sees nothing.
    expect((await call("GET", `/repos/${repoId}`, { user: "mallory" })).status).toBe(404);
  });
});

describe("working state, branching, commits", () => {
  let repoId: number;
  let mainId: number;

  beforeAll(async () => {
    await call("POST", "/users", { body: { username: "dev" } });
    await call("POST", "/users", { body: { username: "peer" } });
    const { body } = await call("POST", "/repos", { user: "dev", body: { name: "core" } });
    repoId = (body.repo as { id: number }).id;
    mainId = body.mainBranchId as number;
    await call("POST", `/repos/${repoId}/members`, { user: "dev", body: { username: "peer" } });
  });

  it("starts empty at rev 0 and round-trips a saved snapshot", async () => {
    const initial = await call("GET", `/branches/${mainId}`, { user: "dev" });
    expect(initial.body).toMatchObject({ rev: 0, savedBy: null });
    expect(initial.body.snapshot).toEqual({ tables: [] });

    const saved = await call("PUT", `/branches/${mainId}/working`, {
      user: "dev",
      body: { snapshot: EXAMPLE_SCHEMA, expectedRev: 0 },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.rev).toBe(1);

    const reloaded = await call("GET", `/branches/${mainId}`, { user: "dev" });
    expect(reloaded.body.snapshot).toEqual(EXAMPLE_SCHEMA);
    expect(reloaded.body.savedBy).toBe("dev");
  });

  it("rejects invalid snapshots and malformed revs at the boundary", async () => {
    const invalid = await call("PUT", `/branches/${mainId}/working`, {
      user: "dev",
      body: { snapshot: { tables: [{ name: "t" }] }, expectedRev: 1 },
    });
    expect(invalid.status).toBe(400);
    expect(Array.isArray(invalid.body.details)).toBe(true);

    const noRev = await call("PUT", `/branches/${mainId}/working`, {
      user: "dev",
      body: { snapshot: EXAMPLE_SCHEMA },
    });
    expect(noRev.status).toBe(400);
  });

  it("a stale save conflicts with who/when, and resending the fresh rev overwrites", async () => {
    // peer saves on top of rev 1; dev still holds rev 1.
    const peerSave = await call("PUT", `/branches/${mainId}/working`, {
      user: "peer",
      body: { snapshot: A_TABLE, expectedRev: 1 },
    });
    expect(peerSave.status).toBe(200);

    const stale = await call("PUT", `/branches/${mainId}/working`, {
      user: "dev",
      body: { snapshot: EXAMPLE_SCHEMA, expectedRev: 1 },
    });
    expect(stale.status).toBe(409);
    const conflict = stale.body.conflict as { rev: number; savedBy: string };
    expect(conflict.savedBy).toBe("peer");
    expect(conflict.rev).toBe(2);

    // The conscious overwrite: same snapshot, the rev the conflict named.
    const overwrite = await call("PUT", `/branches/${mainId}/working`, {
      user: "dev",
      body: { snapshot: EXAMPLE_SCHEMA, expectedRev: conflict.rev },
    });
    expect(overwrite.status).toBe(200);
    expect(overwrite.body.rev).toBe(3);
  });

  it("commit saves and stamps atomically; history lists newest first", async () => {
    const first = await call("POST", `/branches/${mainId}/commits`, {
      user: "dev",
      body: { message: "first commit", snapshot: EXAMPLE_SCHEMA, expectedRev: 3 },
    });
    expect(first.status).toBe(201);
    expect(first.body.rev).toBe(4);

    const stale = await call("POST", `/branches/${mainId}/commits`, {
      user: "peer",
      body: { message: "stale commit", snapshot: A_TABLE, expectedRev: 3 },
    });
    expect(stale.status).toBe(409);

    const second = await call("POST", `/branches/${mainId}/commits`, {
      user: "peer",
      body: { message: "second commit", snapshot: A_TABLE, expectedRev: 4 },
    });
    expect(second.status).toBe(201);

    const history = await call("GET", `/branches/${mainId}/commits`, { user: "dev" });
    const commits = history.body.commits as Array<{ message: string; author: string }>;
    expect(commits.map((c) => [c.message, c.author])).toEqual([
      ["second commit", "peer"],
      ["first commit", "dev"],
    ]);
    // The stale commit stamped nothing.
    expect(commits).toHaveLength(2);
  });

  it("a branch splits at the source's last commit and carries its working changes (decisions.md #16)", async () => {
    // Diverge main's desk from its drawer: save EXAMPLE_SCHEMA on top
    // of the last commit (whose snapshot is A_TABLE) without committing.
    const diverge = await call("PUT", `/branches/${mainId}/working`, {
      user: "dev",
      body: { snapshot: EXAMPLE_SCHEMA, expectedRev: 5 },
    });
    expect(diverge.status).toBe(200);

    const created = await call("POST", `/repos/${repoId}/branches`, {
      user: "peer",
      body: { name: "feature", fromBranchId: mainId },
    });
    expect(created.status).toBe(201);
    const branch = created.body.branch as {
      id: number;
      parentBranchId: number;
      commitCount: number;
    };
    expect(branch.parentBranchId).toBe(mainId);
    // History starts with a copy of the split-point commit…
    expect(branch.commitCount).toBe(1);
    const history = await call("GET", `/branches/${branch.id}/commits`, { user: "dev" });
    const inherited = (history.body.commits as Array<Record<string, unknown>>)[0];
    expect(inherited).toMatchObject({ message: "second commit", author: "peer" });

    // …the merge base is that commit's snapshot (decisions.md #7)…
    const base = await pool.query(
      "SELECT base_snapshot FROM branches WHERE id = $1",
      [branch.id],
    );
    expect(base.rows[0].base_snapshot).toEqual(A_TABLE);

    // …and the saved-but-uncommitted changes carried over, like git
    // carrying a dirty working tree into `git switch -c`.
    const state = await call("GET", `/branches/${branch.id}`, { user: "dev" });
    expect(state.body.snapshot).toEqual(EXAMPLE_SCHEMA);
    expect(state.body.rev).toBe(0);
    expect(state.body.savedBy).toBe("dev");

    // Committing the carried work makes it 2 commits total.
    const carry = await call("POST", `/branches/${branch.id}/commits`, {
      user: "peer",
      body: { message: "carry work", snapshot: EXAMPLE_SCHEMA, expectedRev: 0 },
    });
    expect(carry.status).toBe(201);
    const after = await call("GET", `/branches/${branch.id}/commits`, { user: "dev" });
    expect(
      (after.body.commits as Array<{ message: string }>).map((c) => c.message),
    ).toEqual(["carry work", "second commit"]);

    // Main is untouched: same desk, same 2 commits.
    const main = await call("GET", `/branches/${mainId}`, { user: "dev" });
    expect(main.body.snapshot).toEqual(EXAMPLE_SCHEMA);
    const mainHistory = await call("GET", `/branches/${mainId}/commits`, { user: "dev" });
    expect(mainHistory.body.commits).toHaveLength(2);
  });

  it("branching needs a commit to split at — git's rule", async () => {
    const fresh = await call("POST", "/repos", { user: "dev", body: { name: "empty-src" } });
    const freshRepoId = (fresh.body.repo as { id: number }).id;
    const freshMainId = fresh.body.mainBranchId as number;
    const denied = await call("POST", `/repos/${freshRepoId}/branches`, {
      user: "dev",
      body: { name: "too-early", fromBranchId: freshMainId },
    });
    expect(denied.status).toBe(409);
    expect(String(denied.body.error)).toContain("no commits yet");
  });

  it("branch names are unique per repo; sources must belong to the repo", async () => {
    expect(
      (
        await call("POST", `/repos/${repoId}/branches`, {
          user: "dev",
          body: { name: "feature", fromBranchId: mainId },
        })
      ).status,
    ).toBe(409);

    // A branch id from someone else's repo is not a valid source.
    const other = await call("POST", "/repos", { user: "ada", body: { name: "other" } });
    const foreignBranch = (other.body as { mainBranchId: number }).mainBranchId;
    expect(
      (
        await call("POST", `/repos/${repoId}/branches`, {
          user: "dev",
          body: { name: "stolen", fromBranchId: foreignBranch },
        })
      ).status,
    ).toBe(404);
  });

  it("bad input degrades to 4xx, never a Postgres 500", async () => {
    // ids/revs past int4 range
    expect((await call("GET", "/repos/3000000000", { user: "dev" })).status).toBe(404);
    expect((await call("GET", "/branches/1e21", { user: "dev" })).status).toBe(404);
    expect(
      (
        await call("POST", `/repos/${repoId}/branches`, {
          user: "dev",
          body: { name: "b2", fromBranchId: 3000000000 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("PUT", `/branches/${mainId}/working`, {
          user: "dev",
          body: { snapshot: { tables: [] }, expectedRev: 9007199254740991 },
        })
      ).status,
    ).toBe(400);

    // strings Postgres can't store (NUL byte)
    expect(
      (await call("POST", "/repos", { user: "dev", body: { name: "a\u0000b" } })).status,
    ).toBe(400);
    const badSnapshot = await call("PUT", `/branches/${mainId}/working`, {
      user: "dev",
      body: { snapshot: { tables: [{ name: "a\u0000b", columns: [] }] }, expectedRev: 0 },
    });
    expect(badSnapshot.status).toBe(400);
    expect(Array.isArray(badSnapshot.body.details)).toBe(true);

    // a body over the 1MB limit is a 413 with a plain message
    const oversized = await call("PUT", `/branches/${mainId}/working`, {
      user: "dev",
      body: {
        snapshot: { tables: [] },
        expectedRev: 0,
        padding: "x".repeat(1_200_000),
      },
    });
    expect(oversized.status).toBe(413);
    expect(String(oversized.body.error)).toContain("1MB");
  });

  it("non-members get the same 404 as a missing branch on every route", async () => {
    expect((await call("GET", `/branches/${mainId}`, { user: "mallory" })).status).toBe(404);
    expect(
      (
        await call("PUT", `/branches/${mainId}/working`, {
          user: "mallory",
          body: { snapshot: A_TABLE, expectedRev: 0 },
        })
      ).status,
    ).toBe(404);
    expect(
      (await call("GET", `/branches/${mainId}/commits`, { user: "mallory" })).status,
    ).toBe(404);
    expect((await call("GET", "/branches/999999", { user: "dev" })).status).toBe(404);
  });

  it("merge context and merge commits (decisions.md #20)", async () => {
    // Layout: main commits a base, "pricing" branches off, both sides
    // then diverge — the exact three-snapshot setup a merge needs.
    const mergeBase: Schema = {
      tables: [
        {
          name: "items",
          columns: [
            { name: "id", type: "unique-id", nullable: false },
            { name: "name", type: "text", nullable: false },
          ],
          primaryKey: ["id"],
        },
      ],
    };
    const featureTip: Schema = {
      tables: [
        {
          name: "items",
          columns: [
            { name: "id", type: "unique-id", nullable: false },
            { name: "name", type: "text", nullable: false },
            { name: "price", type: "whole-number", nullable: false },
          ],
          primaryKey: ["id"],
        },
      ],
    };
    const mainTip: Schema = {
      tables: [
        ...mergeBase.tables,
        {
          name: "tags",
          columns: [{ name: "id", type: "unique-id", nullable: false }],
          primaryKey: ["id"],
        },
      ],
    };
    const merged: Schema = { tables: [...featureTip.tables, mainTip.tables[1]!] };

    await call("POST", "/users", { body: { username: "meg" } });
    const created = await call("POST", "/repos", { user: "meg", body: { name: "mergeland" } });
    const mergeMainId = (created.body as { mainBranchId: number }).mainBranchId;
    const mergeRepoId = ((created.body as { repo: { id: number } }).repo).id;

    await call("POST", `/branches/${mergeMainId}/commits`, {
      user: "meg",
      body: { message: "base", snapshot: mergeBase, expectedRev: 0 },
    });
    const branch = await call("POST", `/repos/${mergeRepoId}/branches`, {
      user: "meg",
      body: { name: "pricing", fromBranchId: mergeMainId },
    });
    const pricingId = (branch.body.branch as { id: number }).id;
    const featureCommit = await call("POST", `/branches/${pricingId}/commits`, {
      user: "meg",
      body: { message: "add price", snapshot: featureTip, expectedRev: 0 },
    });
    const featureTipId = (featureCommit.body.commit as { id: number }).id;
    const mainCommit = await call("POST", `/branches/${mergeMainId}/commits`, {
      user: "meg",
      body: { message: "add tags", snapshot: mainTip, expectedRev: 1 },
    });
    const mainTipId = (mainCommit.body.commit as { id: number }).id;

    // Merge context: the stored base plus both sides' tips + workings.
    const context = await call("GET", `/branches/${pricingId}/merge-context`, { user: "meg" });
    expect(context.status).toBe(200);
    expect(context.body.base).toEqual(mergeBase);
    const source = context.body.source as {
      tip: { commit: { id: number; message: string }; snapshot: Schema };
      working: { rev: number };
    };
    const parent = context.body.parent as {
      branch: { id: number };
      tip: { commit: { message: string }; snapshot: Schema };
      working: { rev: number; snapshot: Schema };
    };
    expect(source.tip.commit).toMatchObject({ id: featureTipId, message: "add price" });
    expect(source.tip.snapshot).toEqual(featureTip);
    expect(parent.branch.id).toBe(mergeMainId);
    expect(parent.tip.snapshot).toEqual(mainTip);
    expect(parent.working.snapshot).toEqual(mainTip);
    const parentRev = parent.working.rev;

    // Root branches have nothing to merge into; outsiders see a 404.
    expect(
      (await call("GET", `/branches/${mergeMainId}/merge-context`, { user: "meg" })).status,
    ).toBe(409);
    expect(
      (await call("GET", `/branches/${pricingId}/merge-context`, { user: "mallory" })).status,
    ).toBe(404);
    expect((await call("GET", "/branches/999999/merge-context", { user: "meg" })).status).toBe(404);

    // Bad markers are refused whole — no commit, no base movement:
    // a merged commit that isn't on the source branch…
    const wrongCommit = await call("POST", `/branches/${mergeMainId}/commits`, {
      user: "meg",
      body: {
        message: "bogus merge",
        snapshot: merged,
        expectedRev: parentRev,
        merge: { sourceBranchId: pricingId, mergedCommitId: mainTipId },
      },
    });
    expect(wrongCommit.status).toBe(400);
    // …a "merge" whose source isn't a direct child of the target…
    const inverted = await call("POST", `/branches/${pricingId}/commits`, {
      user: "meg",
      body: {
        message: "backwards merge",
        snapshot: merged,
        expectedRev: 1,
        merge: { sourceBranchId: mergeMainId, mergedCommitId: mainTipId },
      },
    });
    expect(inverted.status).toBe(400);
    // …and a marker missing its fields.
    const malformed = await call("POST", `/branches/${mergeMainId}/commits`, {
      user: "meg",
      body: { message: "half a marker", snapshot: merged, expectedRev: parentRev, merge: {} },
    });
    expect(malformed.status).toBe(400);

    // A stale merge commit hits the same staleness check as any save.
    const stale = await call("POST", `/branches/${mergeMainId}/commits`, {
      user: "meg",
      body: {
        message: "stale merge",
        snapshot: merged,
        expectedRev: 0,
        merge: { sourceBranchId: pricingId, mergedCommitId: featureTipId },
      },
    });
    expect(stale.status).toBe(409);

    // Nothing above landed: history unchanged, base unchanged.
    const mainHistory = await call("GET", `/branches/${mergeMainId}/commits`, { user: "meg" });
    expect(mainHistory.body.commits).toHaveLength(2);
    const baseBefore = await pool.query(
      "SELECT base_snapshot FROM branches WHERE id = $1",
      [pricingId],
    );
    expect(baseBefore.rows[0].base_snapshot).toEqual(mergeBase);

    // The real merge commit: lands on main AND advances pricing's
    // stored base to the merged tip, atomically (decisions.md #20).
    const mergeCommit = await call("POST", `/branches/${mergeMainId}/commits`, {
      user: "meg",
      body: {
        message: "Merge branch 'pricing'",
        snapshot: merged,
        expectedRev: parentRev,
        merge: { sourceBranchId: pricingId, mergedCommitId: featureTipId },
      },
    });
    expect(mergeCommit.status).toBe(201);
    const afterHistory = await call("GET", `/branches/${mergeMainId}/commits`, { user: "meg" });
    expect(
      (afterHistory.body.commits as Array<{ message: string }>)[0]!.message,
    ).toBe("Merge branch 'pricing'");
    const contextAfter = await call("GET", `/branches/${pricingId}/merge-context`, { user: "meg" });
    expect(contextAfter.body.base).toEqual(featureTip);

    // The point of the base advance: merging again from here finds
    // nothing left to bring over and re-flags nothing.
    const after = contextAfter.body as {
      base: Schema;
      source: { tip: { snapshot: Schema } };
      parent: { tip: { snapshot: Schema } };
    };
    const rerun = mergeSchemas(after.base, after.parent.tip.snapshot, after.source.tip.snapshot);
    expect(rerun.conflicts).toEqual([]);
    expect(rerun.theirsChanges).toEqual([]);
  });

  it("a commit's snapshot is readable by members only (the diff view's raw material)", async () => {
    const history = await call("GET", `/branches/${mainId}/commits`, { user: "dev" });
    const commits = history.body.commits as Array<{ id: number; message: string }>;
    const oldest = commits[commits.length - 1]!;

    const detail = await call("GET", `/commits/${oldest.id}`, { user: "peer" });
    expect(detail.status).toBe(200);
    expect(detail.body.commit).toMatchObject({
      id: oldest.id,
      branchId: mainId,
      message: "first commit",
      author: "dev",
    });
    expect(detail.body.snapshot).toEqual(EXAMPLE_SCHEMA);

    // Non-members and missing/malformed ids all get the same 404.
    expect((await call("GET", `/commits/${oldest.id}`, { user: "mallory" })).status).toBe(404);
    expect((await call("GET", "/commits/999999", { user: "dev" })).status).toBe(404);
    expect((await call("GET", "/commits/3000000000", { user: "dev" })).status).toBe(404);
  });
});

// A commit that changes nothing would sit in history showing "no
// schema changes" when opened — so it isn't a commit (decisions.md
// #28). The rule is the engine's diff, not raw JSON equality, so it
// matches exactly what the diff view would show.
describe("empty commits (decisions.md #28)", () => {
  const TWO_TABLES: Schema = {
    tables: [
      {
        name: "notes",
        columns: [{ name: "id", type: "unique-id", nullable: false }],
        primaryKey: ["id"],
      },
      {
        name: "tags",
        columns: [{ name: "id", type: "unique-id", nullable: false }],
        primaryKey: ["id"],
      },
    ],
  };

  let mainId: number;
  let repoId: number;

  beforeAll(async () => {
    await call("POST", "/users", { body: { username: "nora" } });
    const created = await call("POST", "/repos", { user: "nora", body: { name: "steady" } });
    mainId = (created.body as { mainBranchId: number }).mainBranchId;
    repoId = (created.body as { repo: { id: number } }).repo.id;
  });

  it("refuses an empty first commit and writes nothing", async () => {
    const empty = await call("POST", `/branches/${mainId}/commits`, {
      user: "nora",
      body: { message: "nothing yet", snapshot: { tables: [] }, expectedRev: 0 },
    });
    expect(empty.status).toBe(400);
    expect(String(empty.body.error)).toContain("no schema here yet");

    const history = await call("GET", `/branches/${mainId}/commits`, { user: "nora" });
    expect(history.body.commits).toHaveLength(0);
    // The working save inside the commit was rolled back with it.
    const state = await call("GET", `/branches/${mainId}`, { user: "nora" });
    expect(state.body.rev).toBe(0);
  });

  it("refuses a recommit of the same schema, reorder included", async () => {
    const first = await call("POST", `/branches/${mainId}/commits`, {
      user: "nora",
      body: { message: "two tables", snapshot: TWO_TABLES, expectedRev: 0 },
    });
    expect(first.status).toBe(201);
    const revAfterCommit = first.body.rev as number;

    const same = await call("POST", `/branches/${mainId}/commits`, {
      user: "nora",
      body: { message: "again", snapshot: TWO_TABLES, expectedRev: revAfterCommit },
    });
    expect(same.status).toBe(400);
    expect(String(same.body.error)).toContain("matches the last commit");

    // Order isn't part of the schema the diff reports, so a reorder is
    // no more a change than an exact copy.
    const reordered: Schema = { tables: [TWO_TABLES.tables[1]!, TWO_TABLES.tables[0]!] };
    const shuffled = await call("POST", `/branches/${mainId}/commits`, {
      user: "nora",
      body: { message: "shuffled", snapshot: reordered, expectedRev: revAfterCommit },
    });
    expect(shuffled.status).toBe(400);

    // Neither refusal wrote anything — same history, same working rev.
    const history = await call("GET", `/branches/${mainId}/commits`, { user: "nora" });
    expect(history.body.commits).toHaveLength(1);
    const state = await call("GET", `/branches/${mainId}`, { user: "nora" });
    expect(state.body.rev).toBe(revAfterCommit);
    expect(state.body.snapshot).toEqual(TWO_TABLES);

    // A real change still commits.
    const real = await call("POST", `/branches/${mainId}/commits`, {
      user: "nora",
      body: { message: "drop tags", snapshot: A_TABLE, expectedRev: revAfterCommit },
    });
    expect(real.status).toBe(201);
  });

  it("still allows a merge commit that changes nothing", async () => {
    // "twin" adds a table and takes it straight back out, so its tip
    // records the same schema as main's. Merging it in changes no
    // schema — but the commit still has to land, because it's what
    // advances twin's stored base (decisions.md #20).
    const branch = await call("POST", `/repos/${repoId}/branches`, {
      user: "nora",
      body: { name: "twin", fromBranchId: mainId },
    });
    const twinId = (branch.body.branch as { id: number }).id;

    const added = await call("POST", `/branches/${twinId}/commits`, {
      user: "nora",
      body: { message: "add tags", snapshot: TWO_TABLES, expectedRev: 0 },
    });
    expect(added.status).toBe(201);
    const removed = await call("POST", `/branches/${twinId}/commits`, {
      user: "nora",
      body: { message: "take tags back out", snapshot: A_TABLE, expectedRev: added.body.rev },
    });
    expect(removed.status).toBe(201);
    const twinTipId = (removed.body.commit as { id: number }).id;

    const mainState = await call("GET", `/branches/${mainId}`, { user: "nora" });
    const mergeCommit = await call("POST", `/branches/${mainId}/commits`, {
      user: "nora",
      body: {
        message: "Merge branch 'twin'",
        snapshot: A_TABLE,
        expectedRev: mainState.body.rev,
        merge: { sourceBranchId: twinId, mergedCommitId: twinTipId },
      },
    });
    expect(mergeCommit.status).toBe(201);
    const base = await pool.query("SELECT base_snapshot FROM branches WHERE id = $1", [twinId]);
    expect(base.rows[0].base_snapshot).toEqual(A_TABLE);
  });
});
