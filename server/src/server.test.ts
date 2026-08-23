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
import { EXAMPLE_SCHEMA, type Schema } from "engine";
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
