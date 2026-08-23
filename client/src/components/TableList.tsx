import { useState } from "react";
import type { Schema } from "engine";
import { addTable, tableNameProblem } from "../schema/edits.ts";

// Names offered on an empty schema, so the first table is one click
// away. Only shown while there are no tables, so they can never
// collide with an existing name.
const SUGGESTED_TABLES = ["users", "products", "orders"];

export function TableList({
  schema,
  selected,
  onSelect,
  onApply,
}: {
  schema: Schema;
  selected: string | null;
  onSelect: (name: string) => void;
  onApply: (schema: Schema) => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const name = draft.trim();
    const issue = tableNameProblem(schema, name);
    if (issue) {
      setError(issue);
      return;
    }
    onApply(addTable(schema, name).schema);
    onSelect(name);
    setDraft("");
    setError(null);
  }

  const empty = schema.tables.length === 0;

  return (
    <nav className="sidebar" aria-label="Tables">
      <h2 className="sidebar-title">
        Tables
        <span className="sidebar-count">{schema.tables.length}</span>
      </h2>
      {empty ? (
        <p className="empty empty--sidebar">
          No tables yet. Every schema starts with one — add it below.
        </p>
      ) : (
        <ul className="table-list">
          {schema.tables.map((table) => (
            <li key={table.name}>
              <button
                type="button"
                className={table.name === selected ? "selected" : ""}
                onClick={() => onSelect(table.name)}
              >
                <span className="table-list-tick" aria-hidden="true" />
                <span className="table-list-name">{table.name}</span>
                <span className="table-list-count">
                  {table.columns.length}{" "}
                  {table.columns.length === 1 ? "column" : "columns"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="add-form add-form--card"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={draft}
          placeholder="New table name"
          aria-label="New table name"
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
        />
        <button
          type="submit"
          className={empty ? "btn btn--primary btn--block" : "btn btn--fill btn--block"}
          disabled={draft.trim() === ""}
        >
          Add table
        </button>
        {error && <span className="field-error">{error}</span>}
      </form>
      {empty && (
        <div className="starters">
          <h3 className="sidebar-title sidebar-title--sub">Suggested starters</h3>
          <ul className="starter-list">
            {SUGGESTED_TABLES.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  className="starter"
                  onClick={() => {
                    onApply(addTable(schema, name).schema);
                    onSelect(name);
                  }}
                >
                  <span className="starter-plus" aria-hidden="true">
                    +
                  </span>
                  <span className="starter-name">{name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
