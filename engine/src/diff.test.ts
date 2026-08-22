import { describe, expect, it } from "vitest";
import { diffSchemas } from "./index.ts";
import type { Column, ColumnType, Schema, Table } from "./index.ts";

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

const empty = { changes: [], questions: [] };

describe("diffSchemas — plain changes", () => {
  it("finds nothing between identical schemas", () => {
    const a = schema(
      table("users", [col("id", "unique-id"), col("email")], {
        primaryKey: ["id"],
      }),
    );
    expect(diffSchemas(a, a)).toEqual(empty);
  });

  it("reports added and dropped tables", () => {
    const orders = table("orders", [
      col("id", "whole-number"),
      col("total", "decimal-number"),
      col("placed_at", "date-time"),
    ]);
    const users = table("users", [col("id", "unique-id")]);
    const a = schema(users);
    const b = schema(users, orders);
    expect(diffSchemas(a, b)).toEqual({
      changes: [{ kind: "table-added", table: orders }],
      questions: [],
    });
    expect(diffSchemas(b, a)).toEqual({
      changes: [{ kind: "table-dropped", name: "orders" }],
      questions: [],
    });
  });

  it("reports column property changes with before and after values", () => {
    const a = schema(
      table("users", [
        col("bio", "text", { nullable: true }),
        col("age", "whole-number"),
        col("email", "text", { unique: true }),
      ]),
    );
    const b = schema(
      table("users", [
        col("bio", "text", { maxLength: 500 }),
        col("age", "whole-number-large"),
        col("email", "text"),
      ]),
    );
    expect(diffSchemas(a, b)).toEqual({
      changes: [
        {
          kind: "column-changed",
          table: "users",
          column: "bio",
          changes: [
            { property: "nullable", from: true, to: false },
            { property: "maxLength", from: undefined, to: 500 },
          ],
        },
        {
          kind: "column-changed",
          table: "users",
          column: "age",
          changes: [
            { property: "type", from: "whole-number", to: "whole-number-large" },
          ],
        },
        {
          kind: "column-changed",
          table: "users",
          column: "email",
          changes: [{ property: "unique", from: true, to: false }],
        },
      ],
      questions: [],
    });
  });

  it("reports primary key and foreign key changes", () => {
    const a = schema(
      table("orders", [
        col("id", "whole-number"),
        col("user_id", "unique-id"),
      ], {
        primaryKey: ["id"],
        foreignKeys: [
          { column: "user_id", references: { table: "users", column: "id" } },
        ],
      }),
      table("users", [col("id", "unique-id")], { primaryKey: ["id"] }),
    );
    const b = schema(
      table("orders", [
        col("id", "whole-number"),
        col("user_id", "unique-id"),
      ], {
        primaryKey: ["id", "user_id"],
      }),
      table("users", [col("id", "unique-id")], { primaryKey: ["id"] }),
    );
    expect(diffSchemas(a, b)).toEqual({
      changes: [
        {
          kind: "primary-key-changed",
          table: "orders",
          from: ["id"],
          to: ["id", "user_id"],
        },
        {
          kind: "foreign-key-dropped",
          table: "orders",
          foreignKey: {
            column: "user_id",
            references: { table: "users", column: "id" },
          },
        },
      ],
      questions: [],
    });
  });

  it("ignores column order — reordering is not a change", () => {
    const a = schema(table("users", [col("id", "unique-id"), col("email")]));
    const b = schema(table("users", [col("email"), col("id", "unique-id")]));
    expect(diffSchemas(a, b)).toEqual(empty);
  });
});

describe("diffSchemas — column renames", () => {
  const before = (name: string, extra: Partial<Column> = {}) =>
    schema(table("users", [col("id", "unique-id"), col(name, "text", extra)]));

  it("auto-detects a rename when type and shape match and names are similar", () => {
    expect(diffSchemas(before("username"), before("user_name"))).toEqual({
      changes: [
        { kind: "column-renamed", table: "users", from: "username", to: "user_name" },
      ],
      questions: [],
    });
  });

  it("asks about a same-type pair with a less similar name", () => {
    const result = diffSchemas(before("username"), before("login_name"));
    expect(result.questions).toEqual([
      {
        kind: "column",
        table: "users",
        from: "username",
        to: "login_name",
        confidence: expect.any(Number),
      },
    ]);
    // Unanswered, the diff stays an honest drop+add.
    expect(result.changes).toEqual([
      { kind: "column-dropped", table: "users", name: "username" },
      { kind: "column-added", table: "users", column: col("login_name") },
    ]);
  });

  it("turns an accepted question into a rename and a rejected one into drop+add", () => {
    const a = before("username");
    const b = before("login_name");
    const decision = (rename: boolean) => [
      { kind: "column" as const, table: "users", from: "username", to: "login_name", rename },
    ];
    expect(diffSchemas(a, b, decision(true))).toEqual({
      changes: [
        { kind: "column-renamed", table: "users", from: "username", to: "login_name" },
      ],
      questions: [],
    });
    expect(diffSchemas(a, b, decision(false))).toEqual({
      changes: [
        { kind: "column-dropped", table: "users", name: "username" },
        { kind: "column-added", table: "users", column: col("login_name") },
      ],
      questions: [],
    });
  });

  it("lets a decision overrule an auto-detected rename", () => {
    const result = diffSchemas(before("username"), before("user_name"), [
      { kind: "column", table: "users", from: "username", to: "user_name", rename: false },
    ]);
    expect(result).toEqual({
      changes: [
        { kind: "column-dropped", table: "users", name: "username" },
        { kind: "column-added", table: "users", column: col("user_name") },
      ],
      questions: [],
    });
  });

  it("emits rename plus property changes when a confirmed rename also changed shape", () => {
    const a = before("nickname", { maxLength: 100 });
    const b = before("nick_name", { maxLength: 200 });
    // Shape changed too, so this is a question, not an auto-match.
    expect(diffSchemas(a, b).questions).toHaveLength(1);
    expect(diffSchemas(a, b, [
      { kind: "column", table: "users", from: "nickname", to: "nick_name", rename: true },
    ]).changes).toEqual([
      { kind: "column-renamed", table: "users", from: "nickname", to: "nick_name" },
      {
        kind: "column-changed",
        table: "users",
        column: "nick_name",
        changes: [{ property: "maxLength", from: 100, to: 200 }],
      },
    ]);
  });

  it("keeps a shape mismatch out of the questions when names share nothing", () => {
    const a = before("email", { maxLength: 255 });
    const b = before("phone");
    expect(diffSchemas(a, b)).toEqual({
      changes: [
        { kind: "column-dropped", table: "users", name: "email" },
        { kind: "column-added", table: "users", column: col("phone") },
      ],
      questions: [],
    });
  });

  it("pairs greedily by best score when several candidates exist", () => {
    const a = schema(
      table("events", [col("created", "date-time"), col("updated", "date-time")]),
    );
    const b = schema(
      table("events", [col("created_at", "date-time"), col("updated_at", "date-time")]),
    );
    expect(diffSchemas(a, b).changes).toEqual([
      { kind: "column-renamed", table: "events", from: "created", to: "created_at" },
      { kind: "column-renamed", table: "events", from: "updated", to: "updated_at" },
    ]);
  });

  it("asks about the best candidate only and leaves the rest as plain adds", () => {
    const a = schema(table("users", [col("id", "unique-id"), col("email")]));
    const b = schema(
      table("users", [col("id", "unique-id"), col("email_address"), col("phone")]),
    );
    const result = diffSchemas(a, b);
    expect(result.questions).toEqual([
      {
        kind: "column",
        table: "users",
        from: "email",
        to: "email_address",
        confidence: expect.any(Number),
      },
    ]);
    expect(result.changes).toContainEqual({
      kind: "column-added",
      table: "users",
      column: col("phone"),
    });
  });

  it("never matches renames across tables", () => {
    const a = schema(
      table("users", [col("id", "unique-id"), col("email")]),
      table("orders", [col("id", "whole-number")]),
    );
    const b = schema(
      table("users", [col("id", "unique-id")]),
      table("orders", [col("id", "whole-number"), col("email")]),
    );
    expect(diffSchemas(a, b)).toEqual({
      changes: [
        { kind: "column-dropped", table: "users", name: "email" },
        { kind: "column-added", table: "orders", column: col("email") },
      ],
      questions: [],
    });
  });

  it("detects the mirrored rename when the schemas swap sides", () => {
    const a = before("username");
    const b = before("user_name");
    expect(diffSchemas(b, a).changes).toEqual([
      { kind: "column-renamed", table: "users", from: "user_name", to: "username" },
    ]);
  });

  it("ignores a stale decision that names columns that no longer exist", () => {
    const a = before("username");
    expect(
      diffSchemas(a, a, [
        { kind: "column", table: "users", from: "ghost", to: "nope", rename: true },
      ]),
    ).toEqual(empty);
  });
});

describe("diffSchemas — table renames", () => {
  const users = (name: string) =>
    table(name, [
      col("id", "unique-id"),
      col("email", "text", { unique: true, maxLength: 255 }),
    ], { primaryKey: ["id"] });

  it("auto-detects a rename when columns are identical and names are similar", () => {
    const a = schema(users("users"));
    const b = schema(users("app_users"));
    expect(diffSchemas(a, b)).toEqual({
      changes: [{ kind: "table-renamed", from: "users", to: "app_users" }],
      questions: [],
    });
  });

  it("asks when columns are identical but names share nothing", () => {
    const a = schema(users("users"));
    const b = schema(users("members"));
    const result = diffSchemas(a, b);
    expect(result.questions).toEqual([
      { kind: "table", from: "users", to: "members", confidence: expect.any(Number) },
    ]);
    expect(result.changes).toEqual([
      { kind: "table-dropped", name: "users" },
      { kind: "table-added", table: users("members") },
    ]);
  });

  it("diffs the inside of an accepted table rename", () => {
    const a = schema(users("users"));
    const renamed = users("members");
    renamed.columns.push(col("joined_at", "date-time"));
    const b = schema(renamed);
    expect(
      diffSchemas(a, b, [{ kind: "table", from: "users", to: "members", rename: true }]),
    ).toEqual({
      changes: [
        { kind: "table-renamed", from: "users", to: "members" },
        { kind: "column-added", table: "members", column: col("joined_at", "date-time") },
      ],
      questions: [],
    });
  });

  it("sees foreign keys through a renamed table instead of reporting FK churn", () => {
    const orders = (userTable: string) =>
      table("orders", [
        col("id", "whole-number"),
        col("user_id", "unique-id"),
      ], {
        primaryKey: ["id"],
        foreignKeys: [
          { column: "user_id", references: { table: userTable, column: "id" } },
        ],
      });
    const a = schema(users("users"), orders("users"));
    const b = schema(users("app_users"), orders("app_users"));
    expect(diffSchemas(a, b)).toEqual({
      changes: [{ kind: "table-renamed", from: "users", to: "app_users" }],
      questions: [],
    });
  });

  it("sees primary and foreign keys through a renamed column", () => {
    const a = schema(
      table("customers", [col("customer_id", "unique-id")], {
        primaryKey: ["customer_id"],
      }),
      table("orders", [col("customer_ref", "unique-id")], {
        foreignKeys: [
          { column: "customer_ref", references: { table: "customers", column: "customer_id" } },
        ],
      }),
    );
    const b = schema(
      table("customers", [col("customer_uuid", "unique-id")], {
        primaryKey: ["customer_uuid"],
      }),
      table("orders", [col("customer_ref", "unique-id")], {
        foreignKeys: [
          { column: "customer_ref", references: { table: "customers", column: "customer_uuid" } },
        ],
      }),
    );
    expect(diffSchemas(a, b)).toEqual({
      changes: [
        {
          kind: "column-renamed",
          table: "customers",
          from: "customer_id",
          to: "customer_uuid",
        },
      ],
      questions: [],
    });
  });
});
