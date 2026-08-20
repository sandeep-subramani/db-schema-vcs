// Placeholder schema model. The real shape lands with open decisions
// 1–5 (feature tiers, diff approach, branch model) — nothing here is
// final except the rule that this package stays pure: no framework
// imports, no I/O, every export a plain function or type.

export interface Column {
  name: string;
  type: string;
  nullable: boolean;
}

export interface Table {
  name: string;
  columns: Column[];
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
