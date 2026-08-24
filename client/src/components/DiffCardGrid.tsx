import type { ReactNode } from "react";
import type { SchemaChange, Table } from "engine";
import {
  describePropertyChange,
  formatColumn,
  formatForeignKey,
  formatPrimaryKey,
  type TableCard,
} from "../diff/view-model.ts";

// The card grid alone — no header, no rename questions, no layout
// opinions. The diff view wraps one of these; the day-3 merge view
// composes two side by side, which is why this stays a dumb renderer.

export function DiffCardGrid({
  cards,
  unchanged,
}: {
  cards: TableCard[];
  unchanged: string[];
}) {
  return (
    <>
      <div className="diff-grid">
        {cards.map((card) => (
          <DiffCard key={`${card.status}:${card.name}`} card={card} />
        ))}
      </div>
      {unchanged.length > 0 && (
        <p className="diff-unchanged">
          Unchanged: {unchanged.join(", ")}
        </p>
      )}
    </>
  );
}

/** Exported so the merge timeline can place one card per side of a
 *  rung; the grid above is just many of these in a wrapper. */
export function DiffCard({
  card,
  badge,
}: {
  card: TableCard;
  /** Extra pill after the status badge — the merge view's CONFLICT. */
  badge?: ReactNode;
}) {
  return (
    <section className={`diff-card diff-card--${card.status}`}>
      <header className="diff-card-head">
        <span className="diff-card-name">{card.name}</span>
        {card.status !== "changed" && (
          <span className={`diff-badge diff-badge--${card.status}`}>
            {card.status}
          </span>
        )}
        {badge}
        {card.renamedFrom && (
          <>
            <span className="diff-badge diff-badge--renamed">renamed</span>
            <span className="diff-card-was">was {card.renamedFrom}</span>
          </>
        )}
      </header>
      {card.status === "changed" ? (
        card.changes.length > 0 ? (
          <ul className="diff-lines">
            {card.changes.map((change, i) => (
              <ChangeLine key={i} change={change} />
            ))}
          </ul>
        ) : (
          <p className="diff-card-note">Renamed only — contents unchanged.</p>
        )
      ) : (
        card.table && <WholeTable table={card.table} status={card.status} />
      )}
    </section>
  );
}

/** Every line of an added or dropped table, uniformly marked. */
function WholeTable({ table, status }: { table: Table; status: "added" | "dropped" }) {
  const mark = status === "added" ? "+" : "−";
  const lineClass = `diff-line diff-line--${status}`;
  return table.columns.length === 0 && !table.primaryKey ? (
    <p className="diff-card-note">No columns.</p>
  ) : (
    <ul className="diff-lines">
      {table.columns.map((column) => (
        <li key={column.name} className={lineClass}>
          <span className="diff-mark" aria-hidden="true">{mark}</span>
          <span className="diff-line-body">
            <code>{column.name}</code>{" "}
            <span className="diff-line-detail">{formatColumn(column)}</span>
          </span>
        </li>
      ))}
      {table.primaryKey && (
        <li className={lineClass}>
          <span className="diff-mark" aria-hidden="true">{mark}</span>
          <span className="diff-line-body">
            Primary key: {formatPrimaryKey(table.primaryKey)}
          </span>
        </li>
      )}
      {(table.foreignKeys ?? []).map((fk) => (
        <li key={formatForeignKey(fk)} className={lineClass}>
          <span className="diff-mark" aria-hidden="true">{mark}</span>
          <span className="diff-line-body">
            Foreign key <code>{formatForeignKey(fk)}</code>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ChangeLine({ change }: { change: SchemaChange }) {
  switch (change.kind) {
    case "column-added":
      return (
        <li className="diff-line diff-line--added">
          <span className="diff-mark" aria-hidden="true">+</span>
          <span className="diff-line-body">
            <code>{change.column.name}</code>{" "}
            <span className="diff-line-detail">{formatColumn(change.column)}</span>
          </span>
        </li>
      );
    case "column-dropped":
      return (
        <li className="diff-line diff-line--dropped">
          <span className="diff-mark" aria-hidden="true">−</span>
          <span className="diff-line-body">
            <code>{change.name}</code>
          </span>
        </li>
      );
    case "column-renamed":
      return (
        <li className="diff-line diff-line--renamed">
          <span className="diff-mark" aria-hidden="true">→</span>
          <span className="diff-line-body">
            <code>{change.from}</code> <span aria-hidden="true">→</span>{" "}
            <code>{change.to}</code>{" "}
            <span className="diff-line-detail">renamed</span>
          </span>
        </li>
      );
    case "column-changed":
      return (
        <li className="diff-line diff-line--changed">
          <span className="diff-mark" aria-hidden="true">±</span>
          <span className="diff-line-body">
            <code>{change.column}</code>{" "}
            <span className="diff-line-detail">
              {change.changes.map(describePropertyChange).join(" · ")}
            </span>
          </span>
        </li>
      );
    case "primary-key-changed":
      return (
        <li className="diff-line diff-line--changed">
          <span className="diff-mark" aria-hidden="true">±</span>
          <span className="diff-line-body">
            Primary key: {formatPrimaryKey(change.from)} →{" "}
            {formatPrimaryKey(change.to)}
          </span>
        </li>
      );
    case "foreign-key-added":
      return (
        <li className="diff-line diff-line--added">
          <span className="diff-mark" aria-hidden="true">+</span>
          <span className="diff-line-body">
            Foreign key <code>{formatForeignKey(change.foreignKey)}</code>
          </span>
        </li>
      );
    case "foreign-key-dropped":
      return (
        <li className="diff-line diff-line--dropped">
          <span className="diff-mark" aria-hidden="true">−</span>
          <span className="diff-line-body">
            Foreign key <code>{formatForeignKey(change.foreignKey)}</code>
          </span>
        </li>
      );
    default:
      // Table-level kinds are lifted onto the card itself, never lines.
      return null;
  }
}
