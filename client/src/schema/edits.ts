// Pure schema-editing helpers for the visual editor. Each edit takes a
// valid schema and returns a new valid schema — components never
// mutate schema objects directly, so every state in the undo history
// is a snapshot the engine can trust.
//
// Destructive edits report their collateral (decisions.md #4 / editor
// UX call): when a change would break foreign keys elsewhere, the
// helper removes them and lists what it removed in plain language.
// The UI shows that list in a confirm dialog BEFORE applying, so
// nothing is ever dropped silently. The removal itself is one sweep
// (`sweepForeignKeys`) that re-checks every FK against the same rules
// the engine's validator enforces — one place to be right, whatever
// the edit was.

import {
  findColumn,
  findTable,
  fkTypesCompatible,
  type Column,
  type ColumnType,
  type ForeignKey,
  type Schema,
  type Table,
} from "engine";

export interface EditResult {
  schema: Schema;
  /**
   * Plain-language lines describing everything removed beyond the
   * requested change. Non-empty means the UI must confirm first.
   */
  collateral: string[];
}

// --- name validation (mirrors the engine validator's name rules) ----

export function nameProblem(name: string): string | null {
  if (name.trim() === "") return "Name can't be empty.";
  if (name !== name.trim()) return "Name can't start or end with a space.";
  return null;
}

export function tableNameProblem(
  schema: Schema,
  name: string,
  ignoring?: string,
): string | null {
  const base = nameProblem(name);
  if (base) return base;
  if (schema.tables.some((t) => t.name === name && t.name !== ignoring)) {
    return `A table named "${name}" already exists.`;
  }
  return null;
}

export function columnNameProblem(
  table: Table,
  name: string,
  ignoring?: string,
): string | null {
  const base = nameProblem(name);
  if (base) return base;
  if (table.columns.some((c) => c.name === name && c.name !== ignoring)) {
    return `Column "${name}" already exists in this table.`;
  }
  return null;
}

// --- table edits -----------------------------------------------------

export function addTable(schema: Schema, name: string): EditResult {
  return ok({ tables: [...schema.tables, { name, columns: [] }] });
}

export function renameTable(
  schema: Schema,
  oldName: string,
  newName: string,
): EditResult {
  const tables = schema.tables.map((table) => {
    const renamed = table.name === oldName ? { ...table, name: newName } : table;
    // References follow a rename — this is not a destructive edit.
    if (!renamed.foreignKeys?.some((fk) => fk.references.table === oldName)) {
      return renamed;
    }
    return {
      ...renamed,
      foreignKeys: renamed.foreignKeys.map((fk) =>
        fk.references.table === oldName
          ? { ...fk, references: { ...fk.references, table: newName } }
          : fk,
      ),
    };
  });
  return ok({ tables });
}

export function deleteTable(schema: Schema, name: string): EditResult {
  return sweepForeignKeys({
    tables: schema.tables.filter((t) => t.name !== name),
  });
}

// --- column edits ----------------------------------------------------

export function addColumn(
  schema: Schema,
  tableName: string,
  name: string,
  type: ColumnType,
): EditResult {
  const column: Column = { name, type, nullable: false };
  return ok(
    mapTable(schema, tableName, (t) => ({
      ...t,
      columns: [...t.columns, column],
    })),
  );
}

export function renameColumn(
  schema: Schema,
  tableName: string,
  oldName: string,
  newName: string,
): EditResult {
  const tables = schema.tables.map((table) => {
    let next = table;
    if (table.name === tableName) {
      next = {
        ...next,
        columns: next.columns.map((c) =>
          c.name === oldName ? { ...c, name: newName } : c,
        ),
      };
      if (next.primaryKey?.includes(oldName)) {
        next = {
          ...next,
          primaryKey: next.primaryKey.map((n) => (n === oldName ? newName : n)),
        };
      }
      if (next.foreignKeys?.some((fk) => fk.column === oldName)) {
        next = {
          ...next,
          foreignKeys: next.foreignKeys.map((fk) =>
            fk.column === oldName ? { ...fk, column: newName } : fk,
          ),
        };
      }
    }
    // Inbound references follow the rename too.
    if (
      next.foreignKeys?.some(
        (fk) =>
          fk.references.table === tableName && fk.references.column === oldName,
      )
    ) {
      next = {
        ...next,
        foreignKeys: next.foreignKeys.map((fk) =>
          fk.references.table === tableName && fk.references.column === oldName
            ? { ...fk, references: { table: tableName, column: newName } }
            : fk,
        ),
      };
    }
    return next;
  });
  return ok({ tables });
}

export function deleteColumn(
  schema: Schema,
  tableName: string,
  columnName: string,
): EditResult {
  const extra: string[] = [];
  const next = mapTable(schema, tableName, (table) => {
    const t: Table = {
      ...table,
      columns: table.columns.filter((c) => c.name !== columnName),
    };
    if (table.primaryKey?.includes(columnName)) {
      extra.push(`its place in the primary key of "${tableName}"`);
      const remaining = table.primaryKey.filter((n) => n !== columnName);
      if (remaining.length > 0) t.primaryKey = remaining;
      else delete t.primaryKey;
    }
    return t;
  });
  const swept = sweepForeignKeys(next);
  return { schema: swept.schema, collateral: [...extra, ...swept.collateral] };
}

export function setColumnType(
  schema: Schema,
  tableName: string,
  columnName: string,
  type: ColumnType,
): EditResult {
  const extra: string[] = [];
  const next = mapColumn(schema, tableName, columnName, (c) => {
    const column: Column = { ...c, type };
    if (type !== "text" && column.maxLength !== undefined) {
      extra.push(
        `the length limit on "${tableName}.${columnName}" (only text columns have one)`,
      );
      delete column.maxLength;
    }
    return column;
  });
  const swept = sweepForeignKeys(next);
  return { schema: swept.schema, collateral: [...extra, ...swept.collateral] };
}

export function setColumnNullable(
  schema: Schema,
  tableName: string,
  columnName: string,
  nullable: boolean,
): EditResult {
  // Primary-key columns can't be nullable; the UI disables the toggle,
  // this guard keeps the invariant even if it doesn't.
  if (nullable) {
    const table = findTable(schema, tableName);
    if (table?.primaryKey?.includes(columnName)) return ok(schema);
  }
  return ok(mapColumn(schema, tableName, columnName, (c) => ({ ...c, nullable })));
}

export function setColumnUnique(
  schema: Schema,
  tableName: string,
  columnName: string,
  unique: boolean,
): EditResult {
  const next = mapColumn(schema, tableName, columnName, (c) => {
    // Stored spelling is canonical: true or absent, never false.
    const column: Column = { ...c };
    if (unique) column.unique = true;
    else delete column.unique;
    return column;
  });
  return sweepForeignKeys(next);
}

export function setColumnMaxLength(
  schema: Schema,
  tableName: string,
  columnName: string,
  maxLength: number | undefined,
): EditResult {
  return ok(
    mapColumn(schema, tableName, columnName, (c) => {
      if (c.type !== "text") return c;
      const column: Column = { ...c };
      if (maxLength !== undefined && Number.isInteger(maxLength) && maxLength >= 1) {
        column.maxLength = maxLength;
      } else {
        delete column.maxLength;
      }
      return column;
    }),
  );
}

// --- primary key -----------------------------------------------------

export function setPrimaryKeyMembership(
  schema: Schema,
  tableName: string,
  columnName: string,
  inKey: boolean,
): EditResult {
  const table = findTable(schema, tableName);
  if (!table) return ok(schema);
  const column = findColumn(table, columnName);
  if (!column) return ok(schema);
  // Nullable columns can't join the key; UI disables the checkbox.
  if (inKey && column.nullable) return ok(schema);

  const members = new Set(table.primaryKey ?? []);
  if (inKey) members.add(columnName);
  else members.delete(columnName);
  // Keep the key in column order so equal keys always serialize equally.
  const primaryKey = table.columns
    .map((c) => c.name)
    .filter((n) => members.has(n));

  const next = mapTable(schema, tableName, (t) => {
    const updated: Table = { ...t };
    if (primaryKey.length > 0) updated.primaryKey = primaryKey;
    else delete updated.primaryKey;
    return updated;
  });
  return sweepForeignKeys(next);
}

// --- foreign keys ----------------------------------------------------

export function addForeignKey(
  schema: Schema,
  tableName: string,
  fk: ForeignKey,
): EditResult {
  return ok(
    mapTable(schema, tableName, (t) => ({
      ...t,
      foreignKeys: [...(t.foreignKeys ?? []), fk],
    })),
  );
}

export function removeForeignKey(
  schema: Schema,
  tableName: string,
  index: number,
): EditResult {
  return ok(
    mapTable(schema, tableName, (t) => {
      const kept = (t.foreignKeys ?? []).filter((_, i) => i !== index);
      const table: Table = { ...t };
      if (kept.length > 0) table.foreignKeys = kept;
      else delete table.foreignKeys;
      return table;
    }),
  );
}

/**
 * Columns a new foreign key of the given type may point at: unique on
 * their own (single-column primary key, or marked unique) and of a
 * compatible type (same, or a whole number's auto-number twin) — the
 * same rule the engine validator enforces.
 */
export function validFkTargets(
  schema: Schema,
  type: ColumnType,
): { table: string; column: string }[] {
  const targets: { table: string; column: string }[] = [];
  for (const table of schema.tables) {
    for (const column of table.columns) {
      if (fkTypesCompatible(column.type, type) && isUniqueOnOwn(table, column)) {
        targets.push({ table: table.name, column: column.name });
      }
    }
  }
  return targets;
}

// --- internals -------------------------------------------------------

function ok(schema: Schema): EditResult {
  return { schema, collateral: [] };
}

function mapTable(
  schema: Schema,
  name: string,
  fn: (table: Table) => Table,
): Schema {
  return {
    tables: schema.tables.map((t) => (t.name === name ? fn(t) : t)),
  };
}

function mapColumn(
  schema: Schema,
  tableName: string,
  columnName: string,
  fn: (column: Column) => Column,
): Schema {
  return mapTable(schema, tableName, (t) => ({
    ...t,
    columns: t.columns.map((c) => (c.name === columnName ? fn(c) : c)),
  }));
}

function isUniqueOnOwn(table: Table, column: Column): boolean {
  const isSolePrimaryKey =
    table.primaryKey?.length === 1 && table.primaryKey[0] === column.name;
  return isSolePrimaryKey || column.unique === true;
}

/**
 * Remove every foreign key the last edit made invalid, reporting each
 * removal in plain language. Checks the same conditions the engine
 * validator does, so a schema that survives the sweep validates.
 */
function sweepForeignKeys(schema: Schema): EditResult {
  const collateral: string[] = [];
  const tables = schema.tables.map((table) => {
    if (!table.foreignKeys) return table;
    const kept = table.foreignKeys.filter((fk) => {
      const reason = fkProblem(schema, table, fk);
      if (reason === null) return true;
      collateral.push(
        `foreign key ${table.name}.${fk.column} → ${fk.references.table}.${fk.references.column} (${reason})`,
      );
      return false;
    });
    if (kept.length === table.foreignKeys.length) return table;
    const next: Table = { ...table };
    if (kept.length > 0) next.foreignKeys = kept;
    else delete next.foreignKeys;
    return next;
  });
  return { schema: { tables }, collateral };
}

function fkProblem(schema: Schema, owner: Table, fk: ForeignKey): string | null {
  const own = findColumn(owner, fk.column);
  if (!own) return "its own column no longer exists";
  const target = findTable(schema, fk.references.table);
  if (!target) return "the table it points at no longer exists";
  const targetColumn = findColumn(target, fk.references.column);
  if (!targetColumn) return "the column it points at no longer exists";
  if (!isUniqueOnOwn(target, targetColumn)) {
    return "the column it points at is no longer unique";
  }
  if (!fkTypesCompatible(own.type, targetColumn.type)) {
    return "the column types no longer match";
  }
  return null;
}
