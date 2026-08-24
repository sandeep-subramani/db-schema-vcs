import { useEffect, useRef, useState } from "react";

// The identity chip in the top right, doubled as the only home for
// the two navigations that leave where you are: back to your repos,
// and switch user. They used to sit as loose top-bar buttons on one
// screen each; here they follow you into every view, because every
// screen renders this chip.
//
// Both callbacks are handed in already wrapped in their screen's
// unsaved-changes guard — this component never decides whether
// leaving is safe, it only asks.
export function UserMenu({
  username,
  onGoToRepos,
  onSwitchUser,
}: {
  username: string;
  /** null when the repo list is already the screen you're on. */
  onGoToRepos: (() => void) | null;
  onSwitchUser: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className="user-chip user-chip--btn"
        title="Your demo identity"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="user-chip-avatar" aria-hidden="true">
          {username.slice(0, 1).toUpperCase()}
        </span>
        {username}
        <span className="user-chip-caret" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="user-menu-panel" role="menu" aria-label="Account">
          <p className="user-menu-title">Signed in as {username}</p>
          <span className="user-menu-sep" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            className="user-menu-item"
            disabled={onGoToRepos === null}
            onClick={() => {
              setOpen(false);
              onGoToRepos?.();
            }}
          >
            <span className="user-menu-icon" aria-hidden="true">
              ⌂
            </span>
            My repos
            {onGoToRepos === null && (
              <span className="user-menu-tag">Current</span>
            )}
          </button>
          <span className="user-menu-sep" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            className="user-menu-item"
            onClick={() => {
              setOpen(false);
              onSwitchUser();
            }}
          >
            <span className="user-menu-icon" aria-hidden="true">
              ⇄
            </span>
            Switch user
          </button>
        </div>
      )}
    </div>
  );
}
