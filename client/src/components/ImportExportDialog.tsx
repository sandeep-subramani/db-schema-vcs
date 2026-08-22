import { useState } from "react";
import { validateSchema, type Schema } from "engine";

// JSON side door (decisions.md #4). Export shows the exact snapshot
// format the engine stores; import runs the same validateSchema gate
// the API will use, so a bad paste produces the validator's
// human-readable errors instead of a broken editor.
export function ImportExportDialog({
  mode,
  schema,
  onImport,
  onClose,
}: {
  mode: "import" | "export";
  schema: Schema;
  onImport: (schema: Schema) => void;
  onClose: () => void;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "import" ? "Import schema JSON" : "Export schema JSON"}
        onClick={(e) => e.stopPropagation()}
      >
        {mode === "export" ? (
          <ExportPane schema={schema} onClose={onClose} />
        ) : (
          <ImportPane onImport={onImport} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function ExportPane({ schema, onClose }: { schema: Schema; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(schema, null, 2);

  function copy() {
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function download() {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "schema.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <h2>Export schema as JSON</h2>
      <p className="dialog-hint">
        This is the exact format import accepts — a snapshot of every table,
        column, and constraint.
      </p>
      <textarea className="json" readOnly value={json} aria-label="Schema JSON" />
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn" onClick={download}>
          Download schema.json
        </button>
        <button type="button" className="btn btn--primary" onClick={copy}>
          {copied ? "Copied ✓" : "Copy to clipboard"}
        </button>
      </div>
    </>
  );
}

function ImportPane({
  onImport,
  onClose,
}: {
  onImport: (schema: Schema) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  function pickFile(file: File | undefined) {
    if (!file) return;
    file.text().then(setText);
  }

  function runImport() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setErrors([`That isn't valid JSON: ${e instanceof Error ? e.message : String(e)}`]);
      return;
    }
    const result = validateSchema(parsed);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    onImport(result.schema);
  }

  return (
    <>
      <h2>Import schema from JSON</h2>
      <p className="dialog-hint">
        Paste JSON in the format Export produces (or pick a file). The current
        schema is replaced — undo brings it back.
      </p>
      <textarea
        className="json"
        value={text}
        placeholder='{ "tables": [ ... ] }'
        aria-label="Schema JSON to import"
        onChange={(e) => {
          setText(e.target.value);
          setErrors([]);
        }}
      />
      <label className="file-pick">
        …or choose a file:{" "}
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
      </label>
      {errors.length > 0 && (
        <div className="import-errors" role="alert">
          <p>Can’t import this yet:</p>
          <ul>
            {errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={runImport}
          disabled={text.trim() === ""}
        >
          Import
        </button>
      </div>
    </>
  );
}
