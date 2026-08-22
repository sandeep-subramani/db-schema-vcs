// Replays a diff's change list onto a schema. This is the other half
// of the roundtrip guarantee — applyDiff(diffSchemas(A, B).changes, A)
// must equal B — and the half the three-way merge will stand on:
// merge = apply both branches' non-conflicting changes to the base.
//
// Renames cascade exactly as diffSchemas assumes (see diff.ts): a
// table rename rewrites every foreign key that references the table;
// a column rename rewrites the table's primary key, its own foreign
// keys, and every foreign key elsewhere that points at the column.
// Beyond that, applyDiff performs no validation — a recipe from
// diffSchemas is complete by construction, and merge output goes
// through validateSchema before being stored. A change whose target
// is missing throws, since that recipe can't be describing this
// schema.

import { findColumn, findTable, type Column, type Schema, type Table } from "./types.ts";
import type { SchemaChange } from "./diff.ts";

export function applyDiff(schema: Schema, changes: SchemaChange[]): Schema {
  const result = cloneSchema(schema);
  for (const change of changes) {
    applyChange(result, change);
  }
  return result;
}

function applyChange(schema: Schema, change: SchemaChange): void {
  switch (change.kind) {
    case "table-added": {
      if (findTable(schema, change.table.name)) {
        throw new Error(
          `applyDiff: can't add table "${change.table.name}" — it already exists`,
        );
      }
      schema.tables.push(cloneTable(change.table));
      break;
    }
    case "table-dropped": {
      const index = schema.tables.findIndex((t) => t.name === change.name);
      if (index < 0) throw missing(`table "${change.name}"`);
      schema.tables.splice(index, 1);
      break;
    }
    case "table-renamed": {
      const table = mustFindTable(schema, change.from);
      if (findTable(schema, change.to)) {
        throw new Error(
          `applyDiff: can't rename table "${change.from}" to "${change.to}" — that name is taken`,
        );
      }
      table.name = change.to;
      for (const other of schema.tables) {
        for (const fk of other.foreignKeys ?? []) {
          if (fk.references.table === change.from) {
            fk.references.table = change.to;
          }
        }
      }
      break;
    }
    case "column-added": {
      const table = mustFindTable(schema, change.table);
      if (findColumn(table, change.column.name)) {
        throw new Error(
          `applyDiff: can't add column "${change.column.name}" to "${change.table}" — it already exists`,
        );
      }
      table.columns.push(cloneColumn(change.column));
      break;
    }
    case "column-dropped": {
      const table = mustFindTable(schema, change.table);
      const index = table.columns.findIndex((c) => c.name === change.name);
      if (index < 0) throw missing(`column "${change.table}.${change.name}"`);
      table.columns.splice(index, 1);
      break;
    }
    case "column-renamed": {
      const table = mustFindTable(schema, change.table);
      const column = findColumn(table, change.from);
      if (!column) throw missing(`column "${change.table}.${change.from}"`);
      if (findColumn(table, change.to)) {
        throw new Error(
          `applyDiff: can't rename column "${change.table}.${change.from}" to "${change.to}" — that name is taken`,
        );
      }
      column.name = change.to;
      if (table.primaryKey) {
        table.primaryKey = table.primaryKey.map((c) =>
          c === change.from ? change.to : c,
        );
      }
      for (const fk of table.foreignKeys ?? []) {
        if (fk.column === change.from) fk.column = change.to;
      }
      for (const other of schema.tables) {
        for (const fk of other.foreignKeys ?? []) {
          if (
            fk.references.table === table.name &&
            fk.references.column === change.from
          ) {
            fk.references.column = change.to;
          }
        }
      }
      break;
    }
    case "column-changed": {
      const table = mustFindTable(schema, change.table);
      const column = findColumn(table, change.column);
      if (!column) throw missing(`column "${change.table}.${change.column}"`);
      for (const p of change.changes) {
        if (p.property === "type") {
          column.type = p.to as Column["type"];
        } else if (p.property === "nullable") {
          column.nullable = p.to as boolean;
        } else if (p.property === "unique") {
          // Canonical form: unique is stored as true or absent.
          if (p.to === true) column.unique = true;
          else delete column.unique;
        } else {
          if (p.to === undefined) delete column.maxLength;
          else column.maxLength = p.to as number;
        }
      }
      break;
    }
    case "primary-key-changed": {
      const table = mustFindTable(schema, change.table);
      if (change.to) table.primaryKey = [...change.to];
      else delete table.primaryKey;
      break;
    }
    case "foreign-key-added": {
      const table = mustFindTable(schema, change.table);
      const fk = change.foreignKey;
      table.foreignKeys ??= [];
      table.foreignKeys.push({
        column: fk.column,
        references: { table: fk.references.table, column: fk.references.column },
      });
      break;
    }
    case "foreign-key-dropped": {
      const table = mustFindTable(schema, change.table);
      const fk = change.foreignKey;
      const index = (table.foreignKeys ?? []).findIndex(
        (candidate) =>
          candidate.column === fk.column &&
          candidate.references.table === fk.references.table &&
          candidate.references.column === fk.references.column,
      );
      if (index < 0) {
        throw missing(
          `foreign key on "${change.table}.${fk.column}" → "${fk.references.table}.${fk.references.column}"`,
        );
      }
      table.foreignKeys!.splice(index, 1);
      // Canonical form: no foreign keys is absent, not an empty array.
      if (table.foreignKeys!.length === 0) delete table.foreignKeys;
      break;
    }
  }
}

function mustFindTable(schema: Schema, name: string): Table {
  const table = findTable(schema, name);
  if (!table) throw missing(`table "${name}"`);
  return table;
}

function missing(what: string): Error {
  return new Error(`applyDiff: ${what} doesn't exist in this schema`);
}

// Hand-rolled deep clone: the model is small, and this keeps optional
// fields absent-when-absent, which structuredClone would too but JSON
// round-tripping wouldn't guarantee for future field types.
function cloneSchema(schema: Schema): Schema {
  return { tables: schema.tables.map(cloneTable) };
}

function cloneTable(table: Table): Table {
  const clone: Table = {
    name: table.name,
    columns: table.columns.map(cloneColumn),
  };
  if (table.primaryKey) clone.primaryKey = [...table.primaryKey];
  if (table.foreignKeys) {
    clone.foreignKeys = table.foreignKeys.map((fk) => ({
      column: fk.column,
      references: { table: fk.references.table, column: fk.references.column },
    }));
  }
  return clone;
}

function cloneColumn(column: Column): Column {
  const clone: Column = {
    name: column.name,
    type: column.type,
    nullable: column.nullable,
  };
  if (column.unique) clone.unique = true;
  if (column.maxLength !== undefined) clone.maxLength = column.maxLength;
  return clone;
}
