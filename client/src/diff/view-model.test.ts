import { describe, expect, it } from "vitest";
import { diffSchemas, type Schema } from "engine";
import {
  buildDiffCards,
  buildMergeTimeline,
  describePropertyChange,
  formatColumn,
  formatPrimaryKey,
  type TableCard,
} from "./view-model.ts";

// Built on the real engine diff, not hand-written change lists, so a
// change in diff conventions breaks these tests instead of the screen.

const BASE: Schema = {
  tables: [
    {
      name: "users",
      columns: [
        { name: "id", type: "unique-id", nullable: false },
        { name: "email", type: "text", nullable: false, maxLength: 255 },
      ],
      primaryKey: ["id"],
    },
    {
      name: "orders",
      columns: [
        { name: "id", type: "unique-id", nullable: false },
        { name: "user_id", type: "unique-id", nullable: false },
      ],
      primaryKey: ["id"],
      foreignKeys: [
        { column: "user_id", references: { table: "users", column: "id" } },
      ],
    },
  ],
};

describe("buildDiffCards", () => {
  it("groups interior changes under their table; untouched tables land in unchanged", () => {
    const next: Schema = {
      tables: [
        {
          name: "users",
          columns: [
            { name: "id", type: "unique-id", nullable: false },
            { name: "email", type: "text", nullable: false, maxLength: 500 },
            { name: "nickname", type: "text", nullable: true },
          ],
          primaryKey: ["id"],
        },
        BASE.tables[1]!,
      ],
    };
    const { cards, unchanged } = buildDiffCards(BASE, next, diffSchemas(BASE, next));

    expect(unchanged).toEqual(["orders"]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ name: "users", status: "changed" });
    expect(cards[0]!.changes.map((c) => c.kind)).toEqual([
      "column-changed",
      "column-added",
    ]);
  });

  it("added and dropped tables become whole cards, dropped carrying the old definition", () => {
    const next: Schema = {
      tables: [
        BASE.tables[0]!,
        {
          name: "invoices",
          columns: [{ name: "id", type: "unique-id", nullable: false }],
          primaryKey: ["id"],
        },
      ],
    };
    const { cards, unchanged } = buildDiffCards(BASE, next, diffSchemas(BASE, next));

    expect(unchanged).toEqual(["users"]);
    // Survivors/added (in `to` order) sort before dropped tables.
    expect(cards.map((c) => [c.name, c.status])).toEqual([
      ["invoices", "added"],
      ["orders", "dropped"],
    ]);
    expect(cards[0]!.table).toBe(next.tables[1]);
    // The dropped card keeps the from-side definition so it can render whole.
    expect(cards[1]!.table).toBe(BASE.tables[1]);
  });

  it("a confirmed rename is one card under the new name, not a drop plus an add", () => {
    const next: Schema = {
      tables: [
        {
          ...BASE.tables[0]!,
          name: "accounts",
        },
        {
          ...BASE.tables[1]!,
          foreignKeys: [
            { column: "user_id", references: { table: "accounts", column: "id" } },
          ],
        },
      ],
    };
    const diff = diffSchemas(BASE, next, [
      { kind: "table", from: "users", to: "accounts", rename: true },
    ]);
    const { cards, unchanged } = buildDiffCards(BASE, next, diff);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      name: "accounts",
      status: "changed",
      renamedFrom: "users",
      changes: [],
    });
    // The FK followed the rename (decisions.md #17), so orders is untouched.
    expect(unchanged).toEqual(["orders"]);
  });

  it("a pending rename question honestly shows as a dropped and an added card", () => {
    const next: Schema = {
      tables: [
        {
          name: "users",
          columns: [
            { name: "id", type: "unique-id", nullable: false },
            // Same type and shape, names far apart: plausible, so it asks.
            { name: "contact_email", type: "text", nullable: false, maxLength: 255 },
          ],
          primaryKey: ["id"],
        },
        BASE.tables[1]!,
      ],
    };
    const diff = diffSchemas(BASE, next);
    expect(diff.questions).toHaveLength(1);

    const { cards } = buildDiffCards(BASE, next, diff);
    expect(cards[0]!.changes.map((c) => c.kind).sort()).toEqual([
      "column-added",
      "column-dropped",
    ]);
  });
});

describe("display formatting", () => {
  it("formatColumn shows only what's true", () => {
    expect(
      formatColumn({ name: "e", type: "text", nullable: true, maxLength: 120, unique: true }),
    ).toBe("Text (max 120) · unique · nullable");
    expect(formatColumn({ name: "id", type: "unique-id", nullable: false })).toBe(
      "Unique ID",
    );
  });

  it("property changes read as plain language", () => {
    expect(
      describePropertyChange({ property: "type", from: "text", to: "whole-number" }),
    ).toBe("Type: Text → Whole number");
    expect(
      describePropertyChange({ property: "nullable", from: true, to: false }),
    ).toBe("Now required");
    expect(
      describePropertyChange({ property: "unique", from: false, to: true }),
    ).toBe("Now unique");
    expect(
      describePropertyChange({ property: "maxLength", from: 255, to: undefined }),
    ).toBe("Max length: 255 → none");
  });

  it("primary keys format as none, a name, or a parenthesized list", () => {
    expect(formatPrimaryKey(undefined)).toBe("none");
    expect(formatPrimaryKey(["id"])).toBe("id");
    expect(formatPrimaryKey(["id", "tenant_id"])).toBe("(id, tenant_id)");
  });
});

describe("buildMergeTimeline", () => {
  const card = (name: string, status: TableCard["status"] = "changed"): TableCard => ({
    name,
    status,
    changes: [],
  });

  it("puts the same table on one rung and keeps singles on their own side", () => {
    const rows = buildMergeTimeline(
      [card("users"), card("reviews", "added")],
      [card("users"), card("invoices", "added")],
      [],
    );
    expect(rows.map((r) => r.name)).toEqual(["users", "reviews", "invoices"]);
    const [users, reviews, invoices] = rows;
    expect(users!.ours?.name).toBe("users");
    expect(users!.theirs?.name).toBe("users");
    expect(reviews!.theirs).toBeNull();
    expect(invoices!.ours).toBeNull();
  });

  it("walks both card lists in step, ours first at each index", () => {
    // The interleave is what makes each side's own diff order survive:
    // coupons is ours[2], so it lands after theirs[1] = invoices.
    const rows = buildMergeTimeline(
      [card("users"), card("reviews", "added"), card("coupons", "dropped")],
      [card("users"), card("invoices", "added")],
      [],
    );
    expect(rows.map((r) => r.name)).toEqual([
      "users",
      "reviews",
      "invoices",
      "coupons",
    ]);
  });

  it("flags a table a conflict touches, from either side of the group", () => {
    const rows = buildMergeTimeline(
      [card("users"), card("orders")],
      [card("users"), card("orders")],
      [
        {
          id: "c1",
          ours: [
            { kind: "column-changed", table: "users", column: "email", changes: [] },
          ],
          theirs: [{ kind: "table-dropped", name: "orders" }],
        },
      ],
    );
    expect(rows.filter((r) => r.conflictIds.length > 0).map((r) => r.name)).toEqual([
      "users",
      "orders",
    ]);
    expect(rows[0]!.conflictIds).toEqual(["c1"]);
  });

  it("lists every conflict touching one table, without repeats", () => {
    const rows = buildMergeTimeline(
      [card("users")],
      [card("users")],
      [
        {
          id: "c1",
          ours: [
            { kind: "column-changed", table: "users", column: "email", changes: [] },
          ],
          theirs: [{ kind: "column-dropped", table: "users", name: "email" }],
        },
        {
          id: "c2",
          ours: [{ kind: "primary-key-changed", table: "users", from: ["id"], to: [] }],
          theirs: [],
        },
      ],
    );
    expect(rows[0]!.conflictIds).toEqual(["c1", "c2"]);
  });

  it("flags both ends of a renamed table, since either can key the card", () => {
    const rows = buildMergeTimeline(
      [card("people")],
      [card("customers")],
      [
        {
          id: "c1",
          ours: [{ kind: "table-renamed", from: "customers", to: "people" }],
          theirs: [],
        },
      ],
    );
    expect(rows.every((r) => r.conflictIds.length > 0)).toBe(true);
  });

  it("leaves untouched tables out entirely", () => {
    expect(buildMergeTimeline([], [], [])).toEqual([]);
  });
});
