import { describe, expect, it } from "vitest";
import { splitSqlStatements } from "./sql-split.ts";

function texts(sql: string): string[] {
  return splitSqlStatements(sql).map((s) => s.text);
}

describe("splitSqlStatements", () => {
  it("splits plain statements and drops empties", () => {
    expect(texts("SELECT 1; ;SELECT 2;")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("keeps the last statement without a trailing semicolon", () => {
    expect(texts("SELECT 1;\nSELECT 2")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("ignores semicolons inside single-quoted strings, with '' escapes", () => {
    expect(texts("INSERT INTO t VALUES ('a;b', 'it''s; fine');")).toEqual([
      "INSERT INTO t VALUES ('a;b', 'it''s; fine')",
    ]);
  });

  it("ignores semicolons inside E'' strings with backslash escapes", () => {
    expect(texts("SELECT E'a\\';b';SELECT 2;")).toEqual([
      "SELECT E'a\\';b'",
      "SELECT 2",
    ]);
  });

  it("ignores semicolons inside quoted identifiers", () => {
    expect(texts('CREATE TABLE "weird;name" (id int);')).toEqual([
      'CREATE TABLE "weird;name" (id int)',
    ]);
  });

  it("ignores semicolons inside dollar-quoted bodies, tagged or not", () => {
    const fn =
      "CREATE FUNCTION f() RETURNS trigger AS $body$ BEGIN x := 1; RETURN NEW; END; $body$ LANGUAGE plpgsql";
    expect(texts(`${fn};SELECT 1;`)).toEqual([fn, "SELECT 1"]);
    expect(texts("SELECT $$a;b$$;SELECT 2;")).toEqual([
      "SELECT $$a;b$$",
      "SELECT 2",
    ]);
  });

  it("ignores semicolons in line comments and nested block comments", () => {
    expect(
      texts("SELECT 1 -- not; the end\n+ 2;/* outer ; /* inner ; */ still; */SELECT 3;"),
    ).toEqual(["SELECT 1 -- not; the end\n+ 2", "SELECT 3"]);
  });

  it("treats a backslash line as its own statement (psql command)", () => {
    expect(texts("\\connect mydb\nSELECT 1;")).toEqual([
      "\\connect mydb",
      "SELECT 1",
    ]);
  });

  it("swallows COPY ... FROM stdin data rows up to the terminator", () => {
    const dump =
      "COPY public.users (id, name) FROM stdin;\n1\tale\n2\tbob; not a statement\n\\.\nSELECT 1;";
    expect(texts(dump)).toEqual([
      "COPY public.users (id, name) FROM stdin",
      "SELECT 1",
    ]);
  });

  it("reports the line of each statement's first real character", () => {
    const sql = "-- header comment\n\nCREATE TABLE a (id int);\n\nSELECT 1;";
    expect(splitSqlStatements(sql)).toEqual([
      { text: "CREATE TABLE a (id int)", line: 3 },
      { text: "SELECT 1", line: 5 },
    ]);
  });

  it("survives an unterminated string without hanging", () => {
    expect(texts("SELECT 'oops")).toEqual(["SELECT 'oops"]);
    expect(texts("SELECT $$oops")).toEqual(["SELECT $$oops"]);
  });
});
