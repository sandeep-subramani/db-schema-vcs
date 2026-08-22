import { useEffect, useState, type ReactNode } from "react";

// One dialog for every "name something and go" moment — new repo,
// new branch, commit message — so they all behave identically:
// Enter submits, Escape cancels, errors show inline.
export function TextPromptDialog({
  title,
  label,
  placeholder,
  submitLabel,
  hint,
  error,
  busy,
  children,
  onSubmit,
  onCancel,
}: {
  title: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  /** Muted line under the field, e.g. what the action will do. */
  hint?: string;
  /** Server-side rejection to show (name taken, etc.). */
  error?: string | null;
  busy?: boolean;
  /** Extra controls rendered between the field and the actions. */
  children?: ReactNode;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const trimmed = value.trim();

  return (
    <div className="overlay" onClick={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed && !busy) onSubmit(trimmed);
          }}
        >
          <label className="prompt-label">
            {label}
            <input
              autoFocus
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          {hint && <p className="dialog-hint">{hint}</p>}
          {children}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={trimmed === "" || busy}
            >
              {busy ? "Working…" : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
