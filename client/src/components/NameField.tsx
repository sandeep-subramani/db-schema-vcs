import { useEffect, useState } from "react";

// Rename input that commits on blur or Enter, never per keystroke —
// each commit becomes one undo step, so typing "customers" must not
// produce nine of them. Escape reverts; an invalid draft shows its
// problem inline and is never committed.
export function NameField({
  value,
  ariaLabel,
  className,
  problem,
  onCommit,
}: {
  value: string;
  ariaLabel: string;
  className?: string;
  problem: (candidate: string) => string | null;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  function commit() {
    const next = draft.trim() === draft ? draft : draft.trim();
    if (next === value) {
      setDraft(value);
      setError(null);
      return;
    }
    const issue = problem(next);
    if (issue) {
      setError(issue);
      return;
    }
    setError(null);
    onCommit(next);
  }

  return (
    <span className={`name-field ${className ?? ""}`}>
      <input
        value={draft}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(value);
            setError(null);
            e.currentTarget.blur();
          }
        }}
      />
      {error && <span className="field-error">{error}</span>}
    </span>
  );
}
