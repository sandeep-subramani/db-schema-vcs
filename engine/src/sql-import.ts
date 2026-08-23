// Paste-SQL import (decisions.md #8): Postgres DDL in, our snapshot
// out. The parser library turns SQL text into a syntax tree; this
// module is the adapter that walks the tree and emits our Schema,
// which then passes the same validateSchema gate as JSON import.
//
// Policy is "import what we model, list what was skipped": the input
// is split into statements (sql-split.ts) and each is parsed alone,
// so anything unreadable or out of scope becomes a skip-list line
// instead of a failed import. Consumed statements: CREATE TABLE,
// ALTER TABLE ADD CONSTRAINT / ADD COLUMN, and the two auto-number
// patterns pg_dump uses instead of the word "serial" (a sequence
// default, or ADD GENERATED ... AS IDENTITY). Everything else is
// reported with a plain reason.
//
// Type names resolve through the mapping table below (decisions.md
// #9): a dialect type maps to a canonical type only when genuinely
// equal; Postgres types with no canonical home skip their column.

import { parse } from "pgsql-ast-parser";
import { splitSqlStatements } from "./sql-split.ts";
import { validateSchema } from "./validate.ts";
import {
  fkTypesCompatible,
  type Column,
  type ColumnType,
  type Schema,
  type Table,
} from "./types.ts";

export interface SqlImportIssue {
  /**
   * skipped-statement: a whole statement not imported.
   * skipped-column: a column left out (type has no canonical home).
   * skipped-constraint: a key/unique/FK that couldn't be represented.
   * dropped-detail: imported, minus an attribute we don't version
   * (defaults, checks, precision, FK actions).
   */
  kind:
    | "skipped-statement"
    | "skipped-column"
    | "skipped-constraint"
    | "dropped-detail";
  what: string;
  why: string;
}

export type SqlImportResult =
  | {
      ok: true;
      schema: Schema;
      issues: SqlImportIssue[];
      tableCount: number;
      columnCount: number;
    }
  | { ok: false; errors: string[]; issues: SqlImportIssue[] };

// --- minimal structural view of the parser's AST ----------------------
// Only the fields this module reads, verified against the parser's
// actual output; keeps us decoupled from the library's full union.

interface PgName {
  name: string;
  schema?: string;
}

interface PgDataType {
  name?: string;
  kind?: "array";
  config?: number[];
}

interface PgExpr {
  type: string;
  function?: { name: string };
}

interface PgColumnConstraint {
  type: string;
  default?: PgExpr;
  foreignTable?: PgName;
  foreignColumns?: PgName[];
  onDelete?: string;
  onUpdate?: string;
}

interface PgColumnDef {
  kind: string;
  name: PgName;
  dataType: PgDataType;
  constraints?: PgColumnConstraint[];
}

interface PgTableConstraint {
  type: string;
  constraintName?: PgName;
  columns?: PgName[];
  localColumns?: PgName[];
  foreignTable?: PgName;
  foreignColumns?: PgName[];
  onDelete?: string;
  onUpdate?: string;
}

interface PgAlterChange {
  type: string;
  column?: PgName | PgColumnDef;
  constraint?: PgTableConstraint;
  alter?: { type: string; default?: PgExpr };
}

interface PgStatement {
  type: string;
  name?: PgName;
  table?: PgName;
  columns?: PgColumnDef[];
  constraints?: PgTableConstraint[];
  changes?: PgAlterChange[];
}

// --- type mapping (decisions.md #9, Postgres audit) --------------------

type Mapped =
  | { kind: "type"; type: ColumnType; serial?: boolean; precisionNote?: string }
  | { kind: "skip"; why: string };

const SKIP_REASONS = {
  array: "array columns aren't modeled yet",
  json: "JSON columns aren't modeled yet",
  real: "4-byte floating point isn't in the type list — only the 8-byte kind (Floating point) is",
  char: "fixed-length space-padded text isn't modeled yet — only Text (varchar-like) is",
  interval: "durations (interval) aren't modeled yet",
} as const;

function mapDataType(dt: PgDataType): Mapped & { maxLength?: number } {
  if (dt.kind === "array") return { kind: "skip", why: SKIP_REASONS.array };
  const name = (dt.name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const first = dt.config?.[0];

  const plain = (type: ColumnType): Mapped => ({ kind: "type", type });
  const serial = (type: ColumnType): Mapped => ({ kind: "type", type, serial: true });
  const withPrecisionNote = (type: ColumnType, note: string): Mapped =>
    dt.config && dt.config.length > 0
      ? { kind: "type", type, precisionNote: note }
      : { kind: "type", type };

  switch (name) {
    case "smallint":
    case "int2":
      return plain("whole-number-small");
    case "integer":
    case "int":
    case "int4":
      return plain("whole-number");
    case "bigint":
    case "int8":
      return plain("whole-number-large");
    case "smallserial":
    case "serial2":
      return serial("auto-number-small");
    case "serial":
    case "serial4":
      return serial("auto-number");
    case "bigserial":
    case "serial8":
      return serial("auto-number-large");
    case "numeric":
    case "decimal":
      return withPrecisionNote(
        "decimal-number",
        "numeric precision/scale isn't versioned yet — imported as plain Decimal number",
      );
    case "double precision":
    case "float8":
      return plain("floating-point");
    case "float":
      // float(1..24) is Postgres shorthand for real (4-byte).
      if (first !== undefined && first <= 24) {
        return { kind: "skip", why: SKIP_REASONS.real };
      }
      return plain("floating-point");
    case "real":
    case "float4":
      return { kind: "skip", why: SKIP_REASONS.real };
    case "varchar":
    case "character varying": {
      const mapped = plain("text");
      return first !== undefined ? { ...mapped, maxLength: first } : mapped;
    }
    case "text":
      return plain("text");
    case "char":
    case "character":
    case "bpchar":
      return { kind: "skip", why: SKIP_REASONS.char };
    case "boolean":
    case "bool":
      return plain("true-false");
    case "date":
      return plain("date");
    case "time":
    case "time without time zone":
      return withPrecisionNote("time", "time precision isn't versioned yet");
    case "timetz":
    case "time with time zone":
      return withPrecisionNote("time-tz", "time precision isn't versioned yet");
    case "timestamp":
    case "timestamp without time zone":
      return withPrecisionNote("date-time", "time precision isn't versioned yet");
    case "timestamptz":
    case "timestamp with time zone":
      return withPrecisionNote(
        "date-time-tz",
        "time precision isn't versioned yet",
      );
    case "uuid":
      return plain("unique-id");
    case "bytea":
      return plain("binary-data");
    case "json":
    case "jsonb":
      return { kind: "skip", why: SKIP_REASONS.json };
    case "interval":
      return { kind: "skip", why: SKIP_REASONS.interval };
    default:
      return {
        kind: "skip",
        why: `type "${dt.name ?? "?"}" isn't in the type vocabulary yet (a custom or unsupported Postgres type)`,
      };
  }
}

const AUTO_UPGRADE: Partial<Record<ColumnType, ColumnType>> = {
  "whole-number-small": "auto-number-small",
  "whole-number": "auto-number",
  "whole-number-large": "auto-number-large",
};

function isNextvalCall(expr: PgExpr | undefined): boolean {
  return expr?.type === "call" && expr.function?.name === "nextval";
}

// --- working state ------------------------------------------------------

interface PendingFk {
  column: string;
  refTable: string;
  /** Defensive: the parser always names it today; absent = dropped. */
  refColumn?: string;
  hadActions: boolean;
}

interface WorkTable {
  name: string;
  columns: Map<string, Column>;
  skippedColumns: Map<string, string>;
  primaryKey?: string[];
  fks: PendingFk[];
  resolvedFks?: Table["foreignKeys"];
}

class Importer {
  issues: SqlImportIssue[] = [];
  tables = new Map<string, WorkTable>();
  /** why → table → column names, flushed as aggregated notes. */
  private notes = new Map<string, Map<string, string[]>>();

  note(why: string, table: string, item?: string): void {
    const perTable = this.notes.get(why) ?? new Map<string, string[]>();
    const items = perTable.get(table) ?? [];
    if (item) items.push(item);
    perTable.set(table, items);
    this.notes.set(why, perTable);
  }

  flushNotes(): void {
    for (const [why, perTable] of this.notes) {
      for (const [table, items] of perTable) {
        this.issues.push({
          kind: "dropped-detail",
          what: items.length > 0 ? `${table}: ${items.join(", ")}` : table,
          why,
        });
      }
    }
  }
}

function tableName(ref: PgName): string {
  return ref.schema && ref.schema !== "public"
    ? `${ref.schema}.${ref.name}`
    : ref.name;
}

function preview(text: string, line: number): string {
  const head = text.replace(/\s+/g, " ").slice(0, 60);
  return `line ${line}: ${head}${text.length > 60 ? "…" : ""}`;
}

// --- statement handlers -------------------------------------------------

function readColumnDef(im: Importer, wt: WorkTable, col: PgColumnDef): void {
  const colName = col.name.name;
  if (wt.columns.has(colName) || wt.skippedColumns.has(colName)) {
    im.issues.push({
      kind: "skipped-column",
      what: `${wt.name}.${colName}`,
      why: "defined twice — kept the first definition",
    });
    return;
  }
  const mapped = mapDataType(col.dataType);
  if (mapped.kind === "skip") {
    wt.skippedColumns.set(colName, mapped.why);
    im.issues.push({
      kind: "skipped-column",
      what: `${wt.name}.${colName}`,
      why: mapped.why,
    });
    // Keys riding on the skipped column go with it — say so, since a
    // silently vanished primary key is worse than a skipped column.
    for (const c of col.constraints ?? []) {
      if (c.type === "primary key" || c.type === "unique" || c.type === "reference") {
        im.issues.push({
          kind: "skipped-constraint",
          what: `${wt.name}: ${c.type === "reference" ? "foreign key" : c.type} on "${colName}"`,
          why: "dropped along with its skipped column",
        });
      }
    }
    return;
  }
  if (mapped.precisionNote) im.note(mapped.precisionNote, wt.name, colName);

  const column: Column = { name: colName, type: mapped.type, nullable: true };
  if (mapped.maxLength !== undefined) column.maxLength = mapped.maxLength;
  // serial and identity both mean NOT NULL in Postgres, written or not
  if (mapped.serial) column.nullable = false;

  for (const c of col.constraints ?? []) {
    switch (c.type) {
      case "not null":
        column.nullable = false;
        break;
      case "null":
        column.nullable = true;
        break;
      case "primary key":
        applyPrimaryKey(im, wt, [colName]);
        break;
      case "unique":
        column.unique = true;
        break;
      case "default":
        if (isNextvalCall(c.default)) {
          upgradeToAutoNumber(im, wt.name, column);
        } else {
          im.note("default values aren't versioned yet", wt.name, colName);
        }
        break;
      case "check":
        im.note("check constraints aren't versioned yet", wt.name, colName);
        break;
      case "add generated": // GENERATED ... AS IDENTITY
        upgradeToAutoNumber(im, wt.name, column);
        column.nullable = false;
        break;
      case "reference":
        wt.fks.push({
          column: colName,
          refTable: c.foreignTable ? tableName(c.foreignTable) : "",
          refColumn: c.foreignColumns?.[0]?.name,
          hadActions: Boolean(c.onDelete || c.onUpdate),
        });
        break;
      default:
        im.note(
          `"${c.type}" column settings aren't versioned yet`,
          wt.name,
          colName,
        );
    }
  }
  wt.columns.set(colName, column);
  // A PK set by an earlier inline constraint may name this column.
  if (wt.primaryKey?.includes(colName)) column.nullable = false;
}

function upgradeToAutoNumber(
  im: Importer,
  table: string,
  column: Column,
): void {
  const upgraded = AUTO_UPGRADE[column.type];
  if (upgraded) {
    column.type = upgraded;
  } else if (!column.type.startsWith("auto-number")) {
    im.note(
      "auto-fill defaults only upgrade whole-number columns — default dropped",
      table,
      column.name,
    );
  }
}

function applyPrimaryKey(
  im: Importer,
  wt: WorkTable,
  cols: string[],
): void {
  if (wt.primaryKey) {
    im.issues.push({
      kind: "skipped-constraint",
      what: `${wt.name}: PRIMARY KEY (${cols.join(", ")})`,
      why: "the table already has a primary key — second definition ignored",
    });
    return;
  }
  const skipped = cols.filter((c) => wt.skippedColumns.has(c));
  if (skipped.length > 0) {
    im.issues.push({
      kind: "skipped-constraint",
      what: `${wt.name}: PRIMARY KEY (${cols.join(", ")})`,
      why: `dropped — it includes skipped column${skipped.length > 1 ? "s" : ""} ${skipped.join(", ")}`,
    });
    return;
  }
  wt.primaryKey = cols;
  // PK columns are NOT NULL in Postgres even when not written.
  for (const name of cols) {
    const col = wt.columns.get(name);
    if (col) col.nullable = false;
  }
}

function applyTableConstraint(
  im: Importer,
  wt: WorkTable,
  c: PgTableConstraint,
): void {
  const named = c.constraintName ? ` "${c.constraintName.name}"` : "";
  switch (c.type) {
    case "primary key":
      applyPrimaryKey(im, wt, (c.columns ?? []).map((n) => n.name));
      break;
    case "unique": {
      const cols = (c.columns ?? []).map((n) => n.name);
      const only = cols.length === 1 ? cols[0] : undefined;
      if (only === undefined) {
        im.issues.push({
          kind: "skipped-constraint",
          what: `${wt.name}: UNIQUE (${cols.join(", ")})`,
          why: "multi-column unique constraints aren't supported yet (roadmap)",
        });
        break;
      }
      const col = wt.columns.get(only);
      if (col) {
        col.unique = true;
      } else {
        im.issues.push({
          kind: "skipped-constraint",
          what: `${wt.name}: UNIQUE (${only})`,
          why: wt.skippedColumns.has(only)
            ? "its column was skipped"
            : `no column named "${only}" in this table`,
        });
      }
      break;
    }
    case "foreign key": {
      const local = (c.localColumns ?? []).map((n) => n.name);
      const only = local.length === 1 ? local[0] : undefined;
      if (only === undefined) {
        im.issues.push({
          kind: "skipped-constraint",
          what: `${wt.name}: FOREIGN KEY (${local.join(", ")})`,
          why: "multi-column foreign keys aren't supported yet",
        });
        break;
      }
      wt.fks.push({
        column: only,
        refTable: c.foreignTable ? tableName(c.foreignTable) : "",
        refColumn: c.foreignColumns?.[0]?.name,
        hadActions: Boolean(c.onDelete || c.onUpdate),
      });
      break;
    }
    case "check":
      im.note("check constraints aren't versioned yet", wt.name);
      break;
    default:
      im.issues.push({
        kind: "skipped-constraint",
        what: `${wt.name}: ${c.type}${named}`,
        why: `"${c.type}" constraints aren't supported yet`,
      });
  }
}

function handleCreateTable(im: Importer, node: PgStatement, where: string): void {
  const name = node.name ? tableName(node.name) : "";
  if (im.tables.has(name)) {
    im.issues.push({
      kind: "skipped-statement",
      what: where,
      why: `table "${name}" is defined twice — kept the first definition`,
    });
    return;
  }
  const wt: WorkTable = {
    name,
    columns: new Map(),
    skippedColumns: new Map(),
    fks: [],
  };
  im.tables.set(name, wt);
  for (const col of node.columns ?? []) {
    if (col.kind !== "column") {
      im.note(
        `"${col.kind}" clauses in CREATE TABLE aren't supported yet`,
        name,
      );
      continue;
    }
    readColumnDef(im, wt, col);
  }
  for (const c of node.constraints ?? []) {
    applyTableConstraint(im, wt, c);
  }
}

const ALTER_SCOPE_WHY =
  "only ADD COLUMN, ADD CONSTRAINT, and auto-number defaults are read from ALTER TABLE";

function handleAlterTable(im: Importer, node: PgStatement, where: string): void {
  const name = node.table ? tableName(node.table) : "";
  const wt = im.tables.get(name);
  if (!wt) {
    im.issues.push({
      kind: "skipped-statement",
      what: where,
      why: `it alters table "${name}", which isn't defined in this paste`,
    });
    return;
  }
  for (const change of node.changes ?? []) {
    switch (change.type) {
      case "add column": {
        const col = change.column as PgColumnDef | undefined;
        if (col && col.kind === "column") readColumnDef(im, wt, col);
        break;
      }
      case "add constraint":
        if (change.constraint) applyTableConstraint(im, wt, change.constraint);
        break;
      case "alter column": {
        const colName = (change.column as PgName | undefined)?.name ?? "?";
        const alter = change.alter;
        if (alter?.type === "set default" && isNextvalCall(alter.default)) {
          const col = wt.columns.get(colName);
          if (col) upgradeToAutoNumber(im, name, col);
          else if (!wt.skippedColumns.has(colName)) {
            im.issues.push({
              kind: "skipped-statement",
              what: where,
              why: `it sets a default on "${colName}", which isn't a column of "${name}"`,
            });
          }
        } else if (alter?.type === "add generated") {
          const col = wt.columns.get(colName);
          if (col) {
            upgradeToAutoNumber(im, name, col);
            col.nullable = false;
          }
        } else if (alter?.type === "set default") {
          im.note("default values aren't versioned yet", name, colName);
        } else {
          im.issues.push({
            kind: "skipped-statement",
            what: `${where} — ${alter?.type ?? change.type} on "${colName}"`,
            why: ALTER_SCOPE_WHY,
          });
        }
        break;
      }
      case "owner":
        im.note("table ownership is out of scope", name);
        break;
      default:
        im.issues.push({
          kind: "skipped-statement",
          what: `${where} — ${change.type}`,
          why: ALTER_SCOPE_WHY,
        });
    }
  }
}

// --- skip reasons for everything else ----------------------------------

const STATEMENT_REASONS: Record<string, string> = {
  "create index": "indexes aren't versioned yet (roadmap)",
  "create sequence": "sequences ride along inside auto-number columns — nothing separate to import",
  "alter sequence": "sequences ride along inside auto-number columns — nothing separate to import",
  "create view": "views aren't versioned yet",
  "create materialized view": "views aren't versioned yet",
  "create enum": "custom enum types aren't modeled yet — columns using them are skipped too",
  "create composite type": "custom composite types aren't modeled yet",
  "create schema": "schemas (namespaces) aren't versioned — table names keep their prefix instead",
  "create extension": "extensions are out of scope",
  comment: "comments aren't versioned yet",
  set: "a session setting from the dump — nothing to import",
  show: "a session setting — nothing to import",
  "start transaction": "transaction wrapper — nothing to import",
  begin: "transaction wrapper — nothing to import",
  commit: "transaction wrapper — nothing to import",
  rollback: "transaction wrapper — nothing to import",
  "drop table": "DROP statements are ignored — the import reads the end state from the CREATEs",
  drop: "DROP statements are ignored — the import reads the end state from the CREATEs",
  select: "a query — queries don't define schema",
  insert: "row data is out of scope — the schema is what's versioned",
  update: "row data is out of scope — the schema is what's versioned",
  delete: "row data is out of scope — the schema is what's versioned",
  truncate: "row data is out of scope — the schema is what's versioned",
};

function unreadableReason(text: string): string {
  const head = text.trimStart().toLowerCase();
  if (head.startsWith("\\"))
    return "a psql client command, not SQL — nothing to import";
  if (head.startsWith("copy"))
    return "row data (COPY) is out of scope — export with pg_dump --schema-only";
  if (/^create (or replace )?(trigger|function|procedure)/.test(head))
    return "triggers and functions aren't versioned yet";
  if (/^create (or replace )?policy/.test(head))
    return "row-level security isn't versioned yet";
  if (/^create domain/.test(head))
    return "custom domain types aren't supported yet";
  if (/^grant|^revoke/.test(head)) return "permissions are out of scope";
  // The most common readable-by-humans-only form: REFERENCES with no
  // target column ("REFERENCES users"). Postgres infers the primary
  // key; the parser doesn't, so the whole statement became unreadable.
  if (/\breferences\s+("[^"]+"|[a-z_][\w$]*)(\s*\.\s*("[^"]+"|[a-z_][\w$]*))?\s*[,)]/.test(head))
    return 'it uses REFERENCES without a target column — write "REFERENCES table(column)" and paste again';
  return "couldn't read this statement — it may use syntax the importer doesn't know yet";
}

// --- foreign-key resolution ----------------------------------------------

function resolveForeignKeys(im: Importer): void {
  for (const wt of im.tables.values()) {
    const seen = new Set<string>();
    const resolved: Table["foreignKeys"] = [];
    for (const fk of wt.fks) {
      const what = `${wt.name}: foreign key on "${fk.column}"`;
      const drop = (why: string) =>
        im.issues.push({ kind: "skipped-constraint", what, why });

      if (wt.skippedColumns.has(fk.column)) {
        drop(`its column "${fk.column}" was skipped`);
        continue;
      }
      const ownColumn = wt.columns.get(fk.column);
      if (!ownColumn) {
        drop(`no column named "${fk.column}" in this table`);
        continue;
      }
      const target = im.tables.get(fk.refTable);
      if (!target) {
        drop(`it points at table "${fk.refTable}", which isn't in this paste`);
        continue;
      }
      const refColumn = fk.refColumn;
      if (refColumn === undefined) {
        drop(
          `it doesn't name its target column — write REFERENCES ${fk.refTable}(column)`,
        );
        continue;
      }
      if (target.skippedColumns.has(refColumn)) {
        drop(`its target "${fk.refTable}.${refColumn}" was skipped`);
        continue;
      }
      const targetColumn = target.columns.get(refColumn);
      if (!targetColumn) {
        drop(
          `its target "${fk.refTable}.${refColumn}" doesn't exist in this paste`,
        );
        continue;
      }
      const solePk =
        target.primaryKey?.length === 1 && target.primaryKey[0] === refColumn;
      if (!solePk && targetColumn.unique !== true) {
        drop(
          `its target "${fk.refTable}.${refColumn}" isn't unique on its own (Postgres allows a few shapes we don't model yet)`,
        );
        continue;
      }
      if (!fkTypesCompatible(ownColumn.type, targetColumn.type)) {
        drop(
          `the column types don't line up ("${ownColumn.type}" → "${targetColumn.type}") — Postgres allows mixed widths, our model doesn't yet`,
        );
        continue;
      }
      const key = `${fk.column}→${fk.refTable}.${refColumn}`;
      if (seen.has(key)) continue; // inline + ALTER duplicate of the same FK
      seen.add(key);
      if (fk.hadActions) {
        im.note(
          "ON DELETE / ON UPDATE actions aren't versioned yet",
          wt.name,
          fk.column,
        );
      }
      resolved.push({
        column: fk.column,
        references: { table: fk.refTable, column: refColumn },
      });
    }
    if (resolved.length > 0) wt.resolvedFks = resolved;
  }
}

// --- entry point ---------------------------------------------------------

export function importPostgresSql(sql: string): SqlImportResult {
  const im = new Importer();

  for (const stmt of splitSqlStatements(sql)) {
    const where = preview(stmt.text, stmt.line);
    let nodes: PgStatement[];
    try {
      nodes = parse(stmt.text) as unknown as PgStatement[];
    } catch {
      im.issues.push({
        kind: "skipped-statement",
        what: where,
        why: unreadableReason(stmt.text),
      });
      continue;
    }
    for (const node of nodes) {
      if (node.type === "create table") {
        handleCreateTable(im, node, where);
      } else if (node.type === "alter table") {
        handleAlterTable(im, node, where);
      } else {
        im.issues.push({
          kind: "skipped-statement",
          what: where,
          why:
            STATEMENT_REASONS[node.type] ??
            `statements of this kind ("${node.type}") aren't imported`,
        });
      }
    }
  }

  resolveForeignKeys(im);
  im.flushNotes();

  const tables: Table[] = [];
  let columnCount = 0;
  for (const wt of im.tables.values()) {
    const table: Table = { name: wt.name, columns: [...wt.columns.values()] };
    columnCount += table.columns.length;
    if (wt.primaryKey) table.primaryKey = wt.primaryKey;
    if (wt.resolvedFks) table.foreignKeys = wt.resolvedFks;
    tables.push(table);
  }

  // The same gate JSON import and the API use — as a safety net. The
  // translator above already drops anything the validator would
  // reject, so a failure here is a bug worth surfacing, not hiding.
  const result = validateSchema({ tables });
  if (!result.ok) {
    return { ok: false, errors: result.errors, issues: im.issues };
  }
  return {
    ok: true,
    schema: result.schema,
    issues: im.issues,
    tableCount: tables.length,
    columnCount,
  };
}
