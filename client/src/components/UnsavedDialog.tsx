import { useEffect } from "react";

// The in-app half of the save model (decisions.md #15): navigations
// we control (switching branch, leaving the repo, switching user) get
// a real three-way choice. Only the OS-level tab close falls back to
// the browser's native prompt.
export function UnsavedDialog({
  actionLabel,
  onSave,
  onDiscard,
  onCancel,
}: {
  /** What the user was trying to do, e.g. "switch to “feature”". */
  actionLabel: string;
  onSave: () => void;
  onDiscard: () => void;
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
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Unsaved changes"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>You have unsaved changes</h2>
        <p className="dialog-hint">
          Save them before you {actionLabel}, or discard them — discarded
          changes are gone for good.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger" onClick={onDiscard}>
            Discard changes
          </button>
          <button type="button" className="btn btn--primary" onClick={onSave} autoFocus>
            Save &amp; continue
          </button>
        </div>
      </div>
    </div>
  );
}
