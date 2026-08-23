// Schema validation — the single gate every external snapshot passes
// through (JSON import, API request bodies, later SQL import output).
// Everything past this gate is a trusted, normalized Schema, so the
// diff/merge engine never re-checks shape.
//
// Two passes: structural (is the JSON the right shape, with every
// value the right kind) and semantic (do the names line up: duplicate
// tables, PK/FK targets that exist, and so on). Semantic checks only
// run when the structure is fully clean, so their messages can assume
// well-formed data. Unknown fields are rejected rather than ignored —
// a typo like "nullible" silently dropping a constraint is worse than
// an error.

import {
  COLUMN_TYPE_IDS,
  findColumn,
  findTable,
  fkTypesCompatible,
  type Column,
  type ColumnType,
  type ForeignKey,
  type Schema,
  type Table,
} from "./types.ts";

export type ValidationResult =
  | { ok: true; schema: Schema }
  | { ok: false; errors: string[] };

export function validateSchema(input: unknown): ValidationResult {
  const errors: string[] = [];
  const schema = readSchema(input, errors);
  if (schema && errors.length === 0) {
    checkSemantics(schema, errors);
  }
  if (schema && errors.length === 0) {
    return { ok: true, schema };
  }
  return { ok: false, errors };
}

// --- structural pass -------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkNoUnknownFields(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  errors: string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      errors.push(`${where}: unknown field "${key}"`);
    }
  }
}

// Postgres text/jsonb reject NUL bytes and lone surrogate halves, so
// a "valid" schema containing them couldn't be stored; the length cap
// keeps names displayable everywhere a name is shown.
// eslint-disable-next-line no-control-regex -- matching control chars is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const LONE_SURROGATE = /\p{Surrogate}/u;

function readName(
  value: unknown,
  where: string,
  errors: string[],
): string | undefined {
  if (typeof value !== "string") {
    errors.push(`${where}: "name" must be a string`);
    return undefined;
  }
  if (value.trim() === "") {
    errors.push(`${where}: name can't be empty`);
    return undefined;
  }
  if (value !== value.trim()) {
    errors.push(`${where}: name "${value}" has leading or trailing spaces`);
    return undefined;
  }
  if (value.length > 64) {
    errors.push(`${where}: name is longer than 64 characters`);
    return undefined;
  }
  if (CONTROL_CHARS.test(value) || LONE_SURROGATE.test(value)) {
    errors.push(
      `${where}: name contains control characters or broken unicode, which can't be stored`,
    );
    return undefined;
  }
  return value;
}

function readSchema(input: unknown, errors: string[]): Schema | undefined {
  if (!isRecord(input)) {
    errors.push('schema must be an object like { "tables": [...] }');
    return undefined;
  }
  checkNoUnknownFields(input, ["tables"], "schema", errors);
  if (!Array.isArray(input.tables)) {
    errors.push('schema needs a "tables" array (use [] for an empty schema)');
    return undefined;
  }
  const tables: Table[] = [];
  input.tables.forEach((raw, i) => {
    const table = readTable(raw, i, errors);
    if (table) tables.push(table);
  });
  return { tables };
}

function readTable(
  raw: unknown,
  index: number,
  errors: string[],
): Table | undefined {
  const fallback = `tables[${index}]`;
  if (!isRecord(raw)) {
    errors.push(`${fallback}: each table must be an object`);
    return undefined;
  }
  const name = readName(raw.name, fallback, errors);
  const where = name ? `table "${name}"` : fallback;
  checkNoUnknownFields(
    raw,
    ["name", "columns", "primaryKey", "foreignKeys"],
    where,
    errors,
  );

  if (!Array.isArray(raw.columns)) {
    errors.push(
      `${where}: needs a "columns" array (use [] for a table with no columns yet)`,
    );
    return undefined;
  }
  const columns: Column[] = [];
  raw.columns.forEach((c, i) => {
    const column = readColumn(c, i, where, errors);
    if (column) columns.push(column);
  });

  let primaryKey: string[] | undefined;
  if (raw.primaryKey !== undefined) {
    if (
      !Array.isArray(raw.primaryKey) ||
      raw.primaryKey.some((c) => typeof c !== "string")
    ) {
      errors.push(`${where}: "primaryKey" must be an array of column names`);
    } else if (raw.primaryKey.length === 0) {
      errors.push(
        `${where}: "primaryKey" must name at least one column — omit it for no primary key`,
      );
    } else {
      primaryKey = [...(raw.primaryKey as string[])];
    }
  }

  let foreignKeys: ForeignKey[] | undefined;
  if (raw.foreignKeys !== undefined) {
    if (!Array.isArray(raw.foreignKeys)) {
      errors.push(`${where}: "foreignKeys" must be an array`);
    } else {
      const fks: ForeignKey[] = [];
      raw.foreignKeys.forEach((f, i) => {
        const fk = readForeignKey(f, i, where, errors);
        if (fk) fks.push(fk);
      });
      if (fks.length > 0) foreignKeys = fks;
    }
  }

  if (name === undefined) return undefined;
  const table: Table = { name, columns };
  if (primaryKey) table.primaryKey = primaryKey;
  if (foreignKeys) table.foreignKeys = foreignKeys;
  return table;
}

function readColumn(
  raw: unknown,
  index: number,
  tableWhere: string,
  errors: string[],
): Column | undefined {
  const fallback = `${tableWhere}, columns[${index}]`;
  if (!isRecord(raw)) {
    errors.push(`${fallback}: each column must be an object`);
    return undefined;
  }
  const name = readName(raw.name, fallback, errors);
  const where = name ? `${tableWhere}, column "${name}"` : fallback;
  checkNoUnknownFields(
    raw,
    ["name", "type", "nullable", "unique", "maxLength"],
    where,
    errors,
  );

  let type: ColumnType | undefined;
  if (
    typeof raw.type === "string" &&
    (COLUMN_TYPE_IDS as readonly string[]).includes(raw.type)
  ) {
    type = raw.type as ColumnType;
  } else {
    errors.push(
      `${where}: unknown type ${JSON.stringify(raw.type)} — allowed types: ${COLUMN_TYPE_IDS.join(", ")}`,
    );
  }

  let nullable = false;
  if (raw.nullable !== undefined) {
    if (typeof raw.nullable === "boolean") {
      nullable = raw.nullable;
    } else {
      errors.push(`${where}: "nullable" must be true or false`);
    }
  }

  // unique: false is normalized to absent, so stored snapshots have
  // one canonical spelling of "not unique" and the diff never has to
  // treat false and absent as equal.
  let unique = false;
  if (raw.unique !== undefined) {
    if (typeof raw.unique === "boolean") {
      unique = raw.unique;
    } else {
      errors.push(`${where}: "unique" must be true or false`);
    }
  }

  let maxLength: number | undefined;
  if (raw.maxLength !== undefined) {
    if (
      typeof raw.maxLength !== "number" ||
      !Number.isInteger(raw.maxLength) ||
      raw.maxLength < 1 ||
      raw.maxLength > 1_000_000
    ) {
      errors.push(
        `${where}: "maxLength" must be a whole number between 1 and 1,000,000`,
      );
    } else if (type !== undefined && type !== "text") {
      errors.push(
        `${where}: "maxLength" only applies to text columns (this one is "${type}")`,
      );
    } else {
      maxLength = raw.maxLength;
    }
  }

  if (name === undefined || type === undefined) return undefined;
  const column: Column = { name, type, nullable };
  if (unique) column.unique = true;
  if (maxLength !== undefined) column.maxLength = maxLength;
  return column;
}

function readForeignKey(
  raw: unknown,
  index: number,
  tableWhere: string,
  errors: string[],
): ForeignKey | undefined {
  const where = `${tableWhere}, foreignKeys[${index}]`;
  if (!isRecord(raw)) {
    errors.push(`${where}: each foreign key must be an object`);
    return undefined;
  }
  checkNoUnknownFields(raw, ["column", "references"], where, errors);

  let column: string | undefined;
  if (typeof raw.column === "string" && raw.column !== "") {
    column = raw.column;
  } else {
    errors.push(`${where}: "column" must be the name of a column in this table`);
  }

  let references: ForeignKey["references"] | undefined;
  const refs = raw.references;
  if (
    isRecord(refs) &&
    typeof refs.table === "string" &&
    refs.table !== "" &&
    typeof refs.column === "string" &&
    refs.column !== ""
  ) {
    checkNoUnknownFields(refs, ["table", "column"], `${where}.references`, errors);
    references = { table: refs.table, column: refs.column };
  } else {
    errors.push(
      `${where}: "references" must be an object like { "table": "...", "column": "..." }`,
    );
  }

  if (column === undefined || references === undefined) return undefined;
  return { column, references };
}

// --- semantic pass ----------------------------------------------------

function checkSemantics(schema: Schema, errors: string[]): void {
  const seenTables = new Set<string>();
  for (const table of schema.tables) {
    if (seenTables.has(table.name)) {
      errors.push(`duplicate table name "${table.name}"`);
    }
    seenTables.add(table.name);
  }

  for (const table of schema.tables) {
    const where = `table "${table.name}"`;

    const seenColumns = new Set<string>();
    for (const column of table.columns) {
      if (seenColumns.has(column.name)) {
        errors.push(`${where}: duplicate column name "${column.name}"`);
      }
      seenColumns.add(column.name);
    }

    if (table.primaryKey) {
      const seenPk = new Set<string>();
      for (const pkColumn of table.primaryKey) {
        if (seenPk.has(pkColumn)) {
          errors.push(`${where}: primary key lists column "${pkColumn}" twice`);
          continue;
        }
        seenPk.add(pkColumn);
        const column = findColumn(table, pkColumn);
        if (!column) {
          errors.push(
            `${where}: primary key names column "${pkColumn}", which doesn't exist`,
          );
        } else if (column.nullable) {
          errors.push(
            `${where}: column "${pkColumn}" is in the primary key, so it can't be nullable`,
          );
        }
      }
    }

    for (const fk of table.foreignKeys ?? []) {
      const ownColumn = findColumn(table, fk.column);
      if (!ownColumn) {
        errors.push(
          `${where}: foreign key uses column "${fk.column}", which doesn't exist in this table`,
        );
        continue;
      }
      const target = findTable(schema, fk.references.table);
      if (!target) {
        errors.push(
          `${where}: foreign key on "${fk.column}" points at table "${fk.references.table}", which doesn't exist`,
        );
        continue;
      }
      const targetColumn = findColumn(target, fk.references.column);
      if (!targetColumn) {
        errors.push(
          `${where}: foreign key on "${fk.column}" points at column "${fk.references.table}.${fk.references.column}", which doesn't exist`,
        );
        continue;
      }
      // Real-database rule (decisions.md #10): an FK target must be
      // unique on its own — the whole PK being exactly this column,
      // or a unique-marked column. One column out of a composite PK
      // doesn't identify a row, so it isn't a valid target.
      const isSolePrimaryKey =
        target.primaryKey?.length === 1 &&
        target.primaryKey[0] === targetColumn.name;
      if (!isSolePrimaryKey && targetColumn.unique !== true) {
        const ref = `${fk.references.table}.${fk.references.column}`;
        if (target.primaryKey?.includes(targetColumn.name)) {
          errors.push(
            `${where}: foreign key on "${fk.column}" points at "${ref}", which is only part of a composite primary key — a foreign key needs a column that is unique on its own`,
          );
        } else {
          errors.push(
            `${where}: foreign key on "${fk.column}" must point at a unique column, but "${ref}" is neither a single-column primary key nor marked unique`,
          );
        }
      }
      if (!fkTypesCompatible(ownColumn.type, targetColumn.type)) {
        errors.push(
          `${where}: foreign key column "${fk.column}" ("${ownColumn.type}") doesn't match the type of "${fk.references.table}.${fk.references.column}" ("${targetColumn.type}") — types must be the same, or a whole number paired with its auto-number twin`,
        );
      }
    }
  }
}
