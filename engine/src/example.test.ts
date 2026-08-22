import { describe, expect, it } from "vitest";
import { EXAMPLE_SCHEMA } from "./example.ts";
import { validateSchema } from "./validate.ts";

describe("example schema", () => {
  it("passes its own validation", () => {
    const result = validateSchema(EXAMPLE_SCHEMA);
    expect(result).toEqual({ ok: true, schema: EXAMPLE_SCHEMA });
  });

  it("survives a JSON round-trip unchanged", () => {
    const revived = JSON.parse(JSON.stringify(EXAMPLE_SCHEMA));
    const result = validateSchema(revived);
    expect(result).toEqual({ ok: true, schema: EXAMPLE_SCHEMA });
  });
});
