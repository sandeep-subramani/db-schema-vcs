import { useEffect } from "react";

export interface ToastData {
  id: number;
  message: string;
  /** Show the Undo action — only for edits the undo stack can revert. */
  undoable: boolean;
}

// Post-action notification. For destructive edits it's the second
// half of the cascade UX (confirm names the collateral up front, the
// toast offers the way back after); for save/commit it just reports.
export function Toast({
  toast,
  onUndo,
  onDismiss,
}: {
  toast: ToastData | null;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;
  return (
    <div className="toast" role="status">
      <span>{toast.message}</span>
      {toast.undoable && (
        <button type="button" className="toast-undo" onClick={onUndo}>
          Undo
        </button>
      )}
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}
