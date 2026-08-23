import { useEffect, useState } from "react";
import {
  COLUMN_TYPES,
  COLUMN_TYPE_IDS,
  findColumn,
  type ColumnType,
  type Schema,
  type Table,
} from "engine";
import {
  addColumn,
  addForeignKey,
  columnNameProblem,
  deleteColumn,
  deleteTable,
  removeForeignKey,
  renameColumn,
  setColumnMaxLength,
  setColumnNullable,
  setColumnType,
  setColumnUnique,
  setPrimaryKeyMembership,
  tableNameProblem,
  validFkTargets,
  type EditResult,
} from "../schema/edits.ts";
import { NameField } from "./NameField.tsx";

export interface EditRequest {
  result: EditResult;
  /** Dialog title when the edit has collateral. */
  confirmTitle?: string;
  /** Toast shown after the edit applies. */
  toast?: string;
}

export function TableEditor({
  schema,
  table,
  onEdit,
  onRenameTable,
}: {
  schema: Schema;
  table: Table;
  onEdit: (request: EditRequest) => void;
  onRenameTable: (oldName: string, newName: string) => void;
}) {
  const inPk = (name: string) => table.primaryKey?.includes(name) ?? false;

  return (
    <section className="table-editor" aria-label={`Table ${table.name}`}>
      <header className="table-editor-head">
        <div className="table-editor-title">
          <NameField
            className="table-name"
            value={table.name}
            ariaLabel="Table name"
            problem={(name) => tableNameProblem(schema, name, table.name)}
            onCommit={(name) => onRenameTable(table.name, name)}
          />
          <span className="column-count">
            {table.columns.length}{" "}
            {table.columns.length === 1 ? "column" : "columns"}
          </span>
        </div>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() =>
            onEdit({
              result: deleteTable(schema, table.name),
              confirmTitle: `Delete table "${table.name}"?`,
              toast: `Deleted table "${table.name}"`,
            })
          }
        >
          Delete table
        </button>
      </header>

      {table.columns.length === 0 ? (
        <p className="empty">No columns yet — add the first one below.</p>
      ) : (
        <div className="columns-panel">
          <table className="columns-table">
            <thead>
              <tr>
                <th>Column</th>
                <th>Type</th>
                <th title="Primary key">PK</th>
                <th title="Allows empty (NULL) values">Nullable</th>
                <th title="Every row must have a distinct value">Unique</th>
                <th>Max length</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {table.columns.map((column) => (
                <tr key={column.name}>
                  <td>
                    <NameField
                      value={column.name}
                      ariaLabel={`Name of column ${column.name}`}
                      problem={(name) => columnNameProblem(table, name, column.name)}
                      onCommit={(name) =>
                        onEdit({
                          result: renameColumn(schema, table.name, column.name, name),
                        })
                      }
                    />
                  </td>
                  <td>
                    <select
                      value={column.type}
                      aria-label={`Type of column ${column.name}`}
                      onChange={(e) =>
                        onEdit({
                          result: setColumnType(
                            schema,
                            table.name,
                            column.name,
                            e.target.value as ColumnType,
                          ),
                          confirmTitle: `Change the type of "${table.name}.${column.name}"?`,
                        })
                      }
                    >
                      {COLUMN_TYPE_IDS.map((id) => (
                        <option key={id} value={id}>
                          {COLUMN_TYPES[id]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="cell-center">
                    <input
                      type="checkbox"
                      checked={inPk(column.name)}
                      disabled={column.nullable}
                      title={
                        column.nullable
                          ? "Nullable columns can't be in the primary key"
                          : undefined
                      }
                      aria-label={`${column.name} in primary key`}
                      onChange={(e) =>
                        onEdit({
                          result: setPrimaryKeyMembership(
                            schema,
                            table.name,
                            column.name,
                            e.target.checked,
                          ),
                          confirmTitle: `Change the primary key of "${table.name}"?`,
                        })
                      }
                    />
                  </td>
                  <td className="cell-center">
                    <input
                      type="checkbox"
                      checked={column.nullable}
                      disabled={inPk(column.name)}
                      title={
                        inPk(column.name)
                          ? "Primary-key columns can't be nullable"
                          : undefined
                      }
                      aria-label={`${column.name} nullable`}
                      onChange={(e) =>
                        onEdit({
                          result: setColumnNullable(
                            schema,
                            table.name,
                            column.name,
                            e.target.checked,
                          ),
                        })
                      }
                    />
                  </td>
                  <td className="cell-center">
                    <input
                      type="checkbox"
                      checked={column.unique === true}
                      aria-label={`${column.name} unique`}
                      onChange={(e) =>
                        onEdit({
                          result: setColumnUnique(
                            schema,
                            table.name,
                            column.name,
                            e.target.checked,
                          ),
                          confirmTitle: `Remove unique from "${table.name}.${column.name}"?`,
                        })
                      }
                    />
                  </td>
                  <td>
                    {column.type === "text" ? (
                      <LengthField
                        value={column.maxLength}
                        ariaLabel={`Max length of ${column.name}`}
                        onCommit={(len) =>
                          onEdit({
                            result: setColumnMaxLength(
                              schema,
                              table.name,
                              column.name,
                              len,
                            ),
                          })
                        }
                      />
                    ) : (
                      <span className="cell-muted">—</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--ghost-danger"
                      aria-label={`Delete column ${column.name}`}
                      onClick={() =>
                        onEdit({
                          result: deleteColumn(schema, table.name, column.name),
                          confirmTitle: `Delete column "${table.name}.${column.name}"?`,
                          toast: `Deleted column "${table.name}.${column.name}"`,
                        })
                      }
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="columns-foot">
        <p className="pk-summary">
          Primary key:{" "}
          {table.primaryKey ? (
            <strong>{table.primaryKey.join(" + ")}</strong>
          ) : (
            <span className="cell-muted">none — tick PK on a column</span>
          )}
        </p>

        <AddColumnForm table={table} schema={schema} onEdit={onEdit} />
      </div>

      <ForeignKeySection schema={schema} table={table} onEdit={onEdit} />
    </section>
  );
}

// Commit-on-blur number input; empty means "no limit".
function LengthField({
  value,
  ariaLabel,
  onCommit,
}: {
  value: number | undefined;
  ariaLabel: string;
  onCommit: (next: number | undefined) => void;
}) {
  const [draft, setDraft] = useState(value?.toString() ?? "");
  useEffect(() => {
    setDraft(value?.toString() ?? "");
  }, [value]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (value !== undefined) onCommit(undefined);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setDraft(value?.toString() ?? "");
      return;
    }
    if (parsed !== value) onCommit(parsed);
  }

  return (
    <input
      className="length-field"
      inputMode="numeric"
      placeholder="no limit"
      value={draft}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value?.toString() ?? "");
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function AddColumnForm({
  schema,
  table,
  onEdit,
}: {
  schema: Schema;
  table: Table;
  onEdit: (request: EditRequest) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ColumnType>("text");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const trimmed = name.trim();
    const issue = columnNameProblem(table, trimmed);
    if (issue) {
      setError(issue);
      return;
    }
    onEdit({ result: addColumn(schema, table.name, trimmed, type) });
    setName("");
    setError(null);
  }

  return (
    <form
      className="add-form add-form--row"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        value={name}
        placeholder="New column name"
        aria-label="New column name"
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
      />
      <select
        value={type}
        aria-label="New column type"
        onChange={(e) => setType(e.target.value as ColumnType)}
      >
        {COLUMN_TYPE_IDS.map((id) => (
          <option key={id} value={id}>
            {COLUMN_TYPES[id]}
          </option>
        ))}
      </select>
      <button type="submit" className="btn" disabled={name.trim() === ""}>
        Add column
      </button>
      {error && <span className="field-error">{error}</span>}
    </form>
  );
}

function ForeignKeySection({
  schema,
  table,
  onEdit,
}: {
  schema: Schema;
  table: Table;
  onEdit: (request: EditRequest) => void;
}) {
  const [ownColumn, setOwnColumn] = useState("");
  const chosen =
    findColumn(table, ownColumn) ??
    (table.columns.length > 0 ? table.columns[0] : undefined);
  const targets = chosen ? validFkTargets(schema, chosen.type) : [];
  const [targetIndex, setTargetIndex] = useState(0);
  const target = targets[Math.min(targetIndex, Math.max(targets.length - 1, 0))];

  const duplicate =
    chosen !== undefined &&
    target !== undefined &&
    (table.foreignKeys ?? []).some(
      (fk) =>
        fk.column === chosen.name &&
        fk.references.table === target.table &&
        fk.references.column === target.column,
    );

  return (
    <section className="fk-section">
      <h3>Foreign keys</h3>
      {(table.foreignKeys ?? []).length === 0 ? (
        <p className="empty">
          No foreign keys. A foreign key says every value in one of this
          table’s columns must exist in a unique column of some table.
        </p>
      ) : (
        <ul className="fk-list">
          {(table.foreignKeys ?? []).map((fk, i) => (
            <li key={`${fk.column}→${fk.references.table}.${fk.references.column}`}>
              <code>
                {table.name}.{fk.column} → {fk.references.table}.
                {fk.references.column}
              </code>
              <button
                type="button"
                className="btn btn--ghost-danger"
                aria-label={`Remove foreign key on ${fk.column}`}
                onClick={() =>
                  onEdit({
                    result: removeForeignKey(schema, table.name, i),
                    toast: `Removed foreign key ${table.name}.${fk.column} → ${fk.references.table}.${fk.references.column}`,
                  })
                }
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {table.columns.length > 0 && chosen && (
        <form
          className="add-form add-form--row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!target || duplicate) return;
            onEdit({
              result: addForeignKey(schema, table.name, {
                column: chosen.name,
                references: { table: target.table, column: target.column },
              }),
            });
          }}
        >
          <select
            value={chosen.name}
            aria-label="Foreign key column"
            onChange={(e) => {
              setOwnColumn(e.target.value);
              setTargetIndex(0);
            }}
          >
            {table.columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="fk-arrow">→</span>
          {targets.length === 0 ? (
            <span className="cell-muted fk-no-target">
              no valid target — needs a column of type “{COLUMN_TYPES[chosen.type]}”
              (or its auto-number twin) that is unique on its own
              (single-column primary key, or marked unique)
            </span>
          ) : (
            <>
              <select
                value={targetIndex}
                aria-label="Foreign key target"
                onChange={(e) => setTargetIndex(Number(e.target.value))}
              >
                {targets.map((t, i) => (
                  <option key={`${t.table}.${t.column}`} value={i}>
                    {t.table}.{t.column}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn" disabled={duplicate}>
                Add foreign key
              </button>
              {duplicate && (
                <span className="field-error">This foreign key already exists.</span>
              )}
            </>
          )}
        </form>
      )}
    </section>
  );
}
