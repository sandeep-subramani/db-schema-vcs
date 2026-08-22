import { useState } from "react";
import type { Schema } from "engine";
import { addTable, tableNameProblem } from "../schema/edits.ts";

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

  return (
    <nav className="sidebar" aria-label="Tables">
      <h2 className="sidebar-title">Tables</h2>
      {schema.tables.length === 0 ? (
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
        className="add-form"
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
        <button type="submit" className="btn" disabled={draft.trim() === ""}>
          Add table
        </button>
        {error && <span className="field-error">{error}</span>}
      </form>
    </nav>
  );
}
