// Core schema model (decisions.md #3, #9). Pure data and tiny lookup
// helpers — no I/O, no framework imports.
//
// The type vocabulary is our own, copied from no SQL dialect; dialect
// types get translated to these at the import boundary, and two
// dialect types share one canonical type only when they are truly
// equal by definition (decisions.md #9). Optional fields are the
// forward-compatibility mechanism: absent = feature not used, so old
// snapshots keep loading as the model grows (decisions.md #3).

export const COLUMN_TYPES = {
  "whole-number-small": "Whole number (small)",
  "whole-number": "Whole number",
  "whole-number-large": "Whole number (large)",
  "decimal-number": "Decimal number (exact)",
  "floating-point": "Floating point (approximate)",
  "text": "Text",
  "true-false": "True / false",
  "date": "Date",
  "time": "Time",
  "date-time": "Date & time",
  "unique-id": "Unique ID",
  "binary-data": "Binary data",
} as const;

export type ColumnType = keyof typeof COLUMN_TYPES;

export const COLUMN_TYPE_IDS = Object.keys(COLUMN_TYPES) as ColumnType[];

export interface Column {
  name: string;
  type: ColumnType;
  nullable: boolean;
  /**
   * Single-column unique constraint (decisions.md #10). Only ever
   * stored as true — validation normalizes false to absent.
   */
  unique?: boolean;
  /** Length limit; only allowed when type is "text". Absent = no limit. */
  maxLength?: number;
}

export interface ForeignKey {
  /** Column in the table that owns this foreign key. */
  column: string;
  references: {
    table: string;
    column: string;
  };
}

export interface Table {
  name: string;
  columns: Column[];
  /** Names of the columns forming the primary key. Absent = no PK. */
  primaryKey?: string[];
  foreignKeys?: ForeignKey[];
}

export interface Schema {
  tables: Table[];
}

export function createEmptySchema(): Schema {
  return { tables: [] };
}

export function findTable(schema: Schema, name: string): Table | undefined {
  return schema.tables.find((t) => t.name === name);
}

export function findColumn(table: Table, name: string): Column | undefined {
  return table.columns.find((c) => c.name === name);
}
