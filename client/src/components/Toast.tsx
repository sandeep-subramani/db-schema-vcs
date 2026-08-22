import { useEffect } from "react";

// Post-edit notification with undo — the second half of the cascade
// UX: confirm names the collateral up front, the toast offers the way
// back after.
export function Toast({
  toast,
  onUndo,
  onDismiss,
}: {
  toast: { id: number; message: string } | null;
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
      <button type="button" className="toast-undo" onClick={onUndo}>
        Undo
      </button>
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}
