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
  "auto-number-small": "Auto number (small)",
  "auto-number": "Auto number",
  "auto-number-large": "Auto number (large)",
  "decimal-number": "Decimal number (exact)",
  "floating-point": "Floating point (approximate)",
  "text": "Text",
  "true-false": "True / false",
  "date": "Date",
  "time": "Time",
  "time-tz": "Time (with time zone)",
  "date-time": "Date & time",
  "date-time-tz": "Date & time (with time zone)",
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

// An auto number is a whole number that the database fills in itself
// (Postgres serial/identity, MySQL AUTO_INCREMENT). Underneath it IS
// a plain integer of the same width, so a foreign key may pair a
// whole number with its auto-number twin — exactly what every real
// schema does (orders.user_id integer → users.id serial).
const AUTO_NUMBER_TWIN: Partial<Record<ColumnType, ColumnType>> = {
  "auto-number-small": "whole-number-small",
  "auto-number": "whole-number",
  "auto-number-large": "whole-number-large",
};

export function fkTypesCompatible(a: ColumnType, b: ColumnType): boolean {
  return a === b || AUTO_NUMBER_TWIN[a] === b || AUTO_NUMBER_TWIN[b] === a;
}
