// Snapshot diff (decisions.md #5): compare two schema versions, state
// against state, and produce a list of typed changes. The ambiguous
// case — something dropped here, something similar added there — is
// scored by rename heuristics: confident matches become renames,
// unsure ones become questions for the user, poor ones stay drop+add.
//
// Conventions callers rely on:
// - `changes` is always a complete recipe from `from` to `to`, even
//   while questions are unanswered: a pending pair appears as drop+add
//   until a decision turns it into a rename.
// - Answers come back as RenameDecision values on the next call; a
//   decision naming things that no longer exist is ignored, so a stale
//   UI answer can't corrupt the diff.
// - Table references in changes use the *new* (post-rename) name;
//   dropped/renamed-from fields carry the old name.
// - Renames cascade the way real databases cascade them: a confirmed
//   rename silently updates primary keys and foreign keys that point
//   at it, so those don't show up as separate changes, and dropped-FK
//   payloads are spelled with post-rename names (what applyDiff will
//   find in the schema after the renames ran).
// - Column and table order is not versioned: reordering produces an
//   empty diff.

import type { Column, ColumnType, ForeignKey, Schema, Table } from "./types.ts";

export interface ColumnPropertyChange {
  property: "type" | "nullable" | "unique" | "maxLength";
  from: ColumnType | boolean | number | undefined;
  to: ColumnType | boolean | number | undefined;
}

export type SchemaChange =
  | { kind: "table-added"; table: Table }
  | { kind: "table-dropped"; name: string }
  | { kind: "table-renamed"; from: string; to: string }
  | { kind: "column-added"; table: string; column: Column }
  | { kind: "column-dropped"; table: string; name: string }
  | { kind: "column-renamed"; table: string; from: string; to: string }
  | {
      kind: "column-changed";
      table: string;
      column: string;
      changes: ColumnPropertyChange[];
    }
  | {
      kind: "primary-key-changed";
      table: string;
      from: string[] | undefined;
      to: string[] | undefined;
    }
  | { kind: "foreign-key-added"; table: string; foreignKey: ForeignKey }
  | { kind: "foreign-key-dropped"; table: string; foreignKey: ForeignKey };

export type RenameQuestion =
  | { kind: "table"; from: string; to: string; confidence: number }
  | {
      kind: "column";
      /** New (post-rename) name of the table both columns live in. */
      table: string;
      from: string;
      to: string;
      confidence: number;
    };

export type RenameDecision =
  | { kind: "table"; from: string; to: string; rename: boolean }
  | { kind: "column"; table: string; from: string; to: string; rename: boolean };

export interface SchemaDiff {
  changes: SchemaChange[];
  questions: RenameQuestion[];
}

// --- rename heuristics ------------------------------------------------
//
// Every dropped+added pair gets a score in [0, 1] and lands in a tier:
// "auto" (emitted as a rename outright), "question" (the user is
// asked; drop+add until answered) or "none" (a real drop and a real
// add). Thresholds are tuned to ask rather than guess: auto needs the
// whole shape identical plus a clearly similar name.

const NAME_WEIGHT = 0.5;
const TYPE_WEIGHT = 0.3;
const SHAPE_WEIGHT = 0.2;
/** Same type, same shape — how similar the names must be to auto-match. */
const COLUMN_AUTO_NAME_SIMILARITY = 0.6;
/** Minimum score to ask about a same-type pair. */
const COLUMN_QUESTION_SCORE = 0.5;
/** With the type changed too, the name alone must carry the match. */
const COLUMN_QUESTION_NAME_ONLY = 0.8;

const TABLE_OVERLAP_WEIGHT = 0.6;
const TABLE_NAME_WEIGHT = 0.4;
/** With every column identical, how similar the names must be to auto-match. */
const TABLE_AUTO_NAME_SIMILARITY = 0.5;
const TABLE_QUESTION_OVERLAP = 0.5;
const TABLE_QUESTION_NAME = 0.8;

type Tier = "auto" | "question" | "none";

interface PairScore {
  score: number;
  tier: Tier;
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      // Indexes are in range by construction; the checker can't see it.
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** Name similarity in [0, 1]: 1 = identical (case-insensitive). */
function nameSimilarity(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

function sameShape(a: Column, b: Column): boolean {
  return (
    a.nullable === b.nullable &&
    (a.unique ?? false) === (b.unique ?? false) &&
    a.maxLength === b.maxLength
  );
}

function scoreColumnPair(a: Column, b: Column): PairScore {
  const name = nameSimilarity(a.name, b.name);
  const typeMatch = a.type === b.type;
  const shapeMatch = sameShape(a, b);
  const score =
    NAME_WEIGHT * name +
    (typeMatch ? TYPE_WEIGHT : 0) +
    (shapeMatch ? SHAPE_WEIGHT : 0);
  let tier: Tier = "none";
  if (typeMatch && shapeMatch && name >= COLUMN_AUTO_NAME_SIMILARITY) {
    tier = "auto";
  } else if (typeMatch && score >= COLUMN_QUESTION_SCORE) {
    tier = "question";
  } else if (!typeMatch && name >= COLUMN_QUESTION_NAME_ONLY) {
    tier = "question";
  }
  return { score, tier };
}

/**
 * Fraction of columns (by name + type) the two tables share, over the
 * larger table's column count. Two empty tables count as identical.
 */
function columnOverlap(a: Table, b: Table): number {
  const max = Math.max(a.columns.length, b.columns.length);
  if (max === 0) return 1;
  const signatures = new Set(
    a.columns.map((c) => `${c.name.toLowerCase()}\u0000${c.type}`),
  );
  const shared = b.columns.filter((c) =>
    signatures.has(`${c.name.toLowerCase()}\u0000${c.type}`),
  ).length;
  return shared / max;
}

function scoreTablePair(a: Table, b: Table): PairScore {
  const name = nameSimilarity(a.name, b.name);
  const overlap = columnOverlap(a, b);
  const score = TABLE_OVERLAP_WEIGHT * overlap + TABLE_NAME_WEIGHT * name;
  let tier: Tier = "none";
  if (overlap === 1 && name >= TABLE_AUTO_NAME_SIMILARITY) {
    tier = "auto";
  } else if (overlap >= TABLE_QUESTION_OVERLAP || name >= TABLE_QUESTION_NAME) {
    tier = "question";
  }
  return { score, tier };
}

// --- matching ---------------------------------------------------------

interface RenamePair<T> {
  from: T;
  to: T;
}

interface PendingPair<T> extends RenamePair<T> {
  confidence: number;
}

interface MatchResult<T> {
  renamed: RenamePair<T>[];
  pending: PendingPair<T>[];
}

/**
 * Pair up dropped items with added items. User decisions win outright
 * (both ways); the rest is greedy best-score-first, so each item ends
 * up in at most one rename or one question. Ties break by name so the
 * result is deterministic.
 */
function matchRenames<T extends { name: string }>(
  dropped: T[],
  added: T[],
  scorePair: (a: T, b: T) => PairScore,
  decisions: Array<{ from: string; to: string; rename: boolean }>,
): MatchResult<T> {
  const matchedFrom = new Set<T>();
  const matchedTo = new Set<T>();
  const renamed: RenamePair<T>[] = [];
  const pending: PendingPair<T>[] = [];

  for (const decision of decisions) {
    if (!decision.rename) continue;
    const from = dropped.find(
      (x) => x.name === decision.from && !matchedFrom.has(x),
    );
    const to = added.find((x) => x.name === decision.to && !matchedTo.has(x));
    if (!from || !to) continue; // stale decision — ignore
    matchedFrom.add(from);
    matchedTo.add(to);
    renamed.push({ from, to });
  }

  const rejected = new Set(
    decisions
      .filter((d) => !d.rename)
      .map((d) => `${d.from}\u0000${d.to}`),
  );

  const candidates: Array<{ from: T; to: T } & PairScore> = [];
  for (const from of dropped) {
    if (matchedFrom.has(from)) continue;
    for (const to of added) {
      if (matchedTo.has(to)) continue;
      if (rejected.has(`${from.name}\u0000${to.name}`)) continue;
      const { score, tier } = scorePair(from, to);
      if (tier !== "none") candidates.push({ from, to, score, tier });
    }
  }
  candidates.sort(
    (x, y) =>
      y.score - x.score ||
      x.from.name.localeCompare(y.from.name) ||
      x.to.name.localeCompare(y.to.name),
  );
  for (const candidate of candidates) {
    if (matchedFrom.has(candidate.from) || matchedTo.has(candidate.to)) continue;
    matchedFrom.add(candidate.from);
    matchedTo.add(candidate.to);
    if (candidate.tier === "auto") {
      renamed.push({ from: candidate.from, to: candidate.to });
    } else {
      pending.push({
        from: candidate.from,
        to: candidate.to,
        confidence: candidate.score,
      });
    }
  }
  return { renamed, pending };
}

// --- the diff ---------------------------------------------------------

interface TablePair {
  a: Table;
  b: Table;
}

export function diffSchemas(
  from: Schema,
  to: Schema,
  decisions: RenameDecision[] = [],
): SchemaDiff {
  const changes: SchemaChange[] = [];
  const questions: RenameQuestion[] = [];

  // Match tables: same name first, then rename detection on the rest.
  const fromByName = new Map(from.tables.map((t) => [t.name, t]));
  const toByName = new Map(to.tables.map((t) => [t.name, t]));
  const droppedTables = from.tables.filter((t) => !toByName.has(t.name));
  const addedTables = to.tables.filter((t) => !fromByName.has(t.name));

  const tableMatch = matchRenames(
    droppedTables,
    addedTables,
    scoreTablePair,
    decisions.filter((d) => d.kind === "table"),
  );

  const pairs: TablePair[] = [];
  for (const table of from.tables) {
    const match = toByName.get(table.name);
    if (match) pairs.push({ a: table, b: match });
  }
  for (const rename of tableMatch.renamed) {
    pairs.push({ a: rename.from, b: rename.to });
  }
  const bIndex = new Map(to.tables.map((t, i) => [t.name, i]));
  pairs.sort((x, y) => bIndex.get(x.b.name)! - bIndex.get(y.b.name)!);

  // Match columns inside every pair. All matching runs before any
  // PK/FK comparison because a rename in one table changes how foreign
  // keys in *other* tables are read.
  const tableRenames = new Map(
    tableMatch.renamed.map((r) => [r.from.name, r.to.name]),
  );
  // Confirmed column renames, keyed by the table's *old* name — that's
  // the name FK references in `from` are spelled with.
  const columnRenames = new Map<string, Map<string, string>>();
  const columnMatches = new Map<string, MatchResult<Column>>();
  for (const pair of pairs) {
    const aByName = new Map(pair.a.columns.map((c) => [c.name, c]));
    const bByName = new Map(pair.b.columns.map((c) => [c.name, c]));
    const match = matchRenames(
      pair.a.columns.filter((c) => !bByName.has(c.name)),
      pair.b.columns.filter((c) => !aByName.has(c.name)),
      scoreColumnPair,
      decisions.filter(
        (d) => d.kind === "column" && d.table === pair.b.name,
      ),
    );
    columnMatches.set(pair.a.name, match);
    columnRenames.set(
      pair.a.name,
      new Map(match.renamed.map((r) => [r.from.name, r.to.name])),
    );
  }

  // Emit table-level changes: renames, then drops, then adds. A pair
  // still pending a question stays a drop+add until it's answered.
  const renamedFromTables = new Set(tableMatch.renamed.map((r) => r.from.name));
  const renamedToTables = new Set(tableMatch.renamed.map((r) => r.to.name));
  for (const pair of pairs) {
    if (renamedToTables.has(pair.b.name)) {
      changes.push({ kind: "table-renamed", from: pair.a.name, to: pair.b.name });
    }
  }
  for (const pending of tableMatch.pending) {
    questions.push({
      kind: "table",
      from: pending.from.name,
      to: pending.to.name,
      confidence: pending.confidence,
    });
  }
  for (const table of droppedTables) {
    if (!renamedFromTables.has(table.name)) {
      changes.push({ kind: "table-dropped", name: table.name });
    }
  }
  for (const table of addedTables) {
    if (!renamedToTables.has(table.name)) {
      changes.push({ kind: "table-added", table });
    }
  }

  // Emit what changed inside each surviving table, in `to` order.
  for (const pair of pairs) {
    emitTableInterior(pair, changes, questions, {
      tableRenames,
      columnRenames,
      columnMatch: columnMatches.get(pair.a.name)!,
    });
  }

  return { changes, questions };
}

interface EmitContext {
  tableRenames: Map<string, string>;
  columnRenames: Map<string, Map<string, string>>;
  columnMatch: MatchResult<Column>;
}

function emitTableInterior(
  pair: TablePair,
  changes: SchemaChange[],
  questions: RenameQuestion[],
  context: EmitContext,
): void {
  const table = pair.b.name;
  const { columnMatch } = context;
  const renames = context.columnRenames.get(pair.a.name)!;
  const bOrder = new Map(pair.b.columns.map((c, i) => [c.name, i]));

  const sortedRenames = [...columnMatch.renamed].sort(
    (x, y) => bOrder.get(x.to.name)! - bOrder.get(y.to.name)!,
  );
  for (const rename of sortedRenames) {
    changes.push({
      kind: "column-renamed",
      table,
      from: rename.from.name,
      to: rename.to.name,
    });
  }
  for (const pending of columnMatch.pending) {
    questions.push({
      kind: "column",
      table,
      from: pending.from.name,
      to: pending.to.name,
      confidence: pending.confidence,
    });
  }

  // Property changes on columns that survived (same name or renamed).
  const survivors: RenamePair<Column>[] = [];
  const bByName = new Map(pair.b.columns.map((c) => [c.name, c]));
  for (const column of pair.a.columns) {
    const renamedTo = renames.get(column.name);
    const counterpart = renamedTo
      ? bByName.get(renamedTo)
      : bByName.get(column.name);
    if (counterpart) survivors.push({ from: column, to: counterpart });
  }
  survivors.sort((x, y) => bOrder.get(x.to.name)! - bOrder.get(y.to.name)!);
  for (const survivor of survivors) {
    const properties = compareColumns(survivor.from, survivor.to);
    if (properties.length > 0) {
      changes.push({
        kind: "column-changed",
        table,
        column: survivor.to.name,
        changes: properties,
      });
    }
  }

  const keptFrom = new Set(survivors.map((s) => s.from.name));
  const keptTo = new Set(survivors.map((s) => s.to.name));
  for (const column of pair.a.columns) {
    if (!keptFrom.has(column.name)) {
      changes.push({ kind: "column-dropped", table, name: column.name });
    }
  }
  for (const column of pair.b.columns) {
    if (!keptTo.has(column.name)) {
      changes.push({ kind: "column-added", table, column });
    }
  }

  // Primary key: compare through the rename map so a renamed PK column
  // isn't reported as a PK change.
  const mappedPk = pair.a.primaryKey?.map((c) => renames.get(c) ?? c);
  if (!stringArraysEqual(mappedPk, pair.b.primaryKey)) {
    changes.push({
      kind: "primary-key-changed",
      table,
      from: pair.a.primaryKey ? [...pair.a.primaryKey] : undefined,
      to: pair.b.primaryKey ? [...pair.b.primaryKey] : undefined,
    });
  }

  // Foreign keys: rewrite the old side through every confirmed rename,
  // then anything without an identical counterpart was dropped/added.
  const normalizedA = (pair.a.foreignKeys ?? []).map((fk) =>
    normalizeForeignKey(fk, pair.a.name, context),
  );
  const remainingB = [...(pair.b.foreignKeys ?? [])];
  for (const fk of normalizedA) {
    const index = remainingB.findIndex((b) => foreignKeysEqual(fk, b));
    if (index >= 0) {
      remainingB.splice(index, 1);
    } else {
      changes.push({ kind: "foreign-key-dropped", table, foreignKey: fk });
    }
  }
  for (const fk of remainingB) {
    changes.push({ kind: "foreign-key-added", table, foreignKey: fk });
  }
}

function compareColumns(a: Column, b: Column): ColumnPropertyChange[] {
  const changes: ColumnPropertyChange[] = [];
  if (a.type !== b.type) {
    changes.push({ property: "type", from: a.type, to: b.type });
  }
  if (a.nullable !== b.nullable) {
    changes.push({ property: "nullable", from: a.nullable, to: b.nullable });
  }
  if ((a.unique ?? false) !== (b.unique ?? false)) {
    changes.push({
      property: "unique",
      from: a.unique ?? false,
      to: b.unique ?? false,
    });
  }
  if (a.maxLength !== b.maxLength) {
    changes.push({ property: "maxLength", from: a.maxLength, to: b.maxLength });
  }
  return changes;
}

/** Respell an old-side FK with post-rename names. */
function normalizeForeignKey(
  fk: ForeignKey,
  ownTableOldName: string,
  context: EmitContext,
): ForeignKey {
  const ownRenames = context.columnRenames.get(ownTableOldName);
  const referencedRenames = context.columnRenames.get(fk.references.table);
  return {
    column: ownRenames?.get(fk.column) ?? fk.column,
    references: {
      table: context.tableRenames.get(fk.references.table) ?? fk.references.table,
      column: referencedRenames?.get(fk.references.column) ?? fk.references.column,
    },
  };
}

function foreignKeysEqual(a: ForeignKey, b: ForeignKey): boolean {
  return (
    a.column === b.column &&
    a.references.table === b.references.table &&
    a.references.column === b.references.column
  );
}

function stringArraysEqual(
  a: string[] | undefined,
  b: string[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
