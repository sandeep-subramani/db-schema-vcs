import { useCallback, useEffect, useState } from "react";
import { EXAMPLE_SCHEMA, findTable, type Schema } from "engine";
import { ConfirmDialog } from "./components/ConfirmDialog.tsx";
import { ImportExportDialog } from "./components/ImportExportDialog.tsx";
import { TableEditor, type EditRequest } from "./components/TableEditor.tsx";
import { TableList } from "./components/TableList.tsx";
import { Toast } from "./components/Toast.tsx";
import { renameTable } from "./schema/edits.ts";

// Working schema lives in client state for now (editor decision):
// branching + history (next task) owns server-side persistence, so
// nothing temporary is built here. Every edit pushes the previous
// snapshot onto an undo stack — snapshots are immutable, so undo is
// just pointing back at the old one.
const UNDO_LIMIT = 50;

interface HistoryState {
  past: Schema[];
  present: Schema;
}

export function App() {
  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: EXAMPLE_SCHEMA,
  });
  const schema = history.present;

  const [selected, setSelected] = useState<string | null>(
    EXAMPLE_SCHEMA.tables[0]?.name ?? null,
  );
  const [confirm, setConfirm] = useState<EditRequest | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const [io, setIo] = useState<"import" | "export" | null>(null);

  const applyEdit = useCallback((next: Schema, toastMessage?: string) => {
    setHistory((h) => ({
      past: [...h.past.slice(-(UNDO_LIMIT - 1)), h.present],
      present: next,
    }));
    if (toastMessage) setToast({ id: Date.now(), message: toastMessage });
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      const previous = h.past[h.past.length - 1];
      if (previous === undefined) return h;
      return { past: h.past.slice(0, -1), present: previous };
    });
    setToast(null);
  }, []);

  // Cmd/Ctrl+Z anywhere outside a text field undoes the last edit.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== "z") {
        return;
      }
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      ) {
        return; // let the browser undo typing in the field
      }
      e.preventDefault();
      undo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  // Deleting or importing can invalidate the selection.
  const selectedTable = selected ? findTable(schema, selected) : undefined;
  useEffect(() => {
    if (selected && !findTable(schema, selected)) {
      setSelected(schema.tables[0]?.name ?? null);
    } else if (!selected) {
      setSelected(schema.tables[0]?.name ?? null);
    }
  }, [schema, selected]);

  function requestEdit(request: EditRequest) {
    if (request.result.schema === schema) return; // guarded no-op
    if (request.result.collateral.length > 0) {
      setConfirm(request);
    } else {
      applyEdit(request.result.schema, request.toast);
    }
  }

  function confirmEdit(request: EditRequest) {
    const n = request.result.collateral.length;
    applyEdit(
      request.result.schema,
      `${request.toast ?? "Change applied"} — also removed ${n} dependent ${
        n === 1 ? "item" : "items"
      }`,
    );
    setConfirm(null);
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Schema Version Control</h1>
        <div className="topbar-actions">
          <button
            type="button"
            className="btn"
            onClick={undo}
            disabled={history.past.length === 0}
            title="Undo last edit (Ctrl/Cmd+Z)"
          >
            Undo
          </button>
          <button type="button" className="btn" onClick={() => setIo("import")}>
            Import JSON
          </button>
          <button type="button" className="btn" onClick={() => setIo("export")}>
            Export JSON
          </button>
        </div>
      </header>

      <div className="layout">
        <TableList
          schema={schema}
          selected={selected}
          onSelect={setSelected}
          onApply={(next) => applyEdit(next)}
        />
        <main className="editor">
          {selectedTable ? (
            <TableEditor
              schema={schema}
              table={selectedTable}
              onEdit={requestEdit}
              onRenameTable={(oldName, newName) => {
                applyEdit(renameTable(schema, oldName, newName).schema);
                setSelected(newName);
              }}
            />
          ) : (
            <div className="empty empty--main">
              <h2>Nothing here yet</h2>
              <p>
                A schema is a set of tables. Add your first one in the sidebar,
                or use <strong>Import JSON</strong> to bring one in.
              </p>
            </div>
          )}
        </main>
      </div>

      <HealthFooter />

      {confirm && (
        <ConfirmDialog
          title={confirm.confirmTitle ?? "Apply this change?"}
          lines={confirm.result.collateral}
          onCancel={() => setConfirm(null)}
          onConfirm={() => confirmEdit(confirm)}
        />
      )}
      {io && (
        <ImportExportDialog
          mode={io}
          schema={schema}
          onClose={() => setIo(null)}
          onImport={(imported) => {
            applyEdit(imported, "Imported schema");
            setIo(null);
          }}
        />
      )}
      <Toast
        toast={toast}
        onDismiss={() => setToast(null)}
        onUndo={() => {
          undo();
          setToast(null);
        }}
      />
    </div>
  );
}

// --- server health (kept from the scaffold, now a footer line) --------

type Health = { status: string; db: "connected" | "error" | "not_configured" };

type HealthState =
  | { kind: "loading" }
  | { kind: "ok"; health: Health }
  | { kind: "unreachable" };

const DB_LABELS: Record<Health["db"], string> = {
  connected: "database connected",
  error: "database configured but unreachable",
  not_configured: "no database configured yet",
};

function HealthFooter() {
  const [state, setState] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((health: Health) => {
        if (!cancelled) setState({ kind: "ok", health });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "unreachable" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <footer className="foot">
      {state.kind === "loading" && <span>Checking server…</span>}
      {state.kind === "ok" && (
        <span className="foot--ok">
          Server is up · {DB_LABELS[state.health.db]} · edits stay in this tab
          until branching lands
        </span>
      )}
      {state.kind === "unreachable" && (
        <span className="foot--bad">
          Can’t reach the server — start it with <code>npm run dev</code>. The
          editor still works; edits stay in this tab.
        </span>
      )}
    </footer>
  );
}
