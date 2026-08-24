import { useEffect } from "react";

// The cascade confirm (editor UX decision): before a destructive edit
// lands, every dependent thing it would take with it is named here.
// Nothing is ever removed silently.
export function ConfirmDialog({
  title,
  lines,
  onConfirm,
  onCancel,
}: {
  title: string;
  lines: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="overlay" onClick={onCancel}>
      <div
        className="dialog dialog--confirm"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <span className="dialog-icon dialog-icon--danger" aria-hidden="true">
            !
          </span>
          <h2>{title}</h2>
        </div>
        <p className="collateral-lead">This also removes:</p>
        <ul className="collateral">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="dialog-hint">You can undo this afterwards.</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger" onClick={onConfirm} autoFocus>
            Remove them and continue
          </button>
        </div>
      </div>
    </div>
  );
}
