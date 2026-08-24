// View-model for the diff card grid: turn two schemas plus the
// engine's change list into per-table cards the UI renders directly.
// Pure functions, no React — testable in isolation, and reusable by
// the day-3 merge view (which composes two change lists side by side).

import {
  COLUMN_TYPES,
  findTable,
  type Column,
  type ColumnPropertyChange,
  type ColumnType,
  type ForeignKey,
  type Schema,
  type SchemaChange,
  type SchemaDiff,
  type Table,
} from "engine";

export interface TableCard {
  /** Post-rename name for surviving tables; old name for dropped ones. */
  name: string;
  status: "added" | "dropped" | "changed";
  /** Old name, when the table itself was renamed. */
  renamedFrom?: string;
  /** Interior changes in diff order — empty for added/dropped cards. */
  changes: SchemaChange[];
  /** The full table, so added/dropped cards can render whole. */
  table?: Table;
}

export interface DiffCards {
  /** Tables with something to show: survivors and added in `to` order, then dropped. */
  cards: TableCard[];
  /** Names of tables untouched between the two versions. */
  unchanged: string[];
}

export function buildDiffCards(
  from: Schema,
  to: Schema,
  diff: SchemaDiff,
): DiffCards {
  // Names can't collide across statuses: a dropped name is absent from
  // `to` and an added name absent from `from`, so one map is enough.
  const byName = new Map<string, TableCard>();
  function card(name: string): TableCard {
    let existing = byName.get(name);
    if (!existing) {
      existing = { name, status: "changed", changes: [] };
      byName.set(name, existing);
    }
    return existing;
  }

  for (const change of diff.changes) {
    switch (change.kind) {
      case "table-added": {
        const c = card(change.table.name);
        c.status = "added";
        c.table = change.table;
        break;
      }
      case "table-dropped": {
        const c = card(change.name);
        c.status = "dropped";
        c.table = findTable(from, change.name);
        break;
      }
      case "table-renamed":
        card(change.to).renamedFrom = change.from;
        break;
      default:
        card(change.table).changes.push(change);
    }
  }

  const toOrder = new Map(to.tables.map((t, i) => [t.name, i]));
  const fromOrder = new Map(from.tables.map((t, i) => [t.name, i]));
  const cards = [...byName.values()].sort((a, b) => {
    const aTo = toOrder.get(a.name);
    const bTo = toOrder.get(b.name);
    if (aTo !== undefined && bTo !== undefined) return aTo - bTo;
    if (aTo !== undefined) return -1; // surviving/added before dropped
    if (bTo !== undefined) return 1;
    return (fromOrder.get(a.name) ?? 0) - (fromOrder.get(b.name) ?? 0);
  });

  const unchanged = to.tables
    .map((t) => t.name)
    .filter((name) => !byName.has(name));

  return { cards, unchanged };
}

// --- display formatting -------------------------------------------------

/** "Text (max 120) · unique · nullable" — only the parts that are true. */
export function formatColumn(column: Column): string {
  let type: string = COLUMN_TYPES[column.type];
  if (column.maxLength !== undefined) type += ` (max ${column.maxLength})`;
  const parts = [type];
  if (column.unique) parts.push("unique");
  if (column.nullable) parts.push("nullable");
  return parts.join(" · ");
}

export function formatForeignKey(fk: ForeignKey): string {
  return `${fk.column} → ${fk.references.table}.${fk.references.column}`;
}

/** One plain-language phrase per changed property. */
export function describePropertyChange(change: ColumnPropertyChange): string {
  switch (change.property) {
    case "type":
      return `Type: ${COLUMN_TYPES[change.from as ColumnType]} → ${
        COLUMN_TYPES[change.to as ColumnType]
      }`;
    case "nullable":
      return change.to ? "Now nullable" : "Now required";
    case "unique":
      return change.to ? "Now unique" : "No longer unique";
    case "maxLength": {
      const from = change.from === undefined ? "none" : String(change.from);
      const to = change.to === undefined ? "none" : String(change.to);
      return `Max length: ${from} → ${to}`;
    }
  }
}

/** "none", "id", or "(id, tenant_id)" for primary-key change lines. */
export function formatPrimaryKey(pk: string[] | undefined): string {
  if (pk === undefined || pk.length === 0) return "none";
  return pk.length === 1 ? pk[0]! : `(${pk.join(", ")})`;
}

// --- merge timeline ------------------------------------------------------

/** One rung of the merge timeline: what each side did to one table.
 *  A table only one side touched has a null on the other. */
export interface MergeTimelineRow {
  /** Table name, as of the branch point where the sides can disagree. */
  name: string;
  ours: TableCard | null;
  theirs: TableCard | null;
  /** Conflict groups touching this table — empty when there are none.
   *  Ids, not a flag, so the view can tell a conflict that is still
   *  open from one the user has already picked a side for. */
  conflictIds: string[];
}

/** Every table name a single change speaks about. A table rename names
 *  two, since the card may be keyed by either end of it. */
function tablesOf(change: SchemaChange): string[] {
  switch (change.kind) {
    case "table-added":
      return [change.table.name];
    case "table-dropped":
      return [change.name];
    case "table-renamed":
      return [change.from, change.to];
    default:
      return [change.table];
  }
}

/** Zip two sides' cards into timeline rows: same table = same rung, so
 *  a disagreement reads across one line instead of down two columns.
 *  Order follows the two card lists in step (ours first at each index),
 *  which keeps each side's own diff order intact. */
export function buildMergeTimeline(
  ours: TableCard[],
  theirs: TableCard[],
  conflicts: readonly { id: string; ours: SchemaChange[]; theirs: SchemaChange[] }[],
): MergeTimelineRow[] {
  const conflictsByTable = new Map<string, string[]>();
  for (const conflict of conflicts) {
    for (const change of [...conflict.ours, ...conflict.theirs]) {
      for (const table of tablesOf(change)) {
        const ids = conflictsByTable.get(table) ?? [];
        if (!ids.includes(conflict.id)) ids.push(conflict.id);
        conflictsByTable.set(table, ids);
      }
    }
  }

  const oursByName = new Map(ours.map((card) => [card.name, card]));
  const theirsByName = new Map(theirs.map((card) => [card.name, card]));

  const rows: MergeTimelineRow[] = [];
  const placed = new Set<string>();
  function place(name: string) {
    if (placed.has(name)) return;
    placed.add(name);
    rows.push({
      name,
      ours: oursByName.get(name) ?? null,
      theirs: theirsByName.get(name) ?? null,
      conflictIds: conflictsByTable.get(name) ?? [],
    });
  }

  for (let i = 0; i < Math.max(ours.length, theirs.length); i++) {
    const mine = ours[i];
    const yours = theirs[i];
    if (mine) place(mine.name);
    if (yours) place(yours.name);
  }
  return rows;
}
