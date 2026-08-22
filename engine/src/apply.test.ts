import { describe, expect, it } from "vitest";
import { applyDiff, diffSchemas } from "./index.ts";
import type {
  Column,
  ColumnType,
  ForeignKey,
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

// Order is not versioned (see diff.ts), so schemas are compared with
// tables, columns and foreign keys sorted. Primary key order stays —
// it's meaningful.
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
      if (t.foreignKeys) {
        clone.foreignKeys = [...t.foreignKeys].sort((a, b) =>
          fkKey(a).localeCompare(fkKey(b)),
        );
      }
      return clone;
    }),
  };
}

// The core engine guarantee: the diff is a complete recipe from A to
// B, whatever the rename questions were answered (or not answered).
function expectRoundtrip(a: Schema, b: Schema, decisions: RenameDecision[] = []) {
  const { changes } = diffSchemas(a, b, decisions);
  expect(canonicalize(applyDiff(a, changes))).toEqual(canonicalize(b));
}

describe("applyDiff — roundtrip apply(diff(A,B), A) equals B", () => {
  const bigA = () =>
    schema(
      table("users", [
        col("id", "unique-id"),
        col("email", "text", { unique: true, maxLength: 255 }),
        col("username", "text", { maxLength: 50 }),
        col("created", "date-time"),
      ], { primaryKey: ["id"] }),
      table("orders", [
        col("id", "whole-number"),
        col("user_id", "unique-id"),
        col("note", "text", { nullable: true }),
      ], {
        primaryKey: ["id"],
        foreignKeys: [
          { column: "user_id", references: { table: "users", column: "id" } },
        ],
      }),
      table("legacy", [col("id", "whole-number")], { primaryKey: ["id"] }),
    );

  const bigB = () =>
    schema(
      table("users", [
        col("id", "unique-id"),
        col("email", "text", { unique: true, maxLength: 255 }),
        col("user_name", "text", { maxLength: 50 }),
        col("created", "date-time"),
        col("bio", "text", { nullable: true }),
      ], { primaryKey: ["id"] }),
      table("orders", [
        col("id", "whole-number"),
        col("user_id", "unique-id"),
        col("note", "text", { nullable: true, maxLength: 500 }),
      ], {
        primaryKey: ["id"],
        foreignKeys: [
          { column: "user_id", references: { table: "users", column: "id" } },
        ],
      }),
      table("invoices", [
        col("id", "whole-number"),
        col("order_id", "whole-number"),
        col("total", "decimal-number"),
        col("issued_at", "date-time"),
      ], {
        primaryKey: ["id"],
        foreignKeys: [
          { column: "order_id", references: { table: "orders", column: "id" } },
        ],
      }),
    );

  it("holds for a schema touched everywhere at once, in both directions", () => {
    expectRoundtrip(bigA(), bigB());
    expectRoundtrip(bigB(), bigA());
  });

  it("holds while a rename question is still unanswered", () => {
    const a = schema(table("users", [col("username")]));
    const b = schema(table("users", [col("login_name")]));
    expect(diffSchemas(a, b).questions).toHaveLength(1);
    expectRoundtrip(a, b);
  });

  it("holds whichever way the rename question is answered", () => {
    const a = schema(table("users", [col("username")]));
    const b = schema(table("users", [col("login_name")]));
    const decision = (rename: boolean): RenameDecision[] => [
      { kind: "column", table: "users", from: "username", to: "login_name", rename },
    ];
    expectRoundtrip(a, b, decision(true));
    expectRoundtrip(a, b, decision(false));
  });

  it("holds for an accepted table rename and for the same pair left pending", () => {
    const users = (name: string) =>
      table(name, [col("id", "unique-id"), col("email")], { primaryKey: ["id"] });
    const a = schema(users("users"));
    const b = schema(users("members"));
    expectRoundtrip(a, b);
    expectRoundtrip(a, b, [
      { kind: "table", from: "users", to: "members", rename: true },
    ]);
  });

  it("holds for a confirmed rename that also changed the column's shape", () => {
    const a = schema(table("users", [col("nickname", "text", { maxLength: 100 })]));
    const b = schema(table("users", [col("nick_name", "text", { maxLength: 200 })]));
    expectRoundtrip(a, b, [
      { kind: "column", table: "users", from: "nickname", to: "nick_name", rename: true },
    ]);
  });

  it("holds between an empty schema and a populated one, both ways", () => {
    const populated = bigB();
    expectRoundtrip({ tables: [] }, populated);
    expectRoundtrip(populated, { tables: [] });
  });
});

describe("applyDiff — rename cascades", () => {
  it("rewrites foreign key references when a table is renamed", () => {
    const start = schema(
      table("users", [col("id", "unique-id")], { primaryKey: ["id"] }),
      table("orders", [col("user_id", "unique-id")], {
        foreignKeys: [
          { column: "user_id", references: { table: "users", column: "id" } },
        ],
      }),
    );
    const result = applyDiff(start, [
      { kind: "table-renamed", from: "users", to: "accounts" },
    ]);
    expect(result.tables[0]!.name).toBe("accounts");
    expect(result.tables[1]!.foreignKeys).toEqual([
      { column: "user_id", references: { table: "accounts", column: "id" } },
    ]);
  });

  it("rewrites the primary key and both sides of foreign keys when columns are renamed", () => {
    const start = schema(
      table("users", [col("id", "unique-id")], { primaryKey: ["id"] }),
      table("orders", [col("user_id", "unique-id")], {
        foreignKeys: [
          { column: "user_id", references: { table: "users", column: "id" } },
        ],
      }),
    );
    const result = applyDiff(start, [
      { kind: "column-renamed", table: "users", from: "id", to: "uuid" },
      { kind: "column-renamed", table: "orders", from: "user_id", to: "customer_id" },
    ]);
    expect(result.tables[0]!.primaryKey).toEqual(["uuid"]);
    expect(result.tables[1]!.foreignKeys).toEqual([
      { column: "customer_id", references: { table: "users", column: "uuid" } },
    ]);
  });

  it("keeps the canonical spelling: dropping the last foreign key removes the list", () => {
    const start = schema(
      table("users", [col("id", "unique-id")], { primaryKey: ["id"] }),
      table("orders", [col("user_id", "unique-id")], {
        foreignKeys: [
          { column: "user_id", references: { table: "users", column: "id" } },
        ],
      }),
    );
    const result = applyDiff(start, [
      {
        kind: "foreign-key-dropped",
        table: "orders",
        foreignKey: {
          column: "user_id",
          references: { table: "users", column: "id" },
        },
      },
    ]);
    expect(result.tables[1]).toEqual(table("orders", [col("user_id", "unique-id")]));
  });
});

describe("applyDiff — misuse and purity", () => {
  const start = () => schema(table("users", [col("id", "unique-id")]));

  it("throws when a change targets something that isn't there", () => {
    expect(() =>
      applyDiff(start(), [{ kind: "table-dropped", name: "ghosts" }]),
    ).toThrow('table "ghosts"');
    expect(() =>
      applyDiff(start(), [
        { kind: "column-dropped", table: "users", name: "ghost" },
      ]),
    ).toThrow('column "users.ghost"');
    expect(() =>
      applyDiff(start(), [
        {
          kind: "foreign-key-dropped",
          table: "users",
          foreignKey: { column: "id", references: { table: "x", column: "y" } },
        },
      ]),
    ).toThrow("foreign key");
  });

  it("throws when a rename or add collides with an existing name", () => {
    expect(() =>
      applyDiff(start(), [
        { kind: "table-added", table: table("users", []) },
      ]),
    ).toThrow("already exists");
    expect(() =>
      applyDiff(
        schema(table("users", [col("a"), col("b")])),
        [{ kind: "column-renamed", table: "users", from: "a", to: "b" }],
      ),
    ).toThrow("that name is taken");
  });

  it("never mutates the schema it was given", () => {
    const input = start();
    const before = JSON.stringify(input);
    applyDiff(input, [
      { kind: "column-added", table: "users", column: col("email") },
      { kind: "table-added", table: table("orders", [col("id", "whole-number")]) },
    ]);
    expect(JSON.stringify(input)).toBe(before);
  });
});
