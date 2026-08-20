import { describe, expect, it } from "vitest";
import { createEmptySchema, findTable } from "./index.ts";

describe("engine placeholder", () => {
  it("creates an empty schema", () => {
    expect(createEmptySchema()).toEqual({ tables: [] });
  });

  it("finds a table by name, or undefined when absent", () => {
    const schema = {
      tables: [{ name: "users", columns: [] }],
    };
    expect(findTable(schema, "users")?.name).toBe("users");
    expect(findTable(schema, "orders")).toBeUndefined();
  });
});
