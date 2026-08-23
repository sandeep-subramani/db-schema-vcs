import { describe, expect, it } from "vitest";
import { mergeSchemas, validateSchema } from "./index.ts";
import type {
  Column,
  ColumnType,
  ForeignKey,
  MergeAnswers,
  MergeResolution,
  MergeSide,
  RenameDecision,
  Schema,
  Table,
} from "./index.ts";

function col(
  name: string,
  type: ColumnType = "text",
  extra: Partial<Column> = {},
): Column {
  return { name, type, nullable: false, ...extra };
}

function table(name: string, columns: Column[], extra: Partial<Table> = {}): Table {
  return { name, columns, ...extra };
}

function schema(...tables: Table[]): Schema {
  return { tables };
}

// Same order-insensitive comparison as apply.test.ts: order is not
// versioned (decisions.md #18), so merged output is compared with
// tables, columns and FKs sorted. PK order stays — it's meaningful.
function canonicalize(input: Schema): Schema {
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);
  const fkKey = (fk: ForeignKey) =>
    `${fk.column} ${fk.references.table} ${fk.references.column}`;
  return {
    tables: [...input.tables].sort(byName).map((t) => {
      const clone: Table = {
        name: t.name,
        columns: [...t.columns].sort(byName),
      };
      if (t.primaryKey) clone.primaryKey = t.primaryKey;
      if (t.foreignKeys && t.foreignKeys.length > 0) {
        clone.foreignKeys = [...t.foreignKeys].sort((a, b) =>
          fkKey(a).localeCompare(fkKey(b)),
        );
      }
      return clone;
    }),
  };
}

function expectSchema(actual: Schema | null, expected: Schema) {
  expect(actual).not.toBeNull();
  expect(canonicalize(actual!)).toEqual(canonicalize(expected));
}

/** Merge expecting no questions and no conflicts; returns merged. */
function cleanMerge(
  base: Schema,
  ours: Schema,
  theirs: Schema,
  answers: MergeAnswers = {},
): Schema {
  const result = mergeSchemas(base, ours, theirs, answers);
  expect(result.questions).toEqual([]);
  expect(result.conflicts).toEqual([]);
  expect(result.merged).not.toBeNull();
  return result.merged!;
}

/** Resolve every conflict to one side and return the merged schema. */
function resolveAll(
  base: Schema,
  ours: Schema,
  theirs: Schema,
  choose: MergeSide,
  answers: MergeAnswers = {},
): Schema {
  const first = mergeSchemas(base, ours, theirs, answers);
  expect(first.questions).toEqual([]);
  expect(first.conflicts.length).toBeGreaterThan(0);
  const resolutions = first.conflicts.map((c) => ({ id: c.id, choose }));
  const result = mergeSchemas(base, ours, theirs, { ...answers, resolutions });
  expect(result.merged).not.toBeNull();
  return result.merged!;
}

// A base most scenarios share: a users table (unique email) and an
// orders table holding a foreign key into users.
const base = () =>
  schema(
    table(
      "users",
      [
        col("id", "unique-id"),
        col("email", "text", { unique: true, maxLength: 255 }),
        col("name", "text"),
      ],
      { primaryKey: ["id"] },
    ),
    table(
      "orders",
      [
        col("id", "whole-number"),
        col("user_id", "unique-id"),
        col("total", "decimal-number"),
      ],
      {
        primaryKey: ["id"],
        foreignKeys: [
          { column: "user_id", references: { table: "users", column: "id" } },
        ],
      },
    ),
  );

/** Rename a table the way the product would: every FK reference to it
 *  follows along, so the result is still a valid schema. */
function renameTable(s: Schema, from: string, to: string): void {
  for (const t of s.tables) {
    if (t.name === from) t.name = to;
    for (const fk of t.foreignKeys ?? []) {
      if (fk.references.table === from) fk.references.table = to;
    }
  }
}

const tableRename = (from: string, to: string): RenameDecision => ({
  kind: "table",
  from,
  to,
  rename: true,
});
const columnRename = (
  tableName: string,
  from: string,
  to: string,
): RenameDecision => ({ kind: "column", table: tableName, from, to, rename: true });

describe("mergeSchemas — clean merges", () => {
  it("merging a branch with an untouched side yields the other side", () => {
    const changed = schema(
      ...base().tables,
      table("sessions", [col("token", "unique-id")], { primaryKey: ["token"] }),
    );
    expectSchema(cleanMerge(base(), base(), changed), changed);
    expectSchema(cleanMerge(base(), changed, base()), changed);
    expectSchema(cleanMerge(base(), base(), base()), base());
  });

  it("applies both sides when they touch different tables", () => {
    const ours = base();
    ours.tables[0]!.columns.push(col("bio", "text", { nullable: true }));
    const theirs = base();
    theirs.tables[1]!.columns[2] = col("total", "floating-point");

    const merged = cleanMerge(base(), ours, theirs);
    const expected = base();
    expected.tables[0]!.columns.push(col("bio", "text", { nullable: true }));
    expected.tables[1]!.columns[2] = col("total", "floating-point");
    expectSchema(merged, expected);
  });

  it("applies both sides when they touch different properties of the same column", () => {
    const ours = base();
    ours.tables[0]!.columns[2] = col("name", "text", { maxLength: 100 });
    const theirs = base();
    theirs.tables[0]!.columns[2] = col("name", "text", { nullable: true });

    const merged = cleanMerge(base(), ours, theirs);
    const expected = base();
    expected.tables[0]!.columns[2] = col("name", "text", {
      maxLength: 100,
      nullable: true,
    });
    expectSchema(merged, expected);
  });

  it("treats the same change on both sides as one change, not a conflict", () => {
    const retyped = () => {
      const s = base();
      s.tables[1]!.columns[2] = col("total", "floating-point");
      return s;
    };
    expectSchema(cleanMerge(base(), retyped(), retyped()), retyped());
  });

  it("agrees property-by-property: same retype plus an extra change composes", () => {
    const ours = base();
    ours.tables[1]!.columns[2] = col("total", "floating-point");
    const theirs = base();
    theirs.tables[1]!.columns[2] = col("total", "floating-point", { nullable: true });

    const merged = cleanMerge(base(), ours, theirs);
    const expected = base();
    expected.tables[1]!.columns[2] = col("total", "floating-point", { nullable: true });
    expectSchema(merged, expected);
  });

  it("both sides adding an identical table (any column order) adds it once", () => {
    const columns = [col("token", "unique-id"), col("seen", "date-time")];
    const ours = schema(...base().tables, table("sessions", columns, { primaryKey: ["token"] }));
    const theirs = schema(
      ...base().tables,
      table("sessions", [columns[1]!, columns[0]!], { primaryKey: ["token"] }),
    );
    const merged = cleanMerge(base(), ours, theirs);
    expect(merged.tables.filter((t) => t.name === "sessions")).toHaveLength(1);
  });

  it("both sides adding an identical foreign key adds it once", () => {
    const withFk = () => {
      const s = base();
      s.tables[0]!.columns.push(col("referrer_id", "unique-id", { nullable: true }));
      s.tables[0]!.foreignKeys = [
        { column: "referrer_id", references: { table: "users", column: "id" } },
      ];
      return s;
    };
    const merged = cleanMerge(base(), withFk(), withFk());
    expect(merged.tables[0]!.foreignKeys).toHaveLength(1);
  });
});

describe("mergeSchemas — renames compose with the other side", () => {
  it("lands one side's column edit on a column the other side renamed", () => {
    const ours = base();
    ours.tables[0]!.columns[1] = col("email", "text", { unique: true, maxLength: 500 });
    const theirs = base();
    theirs.tables[0]!.columns[1] = col("contact_email", "text", {
      unique: true,
      maxLength: 255,
    });

    const merged = cleanMerge(base(), ours, theirs, {
      theirsRenames: [columnRename("users", "email", "contact_email")],
    });
    const users = merged.tables.find((t) => t.name === "users")!;
    expect(users.columns.map((c) => c.name)).toContain("contact_email");
    expect(users.columns.map((c) => c.name)).not.toContain("email");
    expect(users.columns.find((c) => c.name === "contact_email")!.maxLength).toBe(500);
  });

  it("re-points one side's new foreign key at a table the other side renamed", () => {
    const ours = base();
    ours.tables.push(
      table(
        "reviews",
        [col("id", "whole-number"), col("author_id", "unique-id")],
        {
          primaryKey: ["id"],
          foreignKeys: [
            { column: "author_id", references: { table: "users", column: "id" } },
          ],
        },
      ),
    );
    const theirs = base();
    renameTable(theirs, "users", "customers");

    const merged = cleanMerge(base(), ours, theirs, {
      theirsRenames: [tableRename("users", "customers")],
    });
    const reviews = merged.tables.find((t) => t.name === "reviews")!;
    expect(reviews.foreignKeys![0]!.references.table).toBe("customers");
    // The base FK in orders follows the rename too.
    const orders = merged.tables.find((t) => t.name === "orders")!;
    expect(orders.foreignKeys![0]!.references.table).toBe("customers");
    expect(validateSchema(merged).ok).toBe(true);
  });

  it("renaming a column on one side and its table on the other composes", () => {
    const ours = base();
    renameTable(ours, "users", "customers");
    const theirs = base();
    theirs.tables[0]!.columns[2] = col("full_name", "text");

    const merged = cleanMerge(base(), ours, theirs, {
      oursRenames: [tableRename("users", "customers")],
      theirsRenames: [columnRename("users", "name", "full_name")],
    });
    const customers = merged.tables.find((t) => t.name === "customers")!;
    expect(customers.columns.map((c) => c.name)).toContain("full_name");
  });
});

// Each scenario: a base, two sides, optional rename answers, and the
// number of conflicts expected. Reused by the symmetry and the
// every-resolution-validates suites below.
interface Scenario {
  name: string;
  base: Schema;
  ours: Schema;
  theirs: Schema;
  answers?: MergeAnswers;
  conflicts: number;
  reason: string | RegExp;
}

function scenarios(): Scenario[] {
  const list: Scenario[] = [];

  {
    const ours = base();
    ours.tables[1]!.columns[2] = col("total", "floating-point");
    const theirs = base();
    theirs.tables[1]!.columns[2] = col("total", "whole-number-large");
    list.push({
      name: "same column retyped differently",
      base: base(),
      ours,
      theirs,
      conflicts: 1,
      reason: /changed type of "orders\.total"/,
    });
  }

  {
    const ours = base();
    ours.tables[0]!.columns[1] = col("email", "text", { unique: true, maxLength: 100 });
    const theirs = base();
    theirs.tables[0]!.columns[1] = col("email", "text", { unique: true, maxLength: 500 });
    list.push({
      name: "same length limit changed differently",
      base: base(),
      ours,
      theirs,
      conflicts: 1,
      reason: /changed maxLength of "users\.email"/,
    });
  }

  {
    // decisions.md #9's named case: one side retypes away from text,
    // the other adds a length limit — each valid alone, broken together.
    const plain = schema(table("notes", [col("id", "whole-number"), col("body", "text")], { primaryKey: ["id"] }));
    const ours = schema(table("notes", [col("id", "whole-number"), col("body", "binary-data")], { primaryKey: ["id"] }));
    const theirs = schema(
      table("notes", [col("id", "whole-number"), col("body", "text", { maxLength: 500 })], { primaryKey: ["id"] }),
    );
    list.push({
      name: "retyped away from text vs new length limit",
      base: plain,
      ours,
      theirs,
      conflicts: 1,
      reason: /no longer text while the other gave it a length limit/,
    });
  }

  {
    const ours = base();
    ours.tables[0]!.columns[2] = col("full_name", "text");
    const theirs = base();
    theirs.tables[0]!.columns[2] = col("display_name", "text");
    list.push({
      name: "same column renamed differently",
      base: base(),
      ours,
      theirs,
      answers: {
        oursRenames: [columnRename("users", "name", "full_name")],
        theirsRenames: [columnRename("users", "name", "display_name")],
      },
      conflicts: 1,
      reason: /renamed differently on each side/,
    });
  }

  {
    const ours = base();
    renameTable(ours, "users", "members");
    const theirs = base();
    renameTable(theirs, "users", "customers");
    list.push({
      name: "same table renamed differently",
      base: base(),
      ours,
      theirs,
      answers: {
        oursRenames: [tableRename("users", "members")],
        theirsRenames: [tableRename("users", "customers")],
      },
      conflicts: 1,
      reason: /table "users" was renamed differently/,
    });
  }

  {
    const ours = base();
    renameTable(ours, "users", "accounts");
    const theirs = base();
    renameTable(theirs, "orders", "accounts");
    list.push({
      name: "two different tables renamed to the same name",
      base: base(),
      ours,
      theirs,
      answers: {
        oursRenames: [tableRename("users", "accounts")],
        theirsRenames: [tableRename("orders", "accounts")],
      },
      conflicts: 1,
      reason: /both sides renamed a table to "accounts"/,
    });
  }

  {
    const ours = base();
    renameTable(ours, "users", "accounts");
    const theirs = schema(...base().tables, table("accounts", [col("id", "whole-number")], { primaryKey: ["id"] }));
    list.push({
      name: "rename-to collides with an added table",
      base: base(),
      ours,
      theirs,
      answers: { oursRenames: [tableRename("users", "accounts")] },
      conflicts: 1,
      reason: /renamed table "users" to "accounts" while the other added a new table/,
    });
  }

  {
    const ours = schema(...base().tables, table("tags", [col("id", "whole-number"), col("label", "text")], { primaryKey: ["id"] }));
    const theirs = schema(...base().tables, table("tags", [col("id", "unique-id"), col("label", "text")], { primaryKey: ["id"] }));
    list.push({
      name: "both added a table with the same name, differently",
      base: base(),
      ours,
      theirs,
      conflicts: 1,
      reason: /both sides added a table named "tags"/,
    });
  }

  {
    const ours = base();
    ours.tables[0]!.columns.push(col("age", "whole-number", { nullable: true }));
    const theirs = base();
    theirs.tables[0]!.columns.push(col("age", "whole-number-small", { nullable: true }));
    list.push({
      name: "both added a column with the same name, differently",
      base: base(),
      ours,
      theirs,
      conflicts: 1,
      reason: /both sides added a column "users\.age"/,
    });
  }

  {
    const ours = base();
    ours.tables[0]!.columns[2] = col("name", "text", { maxLength: 80 });
    const theirs = base();
    theirs.tables[0]!.columns.splice(2, 1);
    list.push({
      name: "column changed on one side, dropped on the other",
      base: base(),
      ours,
      theirs,
      conflicts: 1,
      reason: /dropped on one side and changed on the other/,
    });
  }

  {
    const ours = base();
    ours.tables[0]!.columns[2] = col("full_name", "text");
    const theirs = base();
    theirs.tables[0]!.columns.splice(2, 1);
    list.push({
      name: "column renamed on one side, dropped on the other",
      base: base(),
      ours,
      theirs,
      answers: { oursRenames: [columnRename("users", "name", "full_name")] },
      conflicts: 1,
      reason: /dropped on one side and renamed/,
    });
  }

  {
    // Dropping users forces theirs to drop orders' FK too; the rename
    // side keeps everything. Rename-vs-drop is the conflict.
    const ours = base();
    renameTable(ours, "users", "customers");
    const theirs = base();
    theirs.tables.splice(0, 1);
    delete theirs.tables[0]!.foreignKeys;
    list.push({
      name: "table renamed on one side, dropped on the other",
      base: base(),
      ours,
      theirs,
      answers: { oursRenames: [tableRename("users", "customers")] },
      conflicts: 1,
      reason: /dropped on one side and renamed to "customers"/,
    });
  }

  {
    const ours = base();
    ours.tables[1]!.columns[2] = col("total", "floating-point");
    const theirs = base();
    theirs.tables.splice(1, 1);
    list.push({
      name: "table changed on one side, dropped on the other",
      base: base(),
      ours,
      theirs,
      conflicts: 1,
      reason: /table "orders" was dropped on one side and changed on the other/,
    });
  }

  {
    // FK added to a table the other side dropped (decisions.md #3).
    const plain = schema(
      table("users", [col("id", "unique-id")], { primaryKey: ["id"] }),
      table("posts", [col("id", "whole-number"), col("author_id", "unique-id")], { primaryKey: ["id"] }),
    );
    const ours = schema(
      plain.tables[0]!,
      table("posts", [col("id", "whole-number"), col("author_id", "unique-id")], {
        primaryKey: ["id"],
        foreignKeys: [
          { column: "author_id", references: { table: "users", column: "id" } },
        ],
      }),
    );
    const theirs = schema(plain.tables[1]!);
    list.push({
      name: "foreign key added to a table the other side dropped",
      base: plain,
      ours,
      theirs,
      conflicts: 1,
      reason: /new foreign key points at table "users", which the other side dropped/,
    });
  }

  {
    // Same, but the FK arrives inside a whole added table.
    const plain = schema(table("users", [col("id", "unique-id")], { primaryKey: ["id"] }));
    const ours = schema(
      plain.tables[0]!,
      table("reviews", [col("id", "whole-number"), col("author_id", "unique-id")], {
        primaryKey: ["id"],
        foreignKeys: [
          { column: "author_id", references: { table: "users", column: "id" } },
        ],
      }),
    );
    const theirs = schema();
    list.push({
      name: "added table's foreign key points at a table the other side dropped",
      base: plain,
      ours,
      theirs,
      conflicts: 1,
      reason: /new foreign key points at table "users"/,
    });
  }

  {
    // FK added targeting a column the other side dropped.
    const plain = schema(
      table("users", [col("id", "unique-id"), col("handle", "text", { unique: true })], { primaryKey: ["id"] }),
      table("posts", [col("id", "whole-number"), col("author_handle", "text")], { primaryKey: ["id"] }),
    );
    const ours = schema(
      plain.tables[0]!,
      table("posts", [col("id", "whole-number"), col("author_handle", "text")], {
        primaryKey: ["id"],
        foreignKeys: [
          { column: "author_handle", references: { table: "users", column: "handle" } },
        ],
      }),
    );
    const theirs = schema(
      table("users", [col("id", "unique-id")], { primaryKey: ["id"] }),
      plain.tables[1]!,
    );
    list.push({
      name: "foreign key added targeting a column the other side dropped",
      base: plain,
      ours,
      theirs,
      conflicts: 1,
      reason: /uses column "users\.handle", which the other side dropped/,
    });
  }

  {
    // decisions.md #10's named case: unique removed under a new FK.
    const plain = schema(
      table("users", [col("id", "unique-id"), col("email", "text", { unique: true })], { primaryKey: ["id"] }),
      table("invoices", [col("id", "whole-number"), col("user_email", "text")], { primaryKey: ["id"] }),
    );
    const ours = schema(
      plain.tables[0]!,
      table("invoices", [col("id", "whole-number"), col("user_email", "text")], {
        primaryKey: ["id"],
        foreignKeys: [
          { column: "user_email", references: { table: "users", column: "email" } },
        ],
      }),
    );
    const theirs = schema(
      table("users", [col("id", "unique-id"), col("email", "text")], { primaryKey: ["id"] }),
      plain.tables[1]!,
    );
    list.push({
      name: "unique removed while the other side adds an FK targeting it",
      base: plain,
      ours,
      theirs,
      conflicts: 1,
      reason: /unique constraint on "users\.email" was removed .* foreign key targeting it/,
    });
  }

  {
    // A new FK next to a retyped target column.
    const plain = schema(
      table("users", [col("id", "unique-id")], { primaryKey: ["id"] }),
      table("posts", [col("id", "whole-number"), col("author_id", "unique-id")], { primaryKey: ["id"] }),
    );
    const ours = schema(
      plain.tables[0]!,
      table("posts", [col("id", "whole-number"), col("author_id", "unique-id")], {
        primaryKey: ["id"],
        foreignKeys: [
          { column: "author_id", references: { table: "users", column: "id" } },
        ],
      }),
    );
    const theirs = schema(
      table("users", [col("id", "whole-number-large")], { primaryKey: ["id"] }),
      plain.tables[1]!,
    );
    list.push({
      name: "foreign key added while the other side retypes its target",
      base: plain,
      ours,
      theirs,
      conflicts: 1,
      reason: /retyped on one side while the other added a foreign key/,
    });
  }

  {
    // PK widened while the other side adds an FK that relied on it.
    const plain = schema(
      table("products", [col("sku", "text"), col("region", "text")], { primaryKey: ["sku"] }),
      table("offers", [col("id", "whole-number"), col("product_sku", "text")], { primaryKey: ["id"] }),
    );
    const ours = schema(
      plain.tables[0]!,
      table("offers", [col("id", "whole-number"), col("product_sku", "text")], {
        primaryKey: ["id"],
        foreignKeys: [
          { column: "product_sku", references: { table: "products", column: "sku" } },
        ],
      }),
    );
    const theirs = schema(
      table("products", [col("sku", "text"), col("region", "text")], { primaryKey: ["sku", "region"] }),
      plain.tables[1]!,
    );
    list.push({
      name: "primary key widened while the other side adds an FK relying on it",
      base: plain,
      ours,
      theirs,
      conflicts: 1,
      reason: /primary key of "products" changed .* relying on "products\.sku" being unique/,
    });
  }

  {
    const ours = base();
    ours.tables[1]!.primaryKey = ["id", "user_id"];
    ours.tables[1]!.foreignKeys = undefined;
    const theirs = base();
    theirs.tables[1]!.primaryKey = ["id", "total"];
    list.push({
      name: "primary key changed differently on both sides",
      base: base(),
      ours,
      theirs,
      conflicts: 1,
      reason: /both sides changed the primary key of "orders"/,
    });
  }

  {
    const plain = schema(table("events", [col("id", "whole-number"), col("day", "date")], { primaryKey: ["id"] }));
    const ours = schema(
      table("events", [col("id", "whole-number"), col("day", "date", { nullable: true })], { primaryKey: ["id"] }),
    );
    const theirs = schema(
      table("events", [col("id", "whole-number"), col("day", "date")], { primaryKey: ["id", "day"] }),
    );
    list.push({
      name: "column made nullable while the other side puts it in the primary key",
      base: plain,
      ours,
      theirs,
      conflicts: 1,
      reason: /became nullable on one side and part of the primary key on the other/,
    });
  }

  {
    const plain = schema(table("events", [col("id", "whole-number"), col("day", "date")], { primaryKey: ["id"] }));
    const ours = schema(
      table("events", [col("id", "whole-number"), col("day", "date")], { primaryKey: ["id", "day"] }),
    );
    const theirs = schema(table("events", [col("id", "whole-number")], { primaryKey: ["id"] }));
    list.push({
      name: "new primary key includes a column the other side dropped",
      base: plain,
      ours,
      theirs,
      conflicts: 1,
      reason: /new primary key of "events" includes "events\.day", which the other side dropped/,
    });
  }

  {
    const ours = base();
    ours.tables[0]!.columns.push(col("referrer_id", "unique-id", { nullable: true }));
    ours.tables[0]!.foreignKeys = [
      { column: "referrer_id", references: { table: "users", column: "id" } },
    ];
    const theirs = base();
    theirs.tables[0]!.columns.push(col("referrer_id", "unique-id", { nullable: true }));
    theirs.tables[0]!.columns.push(col("invited_by", "unique-id", { nullable: true }));
    theirs.tables[0]!.foreignKeys = [
      { column: "referrer_id", references: { table: "users", column: "id" } },
      { column: "invited_by", references: { table: "users", column: "id" } },
    ];
    list.push({
      name: "no conflict: overlapping FK additions agree, extra one rides along",
      base: base(),
      ours,
      theirs,
      conflicts: 0,
      reason: "",
    });
  }

  return list;
}

describe("mergeSchemas — conflict catalogue", () => {
  for (const s of scenarios().filter((s) => s.conflicts > 0)) {
    it(s.name, () => {
      const result = mergeSchemas(s.base, s.ours, s.theirs, s.answers);
      expect(result.questions).toEqual([]);
      expect(result.conflicts).toHaveLength(s.conflicts);
      expect(result.merged).toBeNull();
      const reasons = result.conflicts.flatMap((c) => c.reasons).join("\n");
      expect(reasons).toMatch(s.reason);
    });
  }

  it("agreeing FK additions merge cleanly", () => {
    const s = scenarios().find((x) => x.conflicts === 0)!;
    const merged = cleanMerge(s.base, s.ours, s.theirs);
    const users = merged.tables.find((t) => t.name === "users")!;
    expect(users.foreignKeys).toHaveLength(2);
  });

  it("unique removal is no conflict when the sole primary key still justifies the FK", () => {
    const plain = schema(
      table("countries", [col("code", "text", { unique: true })], { primaryKey: ["code"] }),
      table("cities", [col("id", "whole-number"), col("country", "text")], { primaryKey: ["id"] }),
    );
    const ours = schema(
      plain.tables[0]!,
      table("cities", [col("id", "whole-number"), col("country", "text")], {
        primaryKey: ["id"],
        foreignKeys: [
          { column: "country", references: { table: "countries", column: "code" } },
        ],
      }),
    );
    const theirs = schema(
      table("countries", [col("code", "text")], { primaryKey: ["code"] }),
      plain.tables[1]!,
    );
    const merged = cleanMerge(plain, ours, theirs);
    expect(validateSchema(merged).ok).toBe(true);
  });

  it("a PK change is no conflict for an FK justified by an untouched unique flag", () => {
    const plain = schema(
      table("products", [col("sku", "text", { unique: true }), col("region", "text")], { primaryKey: ["sku"] }),
      table("offers", [col("id", "whole-number"), col("product_sku", "text")], { primaryKey: ["id"] }),
    );
    const ours = schema(
      plain.tables[0]!,
      table("offers", [col("id", "whole-number"), col("product_sku", "text")], {
        primaryKey: ["id"],
        foreignKeys: [
          { column: "product_sku", references: { table: "products", column: "sku" } },
        ],
      }),
    );
    const theirs = schema(
      table("products", [col("sku", "text", { unique: true }), col("region", "text")], { primaryKey: ["sku", "region"] }),
      plain.tables[1]!,
    );
    const merged = cleanMerge(plain, ours, theirs);
    expect(validateSchema(merged).ok).toBe(true);
  });
});

describe("mergeSchemas — resolutions", () => {
  it("resolving to each side yields that side's version of the disputed thing", () => {
    const ours = base();
    ours.tables[1]!.columns[2] = col("total", "floating-point");
    const theirs = base();
    theirs.tables[1]!.columns[2] = col("total", "whole-number-large");

    const oursWin = resolveAll(base(), ours, theirs, "ours");
    expect(oursWin.tables[1]!.columns[2]!.type).toBe("floating-point");
    const theirsWin = resolveAll(base(), ours, theirs, "theirs");
    expect(theirsWin.tables[1]!.columns[2]!.type).toBe("whole-number-large");
  });

  it("a pick keeps the whole group consistent: dropped table takes its dependents", () => {
    const plain = schema(
      table("users", [col("id", "unique-id")], { primaryKey: ["id"] }),
      table("posts", [col("id", "whole-number"), col("author_id", "unique-id")], { primaryKey: ["id"] }),
    );
    const ours = schema(
      plain.tables[0]!,
      table("posts", [col("id", "whole-number"), col("author_id", "unique-id")], {
        primaryKey: ["id"],
        foreignKeys: [
          { column: "author_id", references: { table: "users", column: "id" } },
        ],
      }),
    );
    const theirs = schema(plain.tables[1]!);

    const oursWin = resolveAll(plain, ours, theirs, "ours");
    expect(oursWin.tables.map((t) => t.name).sort()).toEqual(["posts", "users"]);
    expect(oursWin.tables.find((t) => t.name === "posts")!.foreignKeys).toHaveLength(1);

    const theirsWin = resolveAll(plain, ours, theirs, "theirs");
    expect(theirsWin.tables.map((t) => t.name)).toEqual(["posts"]);
    expect(theirsWin.tables[0]!.foreignKeys).toBeUndefined();
  });

  it("unrelated changes still apply whichever side wins a conflict", () => {
    const ours = base();
    ours.tables[1]!.columns[2] = col("total", "floating-point");
    ours.tables[0]!.columns.push(col("bio", "text", { nullable: true }));
    const theirs = base();
    theirs.tables[1]!.columns[2] = col("total", "whole-number-large");
    theirs.tables.push(table("sessions", [col("token", "unique-id")], { primaryKey: ["token"] }));

    const theirsWin = resolveAll(base(), ours, theirs, "theirs");
    expect(theirsWin.tables.find((t) => t.name === "users")!.columns.map((c) => c.name)).toContain("bio");
    expect(theirsWin.tables.some((t) => t.name === "sessions")).toBe(true);
    expect(theirsWin.tables.find((t) => t.name === "orders")!.columns[2]!.type).toBe("whole-number-large");
  });

  it("ignores resolutions whose id names no conflict", () => {
    const ours = base();
    ours.tables[1]!.columns[2] = col("total", "floating-point");
    const theirs = base();
    theirs.tables[1]!.columns[2] = col("total", "whole-number-large");
    const result = mergeSchemas(base(), ours, theirs, {
      resolutions: [{ id: "not-a-conflict", choose: "ours" }],
    });
    expect(result.merged).toBeNull();
  });

  it("every scenario fixture is itself a valid schema", () => {
    for (const s of scenarios()) {
      for (const snapshot of [s.base, s.ours, s.theirs]) {
        const checked = validateSchema(snapshot);
        expect(checked.ok, `${s.name}: ${JSON.stringify(checked)}`).toBe(true);
      }
    }
  });

  it("every combination of picks over several conflicts produces a valid schema", () => {
    // Three independent conflicts at once: a retype dispute, a
    // drop-vs-change dispute, and an FK-vs-unique-removal dispute.
    const plain = schema(
      table("users", [col("id", "unique-id"), col("email", "text", { unique: true })], { primaryKey: ["id"] }),
      table("orders", [col("id", "whole-number"), col("total", "decimal-number")], { primaryKey: ["id"] }),
      table("logs", [col("id", "whole-number"), col("note", "text")], { primaryKey: ["id"] }),
    );
    const ours = schema(
      plain.tables[0]!,
      table("orders", [col("id", "whole-number"), col("total", "floating-point")], {
        primaryKey: ["id"],
      }),
      table("logs", [col("id", "whole-number"), col("note", "text", { maxLength: 200 })], { primaryKey: ["id"] }),
      table("invoices", [col("id", "whole-number"), col("user_email", "text")], {
        primaryKey: ["id"],
        foreignKeys: [
          { column: "user_email", references: { table: "users", column: "email" } },
        ],
      }),
    );
    const theirs = schema(
      table("users", [col("id", "unique-id"), col("email", "text")], { primaryKey: ["id"] }),
      table("orders", [col("id", "whole-number"), col("total", "whole-number-large")], { primaryKey: ["id"] }),
    );

    const first = mergeSchemas(plain, ours, theirs);
    expect(first.questions).toEqual([]);
    expect(first.conflicts).toHaveLength(3);
    const n = first.conflicts.length;
    for (let mask = 0; mask < 1 << n; mask++) {
      const resolutions: MergeResolution[] = first.conflicts.map((c, i) => ({
        id: c.id,
        choose: mask & (1 << i) ? ("ours" as const) : ("theirs" as const),
      }));
      const result = mergeSchemas(plain, ours, theirs, { resolutions });
      expect(result.merged).not.toBeNull();
      expect(validateSchema(result.merged!).ok).toBe(true);
    }
  });
});

describe("mergeSchemas — symmetry", () => {
  it("swapping the sides swaps every conflict but changes nothing else", () => {
    for (const s of scenarios()) {
      const ab = mergeSchemas(s.base, s.ours, s.theirs, s.answers);
      const ba = mergeSchemas(s.base, s.theirs, s.ours, {
        oursRenames: s.answers?.theirsRenames,
        theirsRenames: s.answers?.oursRenames,
      });
      expect(ba.conflicts.map((c) => c.id)).toEqual(ab.conflicts.map((c) => c.id));
      for (let i = 0; i < ab.conflicts.length; i++) {
        expect(ba.conflicts[i]!.ours).toEqual(ab.conflicts[i]!.theirs);
        expect(ba.conflicts[i]!.theirs).toEqual(ab.conflicts[i]!.ours);
        expect([...ba.conflicts[i]!.reasons].sort()).toEqual(
          [...ab.conflicts[i]!.reasons].sort(),
        );
      }
    }
  });

  it("swapping the sides and the picks yields the same merged schema", () => {
    for (const s of scenarios()) {
      for (const choose of ["ours", "theirs"] as const) {
        const swapped = choose === "ours" ? "theirs" : "ours";
        const ab = mergeSchemas(s.base, s.ours, s.theirs, s.answers);
        const abResolved = mergeSchemas(s.base, s.ours, s.theirs, {
          ...s.answers,
          resolutions: ab.conflicts.map((c) => ({ id: c.id, choose })),
        });
        const ba = mergeSchemas(s.base, s.theirs, s.ours, {
          oursRenames: s.answers?.theirsRenames,
          theirsRenames: s.answers?.oursRenames,
          resolutions: ab.conflicts.map((c) => ({ id: c.id, choose: swapped })),
        });
        expect(abResolved.merged).not.toBeNull();
        expect(ba.merged).not.toBeNull();
        expect(canonicalize(ba.merged!)).toEqual(canonicalize(abResolved.merged!));
      }
    }
  });
});

describe("mergeSchemas — rename questions", () => {
  const withQuestion = () => {
    // theirs replaces email with contact_email (a question-tier pair);
    // ours edits email. Unanswered, the pair reads as drop+add and
    // collides with the edit; confirmed as a rename, it composes.
    const ours = base();
    ours.tables[0]!.columns[1] = col("email", "text", {
      unique: true,
      maxLength: 255,
      nullable: true,
    });
    const theirs = base();
    theirs.tables[0]!.columns[1] = col("contact_email", "text", {
      unique: true,
      maxLength: 255,
    });
    return { ours, theirs };
  };

  it("surfaces side-labeled questions and withholds the merge until answered", () => {
    const { ours, theirs } = withQuestion();
    const result = mergeSchemas(base(), ours, theirs);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.side).toBe("theirs");
    expect(result.questions[0]!.question).toMatchObject({
      kind: "column",
      table: "users",
      from: "email",
      to: "contact_email",
    });
    expect(result.merged).toBeNull();
  });

  it("answering 'renamed' dissolves the provisional conflict and composes", () => {
    const { ours, theirs } = withQuestion();
    const unanswered = mergeSchemas(base(), ours, theirs);
    expect(unanswered.conflicts.length).toBeGreaterThan(0);

    const answered = mergeSchemas(base(), ours, theirs, {
      theirsRenames: [columnRename("users", "email", "contact_email")],
    });
    expect(answered.questions).toEqual([]);
    expect(answered.conflicts).toEqual([]);
    const users = answered.merged!.tables.find((t) => t.name === "users")!;
    const renamed = users.columns.find((c) => c.name === "contact_email")!;
    expect(renamed.nullable).toBe(true);
  });

  it("answering 'not a rename' keeps the drop-vs-change conflict, resolvable both ways", () => {
    const { ours, theirs } = withQuestion();
    const answers: MergeAnswers = {
      theirsRenames: [
        { kind: "column", table: "users", from: "email", to: "contact_email", rename: false },
      ],
    };
    const result = mergeSchemas(base(), ours, theirs, answers);
    expect(result.questions).toEqual([]);
    expect(result.conflicts).toHaveLength(1);

    const oursWin = resolveAll(base(), ours, theirs, "ours", answers);
    const oursUsers = oursWin.tables.find((t) => t.name === "users")!;
    // email survives with ours' edit; the genuinely-new column lands too.
    expect(oursUsers.columns.find((c) => c.name === "email")!.nullable).toBe(true);
    expect(oursUsers.columns.some((c) => c.name === "contact_email")).toBe(true);

    const theirsWin = resolveAll(base(), ours, theirs, "theirs", answers);
    const theirsUsers = theirsWin.tables.find((t) => t.name === "users")!;
    expect(theirsUsers.columns.some((c) => c.name === "email")).toBe(false);
    expect(theirsUsers.columns.some((c) => c.name === "contact_email")).toBe(true);
  });

  it("conflict ids survive unrelated rename answers", () => {
    const ours = base();
    ours.tables[1]!.columns[2] = col("total", "floating-point");
    ours.tables[0]!.columns[1] = col("email", "text", { unique: true, maxLength: 255, nullable: true });
    const theirs = base();
    theirs.tables[1]!.columns[2] = col("total", "whole-number-large");
    theirs.tables[0]!.columns[1] = col("contact_email", "text", { unique: true, maxLength: 255 });

    const before = mergeSchemas(base(), ours, theirs);
    const after = mergeSchemas(base(), ours, theirs, {
      theirsRenames: [columnRename("users", "email", "contact_email")],
    });
    const totalConflict = (r: typeof before) =>
      r.conflicts.find((c) => c.id.includes("orders.total"))!;
    expect(totalConflict(after).id).toEqual(totalConflict(before).id);
  });
});

describe("mergeSchemas — result plumbing", () => {
  it("exposes each side's diff in that side's own names", () => {
    const ours = base();
    renameTable(ours, "users", "customers");
    const theirs = base();
    theirs.tables[1]!.columns[2] = col("total", "floating-point");

    const result = mergeSchemas(base(), ours, theirs, {
      oursRenames: [tableRename("users", "customers")],
    });
    expect(result.oursChanges).toEqual([
      { kind: "table-renamed", from: "users", to: "customers" },
    ]);
    expect(result.theirsChanges).toMatchObject([
      { kind: "column-changed", table: "orders", column: "total" },
    ]);
  });
});
