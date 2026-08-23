import { describe, expect, it } from "vitest";
import { importPostgresSql, type SqlImportResult } from "./index.ts";
import type { Schema, Table } from "./index.ts";

function importOk(sql: string): {
  schema: Schema;
  issues: { kind: string; what: string; why: string }[];
  tableCount: number;
  columnCount: number;
} {
  const result: SqlImportResult = importPostgresSql(sql);
  if (!result.ok) {
    throw new Error(`import failed: ${result.errors.join(" | ")}`);
  }
  return result;
}

function table(schema: Schema, name: string): Table {
  const found = schema.tables.find((t) => t.name === name);
  if (!found) throw new Error(`no table "${name}" in result`);
  return found;
}

describe("importPostgresSql — hand-written DDL", () => {
  it("reads columns, types, nullability, keys and lengths inline", () => {
    const { schema, issues } = importOk(`
      CREATE TABLE users (
        id serial PRIMARY KEY,
        email varchar(255) UNIQUE NOT NULL,
        bio text,
        active boolean NOT NULL,
        joined_on date
      );
    `);
    expect(issues).toEqual([]);
    expect(table(schema, "users")).toEqual({
      name: "users",
      columns: [
        { name: "id", type: "auto-number", nullable: false },
        { name: "email", type: "text", nullable: false, unique: true, maxLength: 255 },
        { name: "bio", type: "text", nullable: true },
        { name: "active", type: "true-false", nullable: false },
        { name: "joined_on", type: "date", nullable: true },
      ],
      primaryKey: ["id"],
    });
  });

  it("maps the whole audited type table", () => {
    const { schema } = importOk(`
      CREATE TABLE t (
        a smallint, b integer, c bigint,
        d smallserial, e serial, f bigserial,
        g numeric(10,2), h double precision,
        i varchar(30), j text,
        k boolean, l date, m time, n time with time zone,
        o timestamp, p timestamptz,
        q uuid, r bytea
      );
    `);
    const types = table(schema, "t").columns.map((c) => [c.name, c.type]);
    expect(types).toEqual([
      ["a", "whole-number-small"],
      ["b", "whole-number"],
      ["c", "whole-number-large"],
      ["d", "auto-number-small"],
      ["e", "auto-number"],
      ["f", "auto-number-large"],
      ["g", "decimal-number"],
      ["h", "floating-point"],
      ["i", "text"],
      ["j", "text"],
      ["k", "true-false"],
      ["l", "date"],
      ["m", "time"],
      ["n", "time-tz"],
      ["o", "date-time"],
      ["p", "date-time-tz"],
      ["q", "unique-id"],
      ["r", "binary-data"],
    ]);
  });

  it("skips columns whose types have no home, keeps the table", () => {
    const { schema, issues } = importOk(`
      CREATE TABLE t (
        id integer PRIMARY KEY,
        blob json,
        blob2 jsonb,
        tags text[],
        ratio real,
        "近似" float(10),
        padded char(8),
        span interval,
        mood_col mood
      );
    `);
    expect(table(schema, "t").columns.map((c) => c.name)).toEqual(["id"]);
    const skipped = issues.filter((i) => i.kind === "skipped-column");
    expect(skipped.map((i) => i.what)).toEqual([
      "t.blob",
      "t.blob2",
      "t.tags",
      "t.ratio",
      "t.近似",
      "t.padded",
      "t.span",
      "t.mood_col",
    ]);
    expect(skipped.find((i) => i.what === "t.mood_col")?.why).toContain('"mood"');
  });

  it("handles composite PKs, forcing their columns NOT NULL", () => {
    const { schema } = importOk(
      "CREATE TABLE m (a integer, b integer, note text, PRIMARY KEY (a, b));",
    );
    const t = table(schema, "m");
    expect(t.primaryKey).toEqual(["a", "b"]);
    expect(t.columns.filter((c) => !c.nullable).map((c) => c.name)).toEqual([
      "a",
      "b",
    ]);
  });

  it("drops a PK that includes a skipped column, and says so", () => {
    const { schema, issues } = importOk(
      "CREATE TABLE t (a integer, b jsonb, PRIMARY KEY (a, b));",
    );
    expect(table(schema, "t").primaryKey).toBeUndefined();
    expect(
      issues.some(
        (i) => i.kind === "skipped-constraint" && i.why.includes("skipped column"),
      ),
    ).toBe(true);
  });

  it("applies single-column table-level UNIQUE, skips composite UNIQUE", () => {
    const { schema, issues } = importOk(
      "CREATE TABLE t (a text, b text, c text, UNIQUE (a), UNIQUE (b, c));",
    );
    const cols = table(schema, "t").columns;
    expect(cols.find((c) => c.name === "a")?.unique).toBe(true);
    expect(cols.find((c) => c.name === "b")?.unique).toBeUndefined();
    expect(
      issues.some(
        (i) => i.what === "t: UNIQUE (b, c)" && i.why.includes("multi-column"),
      ),
    ).toBe(true);
  });

  it("resolves FKs across statement order, both inline and table-level", () => {
    const { schema, issues } = importOk(`
      CREATE TABLE orders (
        id serial PRIMARY KEY,
        user_id integer REFERENCES users(id),
        coupon_id integer,
        FOREIGN KEY (coupon_id) REFERENCES coupons(code_id)
      );
      CREATE TABLE users (id serial PRIMARY KEY);
      CREATE TABLE coupons (code_id integer PRIMARY KEY);
      CREATE TABLE tree (id integer PRIMARY KEY, parent_id integer REFERENCES tree(id));
    `);
    expect(issues).toEqual([]);
    expect(table(schema, "orders").foreignKeys).toEqual([
      { column: "user_id", references: { table: "users", column: "id" } },
      { column: "coupon_id", references: { table: "coupons", column: "code_id" } },
    ]);
    expect(table(schema, "tree").foreignKeys).toEqual([
      { column: "parent_id", references: { table: "tree", column: "id" } },
    ]);
  });

  it("drops unrepresentable FKs with a reason each", () => {
    const { schema, issues } = importOk(`
      CREATE TABLE a (
        id integer PRIMARY KEY,
        gone integer REFERENCES missing(id),
        wide smallint REFERENCES a(id),
        loose integer REFERENCES b(plain)
      );
      CREATE TABLE b (plain integer);
    `);
    expect(table(schema, "a").foreignKeys).toBeUndefined();
    const whys = issues
      .filter((i) => i.kind === "skipped-constraint")
      .map((i) => i.why.slice(0, 30));
    expect(whys).toHaveLength(3);
    expect(issues.map((i) => i.what)).toEqual(
      expect.arrayContaining([
        'a: foreign key on "gone"',
        'a: foreign key on "wide"',
        'a: foreign key on "loose"',
      ]),
    );
  });

  it("keeps quoted mixed-case names and prefixes non-public schemas", () => {
    const { schema } = importOk(`
      CREATE TABLE "Users" ("userId" integer PRIMARY KEY);
      CREATE TABLE audit.log (id integer);
      CREATE TABLE public.plain (id integer);
    `);
    expect(schema.tables.map((t) => t.name)).toEqual([
      "Users",
      "audit.log",
      "plain",
    ]);
    expect(table(schema, "Users").columns[0]?.name).toBe("userId");
  });

  it("keeps the first definition when a table is defined twice", () => {
    const { schema, issues } = importOk(
      "CREATE TABLE t (a integer); CREATE TABLE t (b integer);",
    );
    expect(table(schema, "t").columns.map((c) => c.name)).toEqual(["a"]);
    expect(
      issues.some((i) => i.why.includes("defined twice")),
    ).toBe(true);
  });

  it("imports GENERATED ... AS IDENTITY as a NOT NULL auto number", () => {
    const { schema } = importOk(
      "CREATE TABLE t (id bigint GENERATED ALWAYS AS IDENTITY, note text);",
    );
    expect(table(schema, "t").columns[0]).toEqual({
      name: "id",
      type: "auto-number-large",
      nullable: false,
    });
  });

  it("notes dropped defaults and checks instead of failing", () => {
    const { issues } = importOk(`
      CREATE TABLE t (
        status text DEFAULT 'new',
        age integer CHECK (age >= 0),
        made timestamp DEFAULT now()
      );
    `);
    const notes = issues.filter((i) => i.kind === "dropped-detail");
    expect(
      notes.find((i) => i.why.includes("default values"))?.what,
    ).toBe("t: status, made");
    expect(
      notes.some((i) => i.why.includes("check constraints")),
    ).toBe(true);
  });
});

describe("importPostgresSql — statement policy", () => {
  it("skip-lists unreadable statements and imports the rest", () => {
    const { schema, issues } = importOk(`
      CREATE TABLE t (id integer PRIMARY KEY);
      CREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f();
      GRANT SELECT ON t TO nobody;
      \\connect other
    `);
    expect(schema.tables).toHaveLength(1);
    const whys = issues.map((i) => i.why);
    expect(whys.some((w) => w.includes("triggers and functions"))).toBe(true);
    expect(whys.some((w) => w.includes("permissions"))).toBe(true);
    expect(whys.some((w) => w.includes("psql client command"))).toBe(true);
  });

  it("explains ALTERs it does not consume, and ALTERs on unknown tables", () => {
    const { schema, issues } = importOk(`
      CREATE TABLE t (a integer, b integer);
      ALTER TABLE t DROP COLUMN b;
      ALTER TABLE ghost ADD COLUMN x integer;
    `);
    expect(table(schema, "t").columns).toHaveLength(2);
    expect(
      issues.some((i) => i.why.includes("only ADD COLUMN, ADD CONSTRAINT")),
    ).toBe(true);
    expect(
      issues.some((i) => i.why.includes('"ghost", which isn\'t defined')),
    ).toBe(true);
  });

  it("consumes ALTER TABLE ADD COLUMN including its inline features", () => {
    const { schema } = importOk(`
      CREATE TABLE t (id integer PRIMARY KEY);
      ALTER TABLE t ADD COLUMN email varchar(100) UNIQUE NOT NULL;
    `);
    expect(table(schema, "t").columns[1]).toEqual({
      name: "email",
      type: "text",
      nullable: false,
      unique: true,
      maxLength: 100,
    });
  });

  it("gives a targeted hint for REFERENCES without a target column", () => {
    const { schema, issues } = importOk(
      "CREATE TABLE o (id integer PRIMARY KEY, user_id integer REFERENCES users);",
    );
    // Postgres would infer the PK; the parser can't read the form, so
    // the whole statement is skipped — with advice, not a shrug.
    expect(schema.tables).toEqual([]);
    expect(issues[0]?.why).toContain("REFERENCES table(column)");
  });

  it("returns an empty schema for empty or comment-only input", () => {
    const result = importOk("-- nothing here\n\n");
    expect(result.schema.tables).toEqual([]);
    expect(result.tableCount).toBe(0);
  });
});

describe("importPostgresSql — a realistic pg_dump", () => {
  const DUMP = `
--
-- PostgreSQL database dump
--

SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    display_name text,
    is_admin boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    settings jsonb
);

ALTER TABLE public.users OWNER TO app;

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

CREATE TABLE public.orders (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    total numeric(10,2) NOT NULL,
    placed_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.orders ALTER COLUMN id SET DEFAULT nextval('public.orders_id_seq'::regclass);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

CREATE INDEX idx_orders_user ON public.orders USING btree (user_id);

COMMENT ON TABLE public.users IS 'People who can sign in';

GRANT SELECT ON TABLE public.users TO readonly;
`;

  it("imports both tables with auto-number upgrades and the FK", () => {
    const { schema, tableCount, columnCount } = importOk(DUMP);
    expect(tableCount).toBe(2);
    expect(columnCount).toBe(9);

    expect(table(schema, "users")).toEqual({
      name: "users",
      columns: [
        { name: "id", type: "auto-number", nullable: false },
        { name: "email", type: "text", nullable: false, unique: true, maxLength: 255 },
        { name: "display_name", type: "text", nullable: true },
        { name: "is_admin", type: "true-false", nullable: false },
        { name: "created_at", type: "date-time-tz", nullable: false },
      ],
      primaryKey: ["id"],
    });

    expect(table(schema, "orders")).toEqual({
      name: "orders",
      columns: [
        { name: "id", type: "auto-number-large", nullable: false },
        { name: "user_id", type: "whole-number", nullable: false },
        { name: "total", type: "decimal-number", nullable: false },
        { name: "placed_at", type: "date-time-tz", nullable: false },
      ],
      primaryKey: ["id"],
      foreignKeys: [
        { column: "user_id", references: { table: "users", column: "id" } },
      ],
    });
  });

  it("accounts for everything it did not import", () => {
    const { issues } = importOk(DUMP);
    const whys = issues.map((i) => i.why);

    expect(
      issues.find((i) => i.what === "users.settings")?.why,
    ).toContain("JSON");
    expect(whys.some((w) => w.includes("indexes aren't versioned"))).toBe(true);
    expect(whys.some((w) => w.includes("permissions"))).toBe(true);
    // sequence statements are accounted for one way or another
    expect(
      issues.some((i) => i.what.includes("users_id_seq")),
    ).toBe(true);
    // non-sequence defaults are noted per table
    expect(
      issues.find(
        (i) => i.kind === "dropped-detail" && i.what.startsWith("users:"),
      )?.what,
    ).toBe("users: is_admin, created_at");
    // the FK's ON DELETE action is noted
    expect(
      issues.some(
        (i) => i.kind === "dropped-detail" && i.why.includes("ON DELETE"),
      ),
    ).toBe(true);
  });
});
