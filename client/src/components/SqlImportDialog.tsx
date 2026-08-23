import { useState } from "react";
import { importPostgresSql, type Schema, type SqlImportResult } from "engine";

// SQL front door (decisions.md #8): paste Postgres DDL (or pick a
// .sql file), preview what the importer read, then accept. Preview is
// deliberately a separate step — the skip list must be seen before
// the import lands, so editing the text clears any previous preview
// and the Import button only arms after a fresh one.

const KIND_LABELS: Record<string, string> = {
  "skipped-column": "Columns skipped",
  "skipped-constraint": "Keys and constraints skipped",
  "skipped-statement": "Statements skipped",
  "dropped-detail": "Details dropped (their columns still imported)",
};

export function SqlImportDialog({
  onImport,
  onClose,
}: {
  onImport: (schema: Schema) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<SqlImportResult | null>(null);

  function pickFile(file: File | undefined) {
    if (!file) return;
    file.text().then((content) => {
      setText(content);
      setPreview(null);
    });
  }

  function runPreview() {
    setPreview(importPostgresSql(text));
  }

  const ready = preview?.ok === true && preview.tableCount > 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-label="Import schema from SQL"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>
          Import schema from SQL <span className="badge-tag">Postgres</span>
        </h2>
        <p className="dialog-hint">
          Paste Postgres <code>CREATE TABLE</code> statements — or a whole{" "}
          <code>pg_dump --schema-only</code> file. Preview shows what will be
          imported and lists anything skipped before you accept. The current
          schema is replaced — undo brings it back.
        </p>
        <textarea
          className="json"
          value={text}
          placeholder={"CREATE TABLE users (\n  id serial PRIMARY KEY,\n  email varchar(255) UNIQUE NOT NULL\n);"}
          aria-label="SQL to import"
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
        />
        <label className="file-pick">
          …or choose a file:{" "}
          <input
            type="file"
            accept=".sql,text/plain"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </label>

        {preview && <PreviewReport result={preview} />}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            onClick={runPreview}
            disabled={text.trim() === ""}
          >
            Preview import
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!ready}
            title={
              ready
                ? undefined
                : "Run Preview first — importing is enabled once there's something to bring in"
            }
            onClick={() => {
              if (preview?.ok && preview.tableCount > 0) onImport(preview.schema);
            }}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewReport({ result }: { result: SqlImportResult }) {
  if (!result.ok) {
    // The importer only emits what the validator accepts, so this is
    // a genuine bug surface — show it honestly rather than hiding it.
    return (
      <div className="import-errors" role="alert">
        <p>The imported schema didn’t pass validation — this shouldn’t happen:</p>
        <ul>
          {result.errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (result.tableCount === 0) {
    return (
      <div className="sql-preview" role="status">
        <p className="sql-preview-none">
          No tables found — nothing CREATE TABLE–shaped in this paste.
        </p>
        <IssueGroups issues={result.issues} />
      </div>
    );
  }

  return (
    <div className="sql-preview" role="status">
      <p className="sql-preview-ready">
        Ready: {result.tableCount} table{result.tableCount === 1 ? "" : "s"},{" "}
        {result.columnCount} column{result.columnCount === 1 ? "" : "s"}.
        {result.issues.length === 0 && " Everything in the paste was read."}
      </p>
      <IssueGroups issues={result.issues} />
    </div>
  );
}

function IssueGroups({ issues }: { issues: SqlImportResult["issues"] }) {
  if (issues.length === 0) return null;
  const order = Object.keys(KIND_LABELS);
  const groups = order
    .map((kind) => ({
      kind,
      label: KIND_LABELS[kind],
      items: issues.filter((i) => i.kind === kind),
    }))
    .filter((g) => g.items.length > 0);
  return (
    <div className="sql-issues">
      {groups.map((g) => (
        <section key={g.kind}>
          <h3>
            {g.label} ({g.items.length})
          </h3>
          <ul>
            {g.items.map((i, idx) => (
              <li key={`${i.what}-${idx}`}>
                <strong>{i.what}</strong> — {i.why}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
