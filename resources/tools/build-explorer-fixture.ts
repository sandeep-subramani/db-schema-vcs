import {
  EXAMPLE_SCHEMA, importPostgresSql, mergeSchemas, validateSchema,
  type Schema, type Table,
} from "../../engine/src/index.ts";

const BASE = process.env.BASE ?? "https://db-schema-vcs.onrender.com/api";
const USER = process.env.USER_NAME ?? "explorer";

async function call(path: string, init: RequestInit = {}, user = USER): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        ...init,
        headers: { "content-type": "application/json", "x-username": user, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(120_000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${res.status} ${path} ${JSON.stringify(body)}`);
      return body;
    } catch (e) {
      if (attempt >= 3) throw e;
      console.log(`   retry ${attempt} on ${path}: ${(e as Error).message.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, 4000 * attempt));
    }
  }
}

// --- tiny schema edit helpers (pure, so fixtures stay readable) --------
const clone = (s: Schema): Schema => structuredClone(s);
const table = (s: Schema, name: string): Table =>
  s.tables.find((t) => t.name === name) ?? (() => { throw new Error(`no table ${name}`); })();

function addColumn(s: Schema, t: string, col: any): Schema {
  const next = clone(s); table(next, t).columns.push(col); return next;
}
function retype(s: Schema, t: string, col: string, type: any): Schema {
  const next = clone(s); table(next, t).columns.find((c) => c.name === col)!.type = type; return next;
}
function renameColumn(s: Schema, t: string, from: string, to: string): Schema {
  const next = clone(s); table(next, t).columns.find((c) => c.name === from)!.name = to; return next;
}
function addTable(s: Schema, t: Table): Schema {
  const next = clone(s); next.tables.push(t); return next;
}
function check(label: string, s: Schema): Schema {
  const r = validateSchema(s);
  if (!r.ok) throw new Error(`${label} invalid: ${r.errors.join("; ")}`);
  return r.schema;
}

// --- API verbs ---------------------------------------------------------
async function newRepo(name: string) {
  const { repo } = await call("/repos", { method: "POST", body: JSON.stringify({ name }) });
  const { branches } = await call(`/repos/${repo.id}`);
  console.log(`  repo ${repo.id} "${name}" (main = branch ${branches[0].id})`);
  return { repoId: repo.id as number, mainId: branches[0].id as number };
}
async function commit(branchId: number, message: string, snapshot: Schema, merge?: any) {
  const { rev } = await call(`/branches/${branchId}`);
  const body: any = { message, snapshot, expectedRev: rev };
  if (merge) body.merge = merge;
  const { commit } = await call(`/branches/${branchId}/commits`, { method: "POST", body: JSON.stringify(body) });
  console.log(`    commit ${commit.id} on branch ${branchId}: ${message}`);
  return commit.id as number;
}
async function branchOff(repoId: number, name: string, fromBranchId: number) {
  const { branch } = await call(`/repos/${repoId}/branches`, {
    method: "POST", body: JSON.stringify({ name, fromBranchId }),
  });
  console.log(`    branch ${branch.id} "${name}" off ${fromBranchId}`);
  return branch.id as number;
}
const tipOf = async (branchId: number) =>
  (await call(`/branches/${branchId}/commits`)).commits[0].id as number;

// --- the SQL that seeds `analytics` -------------------------------------
const ANALYTICS_SQL = `CREATE TABLE sources (
    id serial PRIMARY KEY,
    slug varchar(60) NOT NULL UNIQUE,
    label varchar(120) NOT NULL
);

CREATE TABLE events (
    id bigserial PRIMARY KEY,
    source_id integer NOT NULL REFERENCES sources(id),
    name varchar(120) NOT NULL,
    value numeric NOT NULL,
    payload jsonb,
    tags text[],
    sample_rate real,
    window_length interval,
    occurred_at timestamptz NOT NULL
);

CREATE INDEX events_occurred_at_idx ON events (occurred_at);

CREATE TABLE sessions (
    id uuid PRIMARY KEY,
    source_id integer NOT NULL REFERENCES sources(id),
    started_at timestamptz NOT NULL,
    ended_at timestamptz
);
`;

// --- the JSON that seeds `inventory` ------------------------------------
const INVENTORY_JSON: Schema = {
  tables: [
    { name: "warehouses", primaryKey: ["id"], columns: [
      { name: "id", type: "auto-number", nullable: false },
      { name: "code", type: "text", nullable: false, unique: true, maxLength: 20 },
      { name: "name", type: "text", nullable: false, maxLength: 120 },
      { name: "region", type: "text", nullable: true, maxLength: 60 }] },
    { name: "suppliers", primaryKey: ["id"], columns: [
      { name: "id", type: "auto-number", nullable: false },
      { name: "name", type: "text", nullable: false, maxLength: 160 },
      { name: "email", type: "text", nullable: true, unique: true, maxLength: 255 }] },
    { name: "items", primaryKey: ["id"],
      foreignKeys: [{ column: "warehouse_id", references: { table: "warehouses", column: "id" } }],
      columns: [
      { name: "id", type: "auto-number", nullable: false },
      { name: "sku", type: "text", nullable: false, unique: true, maxLength: 40 },
      { name: "name", type: "text", nullable: false, maxLength: 200 },
      { name: "unit_cost", type: "decimal-number", nullable: false },
      { name: "warehouse_id", type: "whole-number", nullable: false }] },
    { name: "stock_counts", primaryKey: ["item_id", "counted_on"],
      foreignKeys: [{ column: "item_id", references: { table: "items", column: "id" } }],
      columns: [
      { name: "item_id", type: "whole-number", nullable: false },
      { name: "counted_on", type: "date", nullable: false },
      { name: "quantity", type: "whole-number", nullable: false }] },
  ],
};

async function main() {
  await call("/users", { method: "POST", body: JSON.stringify({ username: USER }) });
  console.log(`claimed "${USER}"`);

  // ===== storefront — the finished happy path ==========================
  console.log("\nstorefront");
  const sf = await newRepo("storefront");
  const sf1 = check("example", EXAMPLE_SCHEMA);
  await commit(sf.mainId, "Import the example web-shop schema", sf1);

  const sf2 = check("phone", addColumn(sf1, "users",
    { name: "phone", type: "text", nullable: true, maxLength: 30 }));
  await commit(sf.mainId, "Add a phone number to users", sf2);

  // branch point is sf2, so both sides diverge from a shared ancestor
  const reviewsBranch = await branchOff(sf.repoId, "add-reviews", sf.mainId);

  const sfMain = check("currency", addColumn(sf2, "products",
    { name: "currency", type: "text", nullable: false, maxLength: 3 }));
  await commit(sf.mainId, "Price products in an explicit currency", sfMain);

  const sfRev1 = check("reviews", addTable(sf2, {
    name: "reviews", primaryKey: ["id"],
    foreignKeys: [
      { column: "product_id", references: { table: "products", column: "id" } },
      { column: "user_id", references: { table: "users", column: "id" } }],
    columns: [
      { name: "id", type: "auto-number", nullable: false },
      { name: "product_id", type: "whole-number", nullable: false },
      { name: "user_id", type: "unique-id", nullable: false },
      { name: "rating", type: "whole-number-small", nullable: false },
      { name: "body", type: "text", nullable: true }],
  }));
  await commit(reviewsBranch, "Add a reviews table", sfRev1);

  const sfRev2 = check("rename", renameColumn(sfRev1, "reviews", "body", "comment"));
  await commit(reviewsBranch, "Rename reviews.body to comment", sfRev2);

  const merged = mergeSchemas(sf2, sfMain, sfRev2);
  if (merged.conflicts.length || merged.questions.length || !merged.merged) {
    throw new Error(`storefront merge was meant to be clean: ${JSON.stringify(merged.conflicts)} / ${JSON.stringify(merged.questions)}`);
  }
  await commit(sf.mainId, 'Merge "add-reviews" into main', merged.merged, {
    sourceBranchId: reviewsBranch, mergedCommitId: await tipOf(reviewsBranch),
  });

  // ===== analytics — SQL entry, left mid-conflict =======================
  console.log("\nanalytics");
  const sql = importPostgresSql(ANALYTICS_SQL);
  if (!sql.ok) throw new Error("analytics SQL failed to import");
  console.log(`  SQL import: ${sql.tableCount} tables, ${sql.issues.length} skip-list lines`);
  const an = await newRepo("analytics");
  await commit(an.mainId, "Import the analytics schema from Postgres DDL", sql.schema);

  const an2 = check("unit", addColumn(sql.schema, "events",
    { name: "unit", type: "text", nullable: true, maxLength: 20 }));
  await commit(an.mainId, "Record the unit an event value is measured in", an2);

  const metrics = await branchOff(an.repoId, "metrics-rework", an.mainId);
  await commit(an.mainId, "Store event values as floating point",
    check("float", retype(an2, "events", "value", "floating-point")));
  await commit(metrics, "Store event values as whole micro-units",
    check("micro", retype(an2, "events", "value", "whole-number-large")));

  // ===== inventory — clean merge still to walk, plus sharing ============
  console.log("\ninventory");
  const inv = await newRepo("inventory");
  const inv1 = check("inventory", INVENTORY_JSON);
  await commit(inv.mainId, "Import the warehouse schema from JSON", inv1);

  const inv2 = check("lead time", addColumn(inv1, "suppliers",
    { name: "lead_time_days", type: "whole-number-small", nullable: true }));
  await commit(inv.mainId, "Track supplier lead times", inv2);

  const archive = await branchOff(inv.repoId, "archive-split", inv.mainId);
  await commit(inv.mainId, "Record who performed each stock count",
    check("counted_by", addColumn(inv2, "stock_counts",
      { name: "counted_by", type: "text", nullable: true, maxLength: 80 })));

  let archived = addColumn(inv2, "items", { name: "archived", type: "true-false", nullable: false });
  archived = addColumn(archived, "items", { name: "archived_on", type: "date", nullable: true });
  await commit(archive, "Let items be archived instead of deleted", check("archived", archived));

  await call(`/repos/${inv.repoId}/members`, { method: "POST", body: JSON.stringify({ username: "sandeep" }) });
  console.log("    shared with sandeep");

  // ===== first-run — the entry doors, untouched =========================
  console.log("\nfirst-run");
  await newRepo("first-run");

  console.log("\ndone");
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
