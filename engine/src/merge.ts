// Three-way schema merge: diff both sides against their common base,
// combine everything that doesn't overlap, and turn genuine overlaps
// into conflicts a user resolves by picking a side. The base is the
// stored branch-point snapshot (decisions.md #7), so no ancestor
// search ever happens here.
//
// How it works, in order:
// 1. Both sides are diffed against the base with the day-2 engine,
//    rename questions included. Questions surface first (labeled with
//    the side they came from); conflicts computed while questions are
//    still open are provisional, because an unanswered rename is a
//    drop+add until decided.
// 2. Each side's change list is respelled into *base* names ("the
//    column both sides started from"), so changes from the two sides
//    can be compared thing-by-thing even when one side renamed things.
// 3. Identical changes are agreements and apply once. Changes touching
//    different things both apply. Changes that collide — same thing
//    edited differently, or a combination the validator would reject
//    (an FK added to a table the other side dropped, unique removed
//    under a new FK, a length limit on a column retyped away from
//    text) — become conflicts.
// 4. Colliding changes are grouped into connected components: if A
//    conflicts with B and B with C, one pick decides all three. Since
//    each side's own change list is internally consistent (it came
//    from a valid schema), resolving a whole group to one side can
//    never produce a contradiction — which is what makes pick-a-side
//    resolution safe no matter how the picks combine.
// 5. The merged schema = base + surviving changes, renames replayed
//    first (columns, then tables) and everything else respelled
//    through the combined rename maps of *both* sides — references
//    follow the object, not its spelling (decisions.md #17). The
//    result must pass validateSchema; if it ever doesn't, that is an
//    engine bug, and we throw rather than hand back a broken schema.

import type { Column, Schema, Table } from "./types.ts";
import { findColumn, findTable } from "./types.ts";
import {
  diffSchemas,
  type RenameDecision,
  type RenameQuestion,
  type SchemaChange,
} from "./diff.ts";
import { applyDiff } from "./apply.ts";
import { validateSchema } from "./validate.ts";

export type MergeSide = "ours" | "theirs";

export interface MergeQuestion {
  side: MergeSide;
  question: RenameQuestion;
}

export interface MergeConflict {
  /** Stable id derived from the base-space things in dispute. */
  id: string;
  /** This side's stake, spelled in base names. Picking a side keeps
   *  that side's changes and drops the other side's — whole group,
   *  so the outcome is always self-consistent. */
  ours: SchemaChange[];
  theirs: SchemaChange[];
  /** Plain-language sentences naming each collision in the group. */
  reasons: string[];
}

export interface MergeResolution {
  id: string;
  choose: MergeSide;
}

export interface MergeAnswers {
  /** Rename answers for the ours-side diff (base → ours). */
  oursRenames?: RenameDecision[];
  /** Rename answers for the theirs-side diff (base → theirs). */
  theirsRenames?: RenameDecision[];
  /** Conflict picks. Ids that no longer name a conflict are ignored. */
  resolutions?: MergeResolution[];
}

export interface MergeResult {
  /** Open rename questions from both side diffs. Answer these first:
   *  conflicts are provisional until no questions remain. */
  questions: MergeQuestion[];
  conflicts: MergeConflict[];
  /** Each side's diff against the base in that side's own names —
   *  what the UI renders as "what this side did". */
  oursChanges: SchemaChange[];
  theirsChanges: SchemaChange[];
  /** The merged schema, or null while any question or conflict is
   *  still unresolved. */
  merged: Schema | null;
}

/**
 * Three-way merge. `ours` is the merge target (the parent branch),
 * `theirs` the branch being merged in; the engine treats them
 * symmetrically — swapping them swaps the sides of every conflict but
 * changes nothing else.
 */
export function mergeSchemas(
  base: Schema,
  ours: Schema,
  theirs: Schema,
  answers: MergeAnswers = {},
): MergeResult {
  const oursDiff = diffSchemas(base, ours, answers.oursRenames ?? []);
  const theirsDiff = diffSchemas(base, theirs, answers.theirsRenames ?? []);

  const questions: MergeQuestion[] = [
    ...oursDiff.questions.map((question) => ({ side: "ours" as const, question })),
    ...theirsDiff.questions.map((question) => ({ side: "theirs" as const, question })),
  ];

  const oursCanonical = toBaseSpace(oursDiff.changes);
  const theirsCanonical = toBaseSpace(theirsDiff.changes);

  // Agreements: the same change made on both sides applies once and
  // can never conflict — anything that could clash with it would have
  // clashed inside one side's own (valid) schema already.
  const agreedTheirs = findAgreements(oursCanonical, theirsCanonical);
  const agreedOurs = findAgreements(theirsCanonical, oursCanonical);
  const oursDisputed = oursCanonical.filter((_, i) => !agreedOurs.has(i));
  const theirsDisputed = theirsCanonical.filter((_, i) => !agreedTheirs.has(i));

  const conflicts = detectConflicts(oursDisputed, theirsDisputed, base);

  const merged =
    questions.length === 0
      ? buildMerged(
          base,
          oursCanonical,
          theirsCanonical,
          agreedTheirs,
          conflicts,
          answers.resolutions ?? [],
        )
      : null;

  return {
    questions,
    conflicts,
    oursChanges: oursDiff.changes,
    theirsChanges: theirsDiff.changes,
    merged,
  };
}

// --- base-space respelling ---------------------------------------------
//
// diffSchemas spells table/column references with the *new* (post-
// rename) names. To compare the two sides thing-by-thing, both lists
// are respelled with base names; to apply survivors, they're respelled
// again with the final names produced by both sides' surviving renames.
// One function does both directions: it maps every identity-bearing
// name through the supplied maps. Names without a base identity (a
// table or column the side added) pass through untouched.

type TableMap = (name: string) => string;
/** Maps a column name; `table` is the owning table's name in the same
 *  space the change is currently spelled in. */
type ColumnMap = (table: string, column: string) => string;

function respellChange(
  change: SchemaChange,
  table: TableMap,
  column: ColumnMap,
): SchemaChange {
  switch (change.kind) {
    case "table-added":
      return {
        kind: "table-added",
        table: {
          ...change.table,
          foreignKeys: change.table.foreignKeys?.map((fk) => ({
            column: fk.column,
            references: {
              table: table(fk.references.table),
              column: column(fk.references.table, fk.references.column),
            },
          })),
        },
      };
    case "table-dropped":
      return { kind: "table-dropped", name: table(change.name) };
    case "table-renamed":
      return change;
    case "column-added":
      return { ...change, table: table(change.table) };
    case "column-dropped":
      return {
        kind: "column-dropped",
        table: table(change.table),
        name: column(change.table, change.name),
      };
    case "column-renamed":
      return { ...change, table: table(change.table) };
    case "column-changed":
      return {
        ...change,
        table: table(change.table),
        column: column(change.table, change.column),
      };
    case "primary-key-changed":
      return {
        ...change,
        table: table(change.table),
        to: change.to?.map((c) => column(change.table, c)),
      };
    case "foreign-key-added":
    case "foreign-key-dropped":
      return {
        kind: change.kind,
        table: table(change.table),
        foreignKey: {
          column: column(change.table, change.foreignKey.column),
          references: {
            table: table(change.foreignKey.references.table),
            column: column(
              change.foreignKey.references.table,
              change.foreignKey.references.column,
            ),
          },
        },
      };
  }
}

/** Respell one side's diff (new names) into base names. */
function toBaseSpace(changes: SchemaChange[]): SchemaChange[] {
  const tableToBase = new Map<string, string>();
  for (const change of changes) {
    if (change.kind === "table-renamed") tableToBase.set(change.to, change.from);
  }
  // Keyed by the table's post-rename name — the name column references
  // in this side's changes are spelled with.
  const columnToBase = new Map<string, Map<string, string>>();
  for (const change of changes) {
    if (change.kind === "column-renamed") {
      let map = columnToBase.get(change.table);
      if (!map) columnToBase.set(change.table, (map = new Map()));
      map.set(change.to, change.from);
    }
  }
  const table: TableMap = (name) => tableToBase.get(name) ?? name;
  const column: ColumnMap = (t, c) => columnToBase.get(t)?.get(c) ?? c;
  return changes.map((change) => respellChange(change, table, column));
}

// --- agreements ---------------------------------------------------------

/** Indices in `mine` whose change also appears, identically, in
 *  `other`. Payload comparison ignores column/FK order (decisions.md
 *  #18: order is not versioned). */
function findAgreements(
  other: SchemaChange[],
  mine: SchemaChange[],
): Set<number> {
  const available = new Map<string, number>();
  for (const change of other) {
    const key = agreementKey(change);
    available.set(key, (available.get(key) ?? 0) + 1);
  }
  const agreed = new Set<number>();
  mine.forEach((change, i) => {
    const key = agreementKey(change);
    const left = available.get(key) ?? 0;
    if (left > 0) {
      available.set(key, left - 1);
      agreed.add(i);
    }
  });
  return agreed;
}

function agreementKey(change: SchemaChange): string {
  switch (change.kind) {
    case "table-added":
      return JSON.stringify(["table-added", change.table.name, tableKey(change.table)]);
    case "table-dropped":
      return JSON.stringify([change.kind, change.name]);
    case "table-renamed":
      return JSON.stringify([change.kind, change.from, change.to]);
    case "column-added":
      return JSON.stringify([change.kind, change.table, columnKey(change.column)]);
    case "column-dropped":
      return JSON.stringify([change.kind, change.table, change.name]);
    case "column-renamed":
      return JSON.stringify([change.kind, change.table, change.from, change.to]);
    case "column-changed":
      return JSON.stringify([
        change.kind,
        change.table,
        change.column,
        change.changes.map((p) => [p.property, p.from ?? null, p.to ?? null]),
      ]);
    case "primary-key-changed":
      return JSON.stringify([change.kind, change.table, change.from ?? null, change.to ?? null]);
    case "foreign-key-added":
    case "foreign-key-dropped":
      return JSON.stringify([change.kind, change.table, foreignKeyKey(change.foreignKey)]);
  }
}

function columnKey(column: Column): unknown[] {
  return [
    column.name,
    column.type,
    column.nullable,
    column.unique ?? false,
    column.maxLength ?? null,
  ];
}

function foreignKeyKey(fk: { column: string; references: { table: string; column: string } }): unknown[] {
  return [fk.column, fk.references.table, fk.references.column];
}

function tableKey(table: Table): unknown[] {
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);
  return [
    [...table.columns].sort(byName).map(columnKey),
    table.primaryKey ?? null,
    (table.foreignKeys ?? [])
      .map(foreignKeyKey)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ];
}

// --- conflict detection ---------------------------------------------------

interface TaggedChange {
  side: MergeSide;
  change: SchemaChange;
}

/** The base table a change happens inside, or null for changes that
 *  are about a table as a whole. */
function scopedTable(change: SchemaChange): string | null {
  switch (change.kind) {
    case "column-added":
    case "column-dropped":
    case "column-renamed":
    case "column-changed":
    case "primary-key-changed":
    case "foreign-key-added":
    case "foreign-key-dropped":
      return change.table;
    default:
      return null;
  }
}

interface FkAddition {
  ownTable: string;
  /** Base column the FK sits on, or null when the column is one the
   *  same side added (no base identity → nothing to collide with). */
  ownColumn: string | null;
  refTable: string;
  refColumn: string;
}

/** Every new foreign key a change introduces — a foreign-key-added
 *  change, or the payload of an added table (self-references inside a
 *  new table have no base identity and are skipped). */
function fkAdditions(change: SchemaChange): FkAddition[] {
  if (change.kind === "foreign-key-added") {
    return [
      {
        ownTable: change.table,
        ownColumn: change.foreignKey.column,
        refTable: change.foreignKey.references.table,
        refColumn: change.foreignKey.references.column,
      },
    ];
  }
  if (change.kind === "table-added") {
    return (change.table.foreignKeys ?? [])
      .filter((fk) => fk.references.table !== change.table.name)
      .map((fk) => ({
        ownTable: change.table.name,
        ownColumn: null,
        refTable: fk.references.table,
        refColumn: fk.references.column,
      }));
  }
  return [];
}

function propertyChange(change: SchemaChange, property: string) {
  if (change.kind !== "column-changed") return undefined;
  return change.changes.find((p) => p.property === property);
}

interface CollideContext {
  base: Schema;
  /** Tables whose primary key either side changes. */
  pkChangedTables: Set<string>;
  /** "table.column" keys either side removes the unique flag from. */
  uniqueRemoved: Set<string>;
}

/** Is `column` the entire primary key of base table `table`? */
function isSoleBasePk(base: Schema, table: string, column: string): boolean {
  const t = findTable(base, table);
  return t?.primaryKey?.length === 1 && t.primaryKey[0] === column;
}

function isBaseUnique(base: Schema, table: string, column: string): boolean {
  const t = findTable(base, table);
  const c = t ? findColumn(t, column) : undefined;
  return c?.unique === true;
}

/**
 * Collisions where `x` plays the leading role. Called both ways
 * around, so every rule here is written one-directional.
 */
function directionalCollisions(
  x: SchemaChange,
  y: SchemaChange,
  ctx: CollideContext,
): string[] {
  const reasons: string[] = [];

  if (x.kind === "table-dropped") {
    if (scopedTable(y) === x.name) {
      reasons.push(
        `table "${x.name}" was dropped on one side and changed on the other`,
      );
    }
    if (y.kind === "table-renamed" && y.from === x.name) {
      reasons.push(
        `table "${x.name}" was dropped on one side and renamed to "${y.to}" on the other`,
      );
    }
    if (fkAdditions(y).some((fk) => fk.refTable === x.name)) {
      reasons.push(
        `a new foreign key points at table "${x.name}", which the other side dropped`,
      );
    }
  }

  if (x.kind === "column-dropped") {
    const spot = `"${x.table}.${x.name}"`;
    if (y.kind === "column-renamed" && y.table === x.table && y.from === x.name) {
      reasons.push(`column ${spot} was dropped on one side and renamed to "${y.to}" on the other`);
    }
    if (y.kind === "column-changed" && y.table === x.table && y.column === x.name) {
      reasons.push(`column ${spot} was dropped on one side and changed on the other`);
    }
    if (
      y.kind === "primary-key-changed" &&
      y.table === x.table &&
      y.to?.includes(x.name)
    ) {
      reasons.push(`the new primary key of "${x.table}" includes ${spot}, which the other side dropped`);
    }
    if (
      fkAdditions(y).some(
        (fk) =>
          (fk.refTable === x.table && fk.refColumn === x.name) ||
          (fk.ownTable === x.table && fk.ownColumn === x.name),
      )
    ) {
      reasons.push(`a new foreign key uses column ${spot}, which the other side dropped`);
    }
  }

  if (x.kind === "column-changed") {
    const spot = `"${x.table}.${x.column}"`;
    const retyped = propertyChange(x, "type");
    if (retyped) {
      // Conservative on purpose: a new FK next to a retyped column is
      // worth a human look even in the rare case the types still line
      // up — applying both blindly risks a type-mismatched reference.
      if (
        fkAdditions(y).some(
          (fk) =>
            (fk.refTable === x.table && fk.refColumn === x.column) ||
            (fk.ownTable === x.table && fk.ownColumn === x.column),
        )
      ) {
        reasons.push(
          `column ${spot} was retyped on one side while the other added a foreign key using it`,
        );
      }
    }
    const nullableChange = propertyChange(x, "nullable");
    if (
      nullableChange?.to === true &&
      y.kind === "primary-key-changed" &&
      y.table === x.table &&
      y.to?.includes(x.column)
    ) {
      reasons.push(
        `${spot} became nullable on one side and part of the primary key on the other`,
      );
    }
    const uniqueChange = propertyChange(x, "unique");
    if (uniqueChange?.to === false) {
      const stillJustified =
        isSoleBasePk(ctx.base, x.table, x.column) &&
        !ctx.pkChangedTables.has(x.table);
      if (
        !stillJustified &&
        fkAdditions(y).some(
          (fk) => fk.refTable === x.table && fk.refColumn === x.column,
        )
      ) {
        reasons.push(
          `the unique constraint on ${spot} was removed on one side while the other added a foreign key targeting it`,
        );
      }
    }
  }

  if (x.kind === "primary-key-changed") {
    for (const fk of fkAdditions(y)) {
      if (fk.refTable !== x.table) continue;
      const keepsSole = x.to?.length === 1 && x.to[0] === fk.refColumn;
      const uniqueInstead =
        isBaseUnique(ctx.base, fk.refTable, fk.refColumn) &&
        !ctx.uniqueRemoved.has(`${fk.refTable}.${fk.refColumn}`);
      if (!keepsSole && !uniqueInstead) {
        reasons.push(
          `the primary key of "${x.table}" changed on one side while the other added a foreign key relying on "${fk.refTable}.${fk.refColumn}" being unique`,
        );
      }
    }
  }

  return reasons;
}

/** Collisions with no leading side — both did the same kind of thing
 *  to the same thing, differently. Called once per pair. Reasons list
 *  disputed values in sorted order so swapping the merge's sides
 *  produces identical wording — which side holds which value is the
 *  conflict object's job, not the sentence's.
 *
 *  Name collisions only ever pair renames and additions: an added or
 *  renamed-to name can never equal a base name, because diffSchemas
 *  matches same-name objects instead of reporting a drop plus an add.
 */
function symmetricCollisions(a: SchemaChange, b: SchemaChange, ctx: CollideContext): string[] {
  const reasons: string[] = [];
  const pair = (x: unknown, y: unknown) =>
    [describeValue(x), describeValue(y)].sort().join(" vs ");

  if (a.kind === "table-renamed" && b.kind === "table-renamed") {
    if (a.from === b.from && a.to !== b.to) {
      reasons.push(
        `table "${a.from}" was renamed differently on each side (${pair(a.to, b.to)})`,
      );
    }
    if (a.from !== b.from && a.to === b.to) {
      reasons.push(
        `both sides renamed a table to "${a.to}" (${pair(a.from, b.from)})`,
      );
    }
  }
  for (const [rename, added] of [
    [a, b],
    [b, a],
  ] as const) {
    if (
      rename.kind === "table-renamed" &&
      added.kind === "table-added" &&
      added.table.name === rename.to
    ) {
      reasons.push(
        `one side renamed table "${rename.from}" to "${rename.to}" while the other added a new table "${added.table.name}"`,
      );
    }
  }
  if (
    a.kind === "table-added" &&
    b.kind === "table-added" &&
    a.table.name === b.table.name
  ) {
    reasons.push(
      `both sides added a table named "${a.table.name}" with different definitions`,
    );
  }

  if (
    a.kind === "column-renamed" &&
    b.kind === "column-renamed" &&
    a.table === b.table
  ) {
    if (a.from === b.from && a.to !== b.to) {
      reasons.push(
        `column "${a.table}.${a.from}" was renamed differently on each side (${pair(a.to, b.to)})`,
      );
    }
    if (a.from !== b.from && a.to === b.to) {
      reasons.push(
        `both sides renamed a column in "${a.table}" to "${a.to}" (${pair(a.from, b.from)})`,
      );
    }
  }
  for (const [rename, added] of [
    [a, b],
    [b, a],
  ] as const) {
    if (
      rename.kind === "column-renamed" &&
      added.kind === "column-added" &&
      added.table === rename.table &&
      added.column.name === rename.to
    ) {
      reasons.push(
        `one side renamed column "${rename.table}.${rename.from}" to "${rename.to}" while the other added a new column with that name`,
      );
    }
  }
  if (
    a.kind === "column-added" &&
    b.kind === "column-added" &&
    a.table === b.table &&
    a.column.name === b.column.name
  ) {
    reasons.push(
      `both sides added a column "${a.table}.${a.column.name}" with different definitions`,
    );
  }

  if (
    a.kind === "column-changed" &&
    b.kind === "column-changed" &&
    a.table === b.table &&
    a.column === b.column
  ) {
    const spot = `"${a.table}.${a.column}"`;
    for (const pa of a.changes) {
      const pb = b.changes.find((p) => p.property === pa.property);
      if (pb && pa.to !== pb.to) {
        reasons.push(
          `both sides changed ${pa.property} of ${spot} (${pair(pa.to, pb.to)})`,
        );
      }
    }
    // The one cross-property rule in the model: a length limit only
    // exists on text. Composing both sides must not strand one.
    const composed = composeColumn(ctx.base, a, b);
    if (composed && composed.maxLength !== undefined && composed.type !== "text") {
      reasons.push(
        `one side made ${spot} no longer text while the other gave it a length limit — a length only applies to text`,
      );
    }
  }

  if (
    a.kind === "primary-key-changed" &&
    b.kind === "primary-key-changed" &&
    a.table === b.table
  ) {
    reasons.push(`both sides changed the primary key of "${a.table}" differently`);
  }

  if (
    a.kind === "foreign-key-added" &&
    b.kind === "foreign-key-added" &&
    a.table === b.table &&
    a.foreignKey.column === b.foreignKey.column
  ) {
    reasons.push(
      `both sides added a different foreign key on "${a.table}.${a.foreignKey.column}"`,
    );
  }

  return reasons;
}

/** What the column looks like with both sides' property changes
 *  applied to the base column. Null when the base column is missing
 *  (can't happen for a well-formed diff; guarded anyway). */
function composeColumn(
  base: Schema,
  a: Extract<SchemaChange, { kind: "column-changed" }>,
  b: Extract<SchemaChange, { kind: "column-changed" }>,
): Column | null {
  const table = findTable(base, a.table);
  const column = table ? findColumn(table, a.column) : undefined;
  if (!column) return null;
  const composed: Column = { ...column };
  for (const p of [...a.changes, ...b.changes]) {
    if (p.property === "type") composed.type = p.to as Column["type"];
    else if (p.property === "nullable") composed.nullable = p.to as boolean;
    else if (p.property === "unique") {
      if (p.to === true) composed.unique = true;
      else delete composed.unique;
    } else if (p.to === undefined) delete composed.maxLength;
    else composed.maxLength = p.to as number;
  }
  return composed;
}

function describeValue(value: unknown): string {
  if (value === undefined) return "none";
  return JSON.stringify(value);
}

/** Stable, side-order-independent id component for a change. */
function topicKey(change: SchemaChange): string {
  switch (change.kind) {
    case "table-added":
      return `table:${change.table.name}`;
    case "table-dropped":
      return `table:${change.name}`;
    case "table-renamed":
      return `table:${change.from}`;
    case "column-added":
      return `column:${change.table}.${change.column.name}`;
    case "column-dropped":
      return `column:${change.table}.${change.name}`;
    case "column-renamed":
      return `column:${change.table}.${change.from}`;
    case "column-changed":
      return `column:${change.table}.${change.column}`;
    case "primary-key-changed":
      return `pk:${change.table}`;
    case "foreign-key-added":
    case "foreign-key-dropped":
      return `fk:${change.table}.${change.foreignKey.column}->${change.foreignKey.references.table}.${change.foreignKey.references.column}`;
  }
}

function detectConflicts(
  ours: SchemaChange[],
  theirs: SchemaChange[],
  base: Schema,
): MergeConflict[] {
  const ctx: CollideContext = {
    base,
    pkChangedTables: new Set(),
    uniqueRemoved: new Set(),
  };
  for (const change of [...ours, ...theirs]) {
    if (change.kind === "primary-key-changed") {
      ctx.pkChangedTables.add(change.table);
    }
    if (
      change.kind === "column-changed" &&
      change.changes.some((p) => p.property === "unique" && p.to === false)
    ) {
      ctx.uniqueRemoved.add(`${change.table}.${change.column}`);
    }
  }

  const nodes: TaggedChange[] = [
    ...ours.map((change) => ({ side: "ours" as const, change })),
    ...theirs.map((change) => ({ side: "theirs" as const, change })),
  ];

  // Union-find over node indices; edges carry their reasons.
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (i: number, j: number) => {
    parent[find(i)] = find(j);
  };

  const pairReasons = new Map<string, string[]>();
  for (let i = 0; i < ours.length; i++) {
    for (let j = 0; j < theirs.length; j++) {
      const x = ours[i]!;
      const y = theirs[j]!;
      const reasons = [
        ...directionalCollisions(x, y, ctx),
        ...directionalCollisions(y, x, ctx),
        ...symmetricCollisions(x, y, ctx),
      ];
      if (reasons.length > 0) {
        union(i, ours.length + j);
        pairReasons.set(`${i}:${j}`, reasons);
      }
    }
  }

  // Group edge-connected nodes into conflicts.
  const groups = new Map<number, { ours: SchemaChange[]; theirs: SchemaChange[]; reasons: string[] }>();
  for (const [pair, reasons] of pairReasons) {
    const root = find(Number(pair.split(":")[0]));
    let group = groups.get(root);
    if (!group) groups.set(root, (group = { ours: [], theirs: [], reasons: [] }));
    group.reasons.push(...reasons);
  }
  nodes.forEach((node, i) => {
    const group = groups.get(find(i));
    if (group) group[node.side].push(node.change);
  });

  const conflicts = [...groups.values()].map((group) => {
    const keys = [...new Set([...group.ours, ...group.theirs].map(topicKey))].sort();
    return {
      id: keys.join("+"),
      ours: group.ours,
      theirs: group.theirs,
      reasons: [...new Set(group.reasons)],
    };
  });
  conflicts.sort((a, b) => a.id.localeCompare(b.id));
  return conflicts;
}

// --- building the merged schema -------------------------------------------

function buildMerged(
  base: Schema,
  oursCanonical: SchemaChange[],
  theirsCanonical: SchemaChange[],
  agreedTheirs: Set<number>,
  conflicts: MergeConflict[],
  resolutions: MergeResolution[],
): Schema | null {
  const chosen = new Map(resolutions.map((r) => [r.id, r.choose]));
  const losers = new Set<SchemaChange>();
  for (const conflict of conflicts) {
    const pick = chosen.get(conflict.id);
    if (!pick) return null; // unresolved — no merged schema yet
    for (const change of pick === "ours" ? conflict.theirs : conflict.ours) {
      losers.add(change);
    }
  }

  // Agreed changes ride in the ours list (they sit earliest there, so
  // anything either side built on top of them comes later).
  const oursKept = oursCanonical.filter((c) => !losers.has(c));
  const theirsKept = theirsCanonical.filter(
    (c, i) => !agreedTheirs.has(i) && !losers.has(c),
  );

  // Replay order: column renames, then table renames (both in each
  // side's own recipe order — a side may reuse a name it just vacated),
  // then everything else respelled through the combined rename maps so
  // each side's changes land on objects the other side renamed.
  const isColumnRename = (c: SchemaChange) => c.kind === "column-renamed";
  const isTableRename = (c: SchemaChange) => c.kind === "table-renamed";
  const renames = [
    ...oursKept.filter(isColumnRename),
    ...theirsKept.filter(isColumnRename),
    ...oursKept.filter(isTableRename),
    ...theirsKept.filter(isTableRename),
  ];

  const tableFinal = new Map<string, string>();
  const columnFinal = new Map<string, Map<string, string>>();
  for (const change of renames) {
    if (change.kind === "table-renamed") {
      tableFinal.set(change.from, change.to);
    } else if (change.kind === "column-renamed") {
      let map = columnFinal.get(change.table);
      if (!map) columnFinal.set(change.table, (map = new Map()));
      map.set(change.from, change.to);
    }
  }
  const table: TableMap = (name) => tableFinal.get(name) ?? name;
  const column: ColumnMap = (t, c) => columnFinal.get(t)?.get(c) ?? c;

  const rest = [
    ...oursKept.filter((c) => !isColumnRename(c) && !isTableRename(c)),
    ...theirsKept.filter((c) => !isColumnRename(c) && !isTableRename(c)),
  ].map((c) => respellChange(c, table, column));

  const merged = applyDiff(base, [...renames, ...rest]);

  const checked = validateSchema(merged);
  if (!checked.ok) {
    // Every invalid combination is supposed to be caught as a conflict
    // above; reaching this line is an engine bug, and handing back a
    // broken schema would be worse than failing loudly.
    throw new Error(
      `mergeSchemas produced an invalid schema — this is a bug in conflict detection: ${checked.errors.join("; ")}`,
    );
  }
  return checked.schema;
}
