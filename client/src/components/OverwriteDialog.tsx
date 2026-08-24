import { useEffect } from "react";
import type { SaveConflict } from "../api.ts";
import { timeAgo } from "../time.ts";

// The stale-save dialog (decisions.md #15). It only ever appears when
// a save would truly wipe out someone's newer save, so it can afford
// to be blunt: overwrite with consent, load theirs, or stop.
export function OverwriteDialog({
  conflict,
  onOverwrite,
  onLoadTheirs,
  onCancel,
}: {
  conflict: SaveConflict;
  onOverwrite: () => void;
  onLoadTheirs: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const who = conflict.savedBy ?? "someone";
  const when = conflict.savedAt ? ` ${timeAgo(conflict.savedAt)}` : "";

  return (
    <div className="overlay" onClick={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Newer save exists"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <span className="dialog-icon dialog-icon--warn" aria-hidden="true">
            !
          </span>
          <h2>
            {who} saved newer changes{when}
          </h2>
        </div>
        <p className="dialog-hint">
          Saving now would replace their version with yours.{" "}
          <strong>Load theirs</strong> brings their version into your editor
          instead — one Undo brings yours back.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger" onClick={onOverwrite}>
            Overwrite their save
          </button>
          <button type="button" className="btn btn--primary" onClick={onLoadTheirs} autoFocus>
            Load theirs
          </button>
        </div>
      </div>
    </div>
  );
}
