import { describe, expect, it } from "vitest";
import {
  EXAMPLE_SCHEMA,
  findColumn,
  findTable,
  validateSchema,
  type Schema,
} from "engine";
import {
  addColumn,
  addForeignKey,
  addTable,
  columnNameProblem,
  deleteColumn,
  deleteTable,
  removeForeignKey,
  renameColumn,
  renameTable,
  setColumnMaxLength,
  setColumnNullable,
  setColumnType,
  setColumnUnique,
  setPrimaryKeyMembership,
  tableNameProblem,
  validFkTargets,
  type EditResult,
} from "./edits.ts";

/** Every edit must hand back a schema the engine validator accepts. */
function valid(result: EditResult): Schema {
  const check = validateSchema(result.schema);
  expect(check).toEqual({ ok: true, schema: result.schema });
  return result.schema;
}

const schema = EXAMPLE_SCHEMA;

describe("name checks", () => {
  it("rejects empty, padded, and duplicate table names", () => {
    expect(tableNameProblem(schema, "")).toMatch(/empty/);
    expect(tableNameProblem(schema, " users ")).toMatch(/space/);
    expect(tableNameProblem(schema, "users")).toMatch(/already exists/);
    expect(tableNameProblem(schema, "users", "users")).toBeNull();
    expect(tableNameProblem(schema, "invoices")).toBeNull();
  });

  it("rejects duplicate column names within a table", () => {
    const users = findTable(schema, "users")!;
    expect(columnNameProblem(users, "email")).toMatch(/already exists/);
    expect(columnNameProblem(users, "email", "email")).toBeNull();
    expect(columnNameProblem(users, "phone")).toBeNull();
  });
});

describe("table edits", () => {
  it("adds an empty table", () => {
    const next = valid(addTable(schema, "invoices"));
    expect(findTable(next, "invoices")).toEqual({ name: "invoices", columns: [] });
  });

  it("renaming a table updates foreign keys that point at it", () => {
    const result = renameTable(schema, "users", "people");
    expect(result.collateral).toEqual([]);
    const next = valid(result);
    const orders = findTable(next, "orders")!;
    expect(orders.foreignKeys).toEqual([
      { column: "user_id", references: { table: "people", column: "id" } },
    ]);
  });

  it("deleting a table removes foreign keys pointing at it, and says so", () => {
    const result = deleteTable(schema, "users");
    expect(result.collateral).toEqual([
      "foreign key orders.user_id → users.id (the table it points at no longer exists)",
    ]);
    const next = valid(result);
    expect(findTable(next, "users")).toBeUndefined();
    expect(findTable(next, "orders")!.foreignKeys).toBeUndefined();
  });

  it("deleting a table nothing references has no collateral", () => {
    const result = deleteTable(schema, "order_items");
    expect(result.collateral).toEqual([]);
    valid(result);
  });
});

describe("column edits", () => {
  it("adds a column with defaults (not nullable, no extras)", () => {
    const next = valid(addColumn(schema, "users", "phone", "text"));
    expect(findColumn(findTable(next, "users")!, "phone")).toEqual({
      name: "phone",
      type: "text",
      nullable: false,
    });
  });

  it("renaming a column follows into the PK, own FKs, and inbound FKs", () => {
    const next = valid(renameColumn(schema, "users", "id", "user_uuid"));
    const users = findTable(next, "users")!;
    expect(users.primaryKey).toEqual(["user_uuid"]);
    expect(findTable(next, "orders")!.foreignKeys).toEqual([
      { column: "user_id", references: { table: "users", column: "user_uuid" } },
    ]);
  });

  it("renaming a column that owns a foreign key updates that FK's column", () => {
    const next = valid(renameColumn(schema, "orders", "user_id", "buyer_id"));
    expect(findTable(next, "orders")!.foreignKeys).toEqual([
      { column: "buyer_id", references: { table: "users", column: "id" } },
    ]);
  });

  it("deleting an FK-targeted PK column reports both losses", () => {
    const result = deleteColumn(schema, "users", "id");
    expect(result.collateral).toEqual([
      'its place in the primary key of "users"',
      "foreign key orders.user_id → users.id (the column it points at no longer exists)",
    ]);
    const next = valid(result);
    expect(findTable(next, "users")!.primaryKey).toBeUndefined();
  });

  it("deleting a column that owns an FK removes that FK", () => {
    const result = deleteColumn(schema, "orders", "user_id");
    expect(result.collateral).toEqual([
      "foreign key orders.user_id → users.id (its own column no longer exists)",
    ]);
    valid(result);
  });

  it("retyping an FK column removes the now-mismatched FK", () => {
    const result = setColumnType(schema, "orders", "user_id", "text");
    expect(result.collateral).toEqual([
      "foreign key orders.user_id → users.id (the column types no longer match)",
    ]);
    valid(result);
  });

  it("retyping a text column away from text drops its length limit, and says so", () => {
    const result = setColumnType(schema, "users", "display_name", "whole-number");
    expect(result.collateral).toEqual([
      'the length limit on "users.display_name" (only text columns have one)',
    ]);
    const next = valid(result);
    expect(findColumn(findTable(next, "users")!, "display_name")).toEqual({
      name: "display_name",
      type: "whole-number",
      nullable: false,
    });
  });

  it("refuses to make a primary-key column nullable", () => {
    const result = setColumnNullable(schema, "users", "id", true);
    expect(result.schema).toBe(schema);
  });

  it("sets and clears the text length limit", () => {
    const withLimit = valid(setColumnMaxLength(schema, "orders", "note", 500));
    expect(findColumn(findTable(withLimit, "orders")!, "note")!.maxLength).toBe(500);
    const cleared = valid(setColumnMaxLength(withLimit, "orders", "note", undefined));
    expect(findColumn(findTable(cleared, "orders")!, "note")!.maxLength).toBeUndefined();
  });
});

describe("unique edits", () => {
  it("stores unique only as true — false becomes absent", () => {
    const on = valid(setColumnUnique(schema, "orders", "note", true));
    expect(findColumn(findTable(on, "orders")!, "note")!.unique).toBe(true);
    const off = valid(setColumnUnique(on, "orders", "note", false));
    expect(findColumn(findTable(off, "orders")!, "note")!.unique).toBeUndefined();
  });

  it("removing unique from an FK target removes the dependent FK, and says so", () => {
    // Point a new column at users.email (unique), then un-unique email.
    const withCol = addColumn(schema, "orders", "user_email", "text").schema;
    const withFk = valid(
      addForeignKey(withCol, "orders", {
        column: "user_email",
        references: { table: "users", column: "email" },
      }),
    );
    const result = setColumnUnique(withFk, "users", "email", false);
    expect(result.collateral).toEqual([
      "foreign key orders.user_email → users.email (the column it points at is no longer unique)",
    ]);
    valid(result);
  });
});

describe("primary key edits", () => {
  it("growing a sole PK to composite breaks FKs aimed at the old sole column", () => {
    const result = setPrimaryKeyMembership(schema, "orders", "placed_at", true);
    expect(findTable(result.schema, "orders")!.primaryKey).toEqual([
      "id",
      "placed_at",
    ]);
    expect(result.collateral).toEqual([
      "foreign key order_items.order_id → orders.id (the column it points at is no longer unique)",
    ]);
    valid(result);
  });

  it("removing the last PK column leaves the table with no primary key", () => {
    const result = setPrimaryKeyMembership(schema, "products", "id", false);
    const next = valid(result);
    expect(findTable(next, "products")!.primaryKey).toBeUndefined();
    // order_items.product_id FK dies with the uniqueness.
    expect(result.collateral).toHaveLength(1);
  });

  it("refuses to put a nullable column into the primary key", () => {
    const result = setPrimaryKeyMembership(schema, "orders", "note", true);
    expect(result.schema).toBe(schema);
  });
});

describe("foreign key edits", () => {
  it("adds and removes a foreign key", () => {
    const withCol = addColumn(schema, "products", "creator", "unique-id").schema;
    const added = valid(
      addForeignKey(withCol, "products", {
        column: "creator",
        references: { table: "users", column: "id" },
      }),
    );
    expect(findTable(added, "products")!.foreignKeys).toHaveLength(1);
    const removed = valid(removeForeignKey(added, "products", 0));
    expect(findTable(removed, "products")!.foreignKeys).toBeUndefined();
  });

  it("offers only unique-on-their-own columns of matching type as targets", () => {
    expect(validFkTargets(schema, "unique-id")).toEqual([
      { table: "users", column: "id" },
    ]);
    // Text targets: users.email and products.sku are unique; other text
    // columns (display_name, name, note) are not.
    expect(validFkTargets(schema, "text")).toEqual([
      { table: "users", column: "email" },
      { table: "products", column: "sku" },
    ]);
    // A column of a composite PK is never a target: order_items has none.
    expect(
      validFkTargets(schema, "whole-number-small").filter(
        (t) => t.table === "order_items",
      ),
    ).toEqual([]);
  });
});
