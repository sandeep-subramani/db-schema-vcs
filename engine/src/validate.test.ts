import { describe, expect, it } from "vitest";
import {
  COLUMN_TYPE_IDS,
  createEmptySchema,
  findTable,
  validateSchema,
} from "./index.ts";

// A fully-specified valid schema: two tables, composite-free PKs, one
// FK, a length-limited text column. Used as the round-trip baseline.
function validSchema() {
  return {
    tables: [
      {
        name: "users",
        columns: [
          { name: "id", type: "unique-id", nullable: false },
          { name: "email", type: "text", nullable: false, maxLength: 255 },
          { name: "bio", type: "text", nullable: true },
        ],
        primaryKey: ["id"],
      },
      {
        name: "orders",
        columns: [
          { name: "id", type: "unique-id", nullable: false },
          { name: "user_id", type: "unique-id", nullable: false },
          { name: "total", type: "decimal-number", nullable: false },
        ],
        primaryKey: ["id"],
        foreignKeys: [
          { column: "user_id", references: { table: "users", column: "id" } },
        ],
      },
    ],
  };
}

function errorsOf(input: unknown): string[] {
  const result = validateSchema(input);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

describe("validateSchema — accepts", () => {
  it("passes a valid schema and returns it unchanged", () => {
    const input = validSchema();
    const result = validateSchema(input);
    expect(result).toEqual({ ok: true, schema: validSchema() });
  });

  it("passes an empty schema", () => {
    expect(validateSchema({ tables: [] })).toEqual({
      ok: true,
      schema: { tables: [] },
    });
  });

  it("passes a table with no columns yet", () => {
    const result = validateSchema({ tables: [{ name: "draft", columns: [] }] });
    expect(result.ok).toBe(true);
  });

  it("accepts every type in the vocabulary", () => {
    const columns = COLUMN_TYPE_IDS.map((type, i) => ({
      name: `col_${i}`,
      type,
      nullable: false,
    }));
    const result = validateSchema({ tables: [{ name: "kitchen_sink", columns }] });
    expect(result.ok).toBe(true);
  });

  it("supports composite primary keys", () => {
    const result = validateSchema({
      tables: [
        {
          name: "memberships",
          columns: [
            { name: "user_id", type: "unique-id", nullable: false },
            { name: "team_id", type: "unique-id", nullable: false },
          ],
          primaryKey: ["user_id", "team_id"],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a foreign key pointing at a unique non-PK column", () => {
    const result = validateSchema({
      tables: [
        {
          name: "sessions",
          columns: [{ name: "user_email", type: "text", nullable: false }],
          foreignKeys: [
            { column: "user_email", references: { table: "users", column: "email" } },
          ],
        },
        {
          name: "users",
          columns: [
            { name: "id", type: "unique-id", nullable: false },
            { name: "email", type: "text", nullable: false, unique: true },
          ],
          primaryKey: ["id"],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("supports self-referencing foreign keys", () => {
    const result = validateSchema({
      tables: [
        {
          name: "employees",
          columns: [
            { name: "id", type: "unique-id", nullable: false },
            { name: "manager_id", type: "unique-id", nullable: true },
          ],
          primaryKey: ["id"],
          foreignKeys: [
            { column: "manager_id", references: { table: "employees", column: "id" } },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });
});

describe("validateSchema — tolerates missing optional fields", () => {
  it("defaults an absent nullable to false", () => {
    const result = validateSchema({
      tables: [{ name: "t", columns: [{ name: "c", type: "text" }] }],
    });
    expect(result).toEqual({
      ok: true,
      schema: {
        tables: [{ name: "t", columns: [{ name: "c", type: "text", nullable: false }] }],
      },
    });
  });

  it("treats absent primaryKey and foreignKeys as feature-unused", () => {
    const result = validateSchema({
      tables: [{ name: "t", columns: [{ name: "c", type: "date", nullable: true }] }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const table = result.schema.tables[0];
      expect(table?.primaryKey).toBeUndefined();
      expect(table?.foreignKeys).toBeUndefined();
    }
  });

  it("normalizes unique: false to absent, keeps unique: true", () => {
    const result = validateSchema({
      tables: [
        {
          name: "t",
          columns: [
            { name: "a", type: "text", nullable: false, unique: false },
            { name: "b", type: "text", nullable: false, unique: true },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.schema.tables[0]?.columns[0]).toEqual({
        name: "a",
        type: "text",
        nullable: false,
      });
      expect(result.schema.tables[0]?.columns[1]?.unique).toBe(true);
    }
  });

  it("normalizes an empty foreignKeys array to absent", () => {
    const result = validateSchema({
      tables: [
        { name: "t", columns: [{ name: "c", type: "text", nullable: false }], foreignKeys: [] },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.schema.tables[0]?.foreignKeys).toBeUndefined();
    }
  });
});

describe("validateSchema — structural errors", () => {
  it("rejects non-object input", () => {
    expect(errorsOf(null)[0]).toContain("must be an object");
    expect(errorsOf("CREATE TABLE users;")[0]).toContain("must be an object");
    expect(errorsOf([])[0]).toContain("must be an object");
  });

  it("rejects a missing or non-array tables field", () => {
    expect(errorsOf({})[0]).toContain('"tables" array');
    expect(errorsOf({ tables: "users" })[0]).toContain('"tables" array');
  });

  it("rejects unknown fields, naming them", () => {
    const errors = errorsOf({
      tables: [
        {
          name: "t",
          columns: [{ name: "c", type: "text", nullible: true }],
        },
      ],
      version: 2,
    });
    expect(errors).toContainEqual(expect.stringContaining('unknown field "version"'));
    expect(errors).toContainEqual(expect.stringContaining('unknown field "nullible"'));
  });

  it("rejects bad names", () => {
    expect(errorsOf({ tables: [{ name: "", columns: [] }] })[0]).toContain(
      "name can't be empty",
    );
    expect(errorsOf({ tables: [{ name: " users", columns: [] }] })[0]).toContain(
      "leading or trailing spaces",
    );
    expect(errorsOf({ tables: [{ name: 7, columns: [] }] })[0]).toContain(
      '"name" must be a string',
    );
  });

  it("rejects an unknown column type and lists the allowed ones", () => {
    const errors = errorsOf({
      tables: [{ name: "t", columns: [{ name: "c", type: "varchar" }] }],
    });
    expect(errors[0]).toContain('unknown type "varchar"');
    expect(errors[0]).toContain("whole-number");
  });

  it("rejects a non-boolean nullable", () => {
    const errors = errorsOf({
      tables: [{ name: "t", columns: [{ name: "c", type: "text", nullable: "yes" }] }],
    });
    expect(errors[0]).toContain('"nullable" must be true or false');
  });

  it("rejects a non-boolean unique", () => {
    const errors = errorsOf({
      tables: [{ name: "t", columns: [{ name: "c", type: "text", unique: 1 }] }],
    });
    expect(errors[0]).toContain('"unique" must be true or false');
  });

  it("rejects bad maxLength values", () => {
    const bad = (maxLength: unknown) =>
      errorsOf({
        tables: [{ name: "t", columns: [{ name: "c", type: "text", maxLength }] }],
      })[0];
    expect(bad(0)).toContain("whole number between 1 and 1,000,000");
    expect(bad(2.5)).toContain("whole number between 1 and 1,000,000");
    expect(bad("255")).toContain("whole number between 1 and 1,000,000");
  });

  it("rejects maxLength on a non-text column", () => {
    const errors = errorsOf({
      tables: [
        { name: "t", columns: [{ name: "c", type: "whole-number", maxLength: 10 }] },
      ],
    });
    expect(errors[0]).toContain("only applies to text columns");
  });

  it("rejects malformed primaryKey and foreignKeys shapes", () => {
    expect(
      errorsOf({ tables: [{ name: "t", columns: [], primaryKey: "id" }] })[0],
    ).toContain('"primaryKey" must be an array of column names');
    expect(
      errorsOf({ tables: [{ name: "t", columns: [], primaryKey: [] }] })[0],
    ).toContain("at least one column");
    expect(
      errorsOf({ tables: [{ name: "t", columns: [], foreignKeys: [{}] }] }),
    ).toContainEqual(expect.stringContaining('"column" must be the name'));
    expect(
      errorsOf({
        tables: [
          { name: "t", columns: [], foreignKeys: [{ column: "c", references: "users" }] },
        ],
      }),
    ).toContainEqual(expect.stringContaining('"references" must be an object'));
  });

  it("collects every error instead of stopping at the first", () => {
    const errors = errorsOf({
      tables: [
        { name: "", columns: [{ name: "c", type: "varchar" }] },
        { name: "t", columns: "none" },
      ],
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateSchema — semantic errors", () => {
  it("rejects duplicate table names", () => {
    const errors = errorsOf({
      tables: [
        { name: "users", columns: [] },
        { name: "users", columns: [] },
      ],
    });
    expect(errors[0]).toContain('duplicate table name "users"');
  });

  it("rejects duplicate column names within a table", () => {
    const errors = errorsOf({
      tables: [
        {
          name: "t",
          columns: [
            { name: "c", type: "text", nullable: false },
            { name: "c", type: "date", nullable: false },
          ],
        },
      ],
    });
    expect(errors[0]).toContain('duplicate column name "c"');
  });

  it("rejects a primary key naming a missing column, a nullable column, or a column twice", () => {
    const table = (primaryKey: string[], nullable = false) => ({
      tables: [
        {
          name: "t",
          columns: [{ name: "id", type: "unique-id", nullable }],
          primaryKey,
        },
      ],
    });
    expect(errorsOf(table(["nope"]))[0]).toContain(
      'primary key names column "nope", which doesn\'t exist',
    );
    expect(errorsOf(table(["id"], true))[0]).toContain("can't be nullable");
    expect(errorsOf(table(["id", "id"]))[0]).toContain('lists column "id" twice');
  });

  it("rejects a foreign key whose own column is missing", () => {
    const errors = errorsOf({
      tables: [
        {
          name: "t",
          columns: [{ name: "id", type: "unique-id", nullable: false }],
          primaryKey: ["id"],
          foreignKeys: [{ column: "ghost", references: { table: "t", column: "id" } }],
        },
      ],
    });
    expect(errors[0]).toContain('uses column "ghost", which doesn\'t exist');
  });

  it("rejects a foreign key pointing at a missing table or column", () => {
    const base = (references: { table: string; column: string }) => ({
      tables: [
        {
          name: "t",
          columns: [{ name: "ref", type: "unique-id", nullable: false }],
          foreignKeys: [{ column: "ref", references }],
        },
        {
          name: "target",
          columns: [{ name: "id", type: "unique-id", nullable: false }],
          primaryKey: ["id"],
        },
      ],
    });
    expect(errorsOf(base({ table: "nope", column: "id" }))[0]).toContain(
      'points at table "nope", which doesn\'t exist',
    );
    expect(errorsOf(base({ table: "target", column: "nope" }))[0]).toContain(
      'points at column "target.nope", which doesn\'t exist',
    );
  });

  it("rejects a foreign key pointing at a column that isn't unique", () => {
    const errors = errorsOf({
      tables: [
        {
          name: "t",
          columns: [{ name: "ref", type: "text", nullable: false }],
          foreignKeys: [{ column: "ref", references: { table: "target", column: "note" } }],
        },
        {
          name: "target",
          columns: [
            { name: "id", type: "unique-id", nullable: false },
            { name: "note", type: "text", nullable: false },
          ],
          primaryKey: ["id"],
        },
      ],
    });
    expect(errors[0]).toContain(
      'neither a single-column primary key nor marked unique',
    );
  });

  it("rejects a foreign key pointing at one column of a composite primary key", () => {
    const errors = errorsOf({
      tables: [
        {
          name: "t",
          columns: [{ name: "ref", type: "unique-id", nullable: false }],
          foreignKeys: [
            { column: "ref", references: { table: "memberships", column: "user_id" } },
          ],
        },
        {
          name: "memberships",
          columns: [
            { name: "user_id", type: "unique-id", nullable: false },
            { name: "team_id", type: "unique-id", nullable: false },
          ],
          primaryKey: ["user_id", "team_id"],
        },
      ],
    });
    expect(errors[0]).toContain("only part of a composite primary key");
  });

  it("rejects a foreign key whose column type doesn't match its target", () => {
    const errors = errorsOf({
      tables: [
        {
          name: "t",
          columns: [{ name: "ref", type: "whole-number", nullable: false }],
          foreignKeys: [{ column: "ref", references: { table: "target", column: "id" } }],
        },
        {
          name: "target",
          columns: [{ name: "id", type: "unique-id", nullable: false }],
          primaryKey: ["id"],
        },
      ],
    });
    expect(errors[0]).toContain("doesn't match the type");
  });

  it("skips semantic checks while structural errors exist", () => {
    // FK points at a missing table AND a column has a bad type: only
    // the structural error should surface, so messages never describe
    // half-parsed data.
    const errors = errorsOf({
      tables: [
        {
          name: "t",
          columns: [{ name: "ref", type: "varchar" }],
          foreignKeys: [{ column: "ref", references: { table: "nope", column: "id" } }],
        },
      ],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("unknown type");
  });
});

describe("validateSchema — unstorable input", () => {
  // Postgres rejects NUL bytes in text and lone surrogates in jsonb;
  // the validator must catch them so no "valid" schema can 500 a save.
  it("rejects control characters in names", () => {
    const errors = errorsOf({
      tables: [{ name: "a\u0000b", columns: [] }],
    });
    expect(errors[0]).toContain("control characters or broken unicode");
  });

  it("rejects lone surrogate halves in names", () => {
    const errors = errorsOf({
      tables: [
        {
          name: "t",
          columns: [{ name: "a\ud800b", type: "text", nullable: false }],
        },
      ],
    });
    expect(errors[0]).toContain("control characters or broken unicode");
  });

  it("caps name length at 64 characters", () => {
    const errors = errorsOf({
      tables: [{ name: "x".repeat(65), columns: [] }],
    });
    expect(errors[0]).toContain("longer than 64 characters");
  });

  it("caps maxLength at 1,000,000", () => {
    const errors = errorsOf({
      tables: [
        {
          name: "t",
          columns: [
            { name: "c", type: "text", nullable: false, maxLength: 1_000_001 },
          ],
        },
      ],
    });
    expect(errors[0]).toContain("between 1 and 1,000,000");
  });
});

describe("schema helpers", () => {
  it("creates an empty schema", () => {
    expect(createEmptySchema()).toEqual({ tables: [] });
  });

  it("finds a table by name, or undefined when absent", () => {
    const result = validateSchema(validSchema());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(findTable(result.schema, "users")?.name).toBe("users");
      expect(findTable(result.schema, "missing")).toBeUndefined();
    }
  });
});

describe("foreign-key type compatibility (auto-number twins)", () => {
  function fkSchema(sourceType: string, targetType: string) {
    return {
      tables: [
        {
          name: "users",
          columns: [{ name: "id", type: targetType, nullable: false }],
          primaryKey: ["id"],
        },
        {
          name: "orders",
          columns: [{ name: "user_id", type: sourceType, nullable: false }],
          foreignKeys: [
            { column: "user_id", references: { table: "users", column: "id" } },
          ],
        },
      ],
    };
  }

  it("accepts a whole number referencing its auto-number twin, both ways", () => {
    expect(validateSchema(fkSchema("whole-number", "auto-number")).ok).toBe(true);
    expect(validateSchema(fkSchema("auto-number", "whole-number")).ok).toBe(true);
    expect(
      validateSchema(fkSchema("whole-number-large", "auto-number-large")).ok,
    ).toBe(true);
  });

  it("rejects cross-width pairs and unrelated types", () => {
    expect(errorsOf(fkSchema("whole-number-small", "auto-number"))[0]).toContain(
      "auto-number twin",
    );
    expect(errorsOf(fkSchema("auto-number", "auto-number-large"))).toHaveLength(1);
    expect(errorsOf(fkSchema("text", "auto-number"))).toHaveLength(1);
  });
});
