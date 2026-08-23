import { useEffect, useRef, useState } from "react";
import { getTheme, setTheme, type Theme } from "../theme.ts";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

// Icon button opening a small panel with one preview card per theme.
// Picking an option applies it immediately and keeps the panel open so
// the choice can be compared; outside click or Escape closes it.
export function ThemeToggle() {
  const [theme, setState] = useState<Theme>(getTheme);
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
    <div className="theme-switch" ref={rootRef}>
      <button
        type="button"
        className="theme-switch-btn"
        title="Theme"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">◐</span>
        <span className="theme-switch-caret" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="theme-menu" role="group" aria-label="Theme">
          <p className="theme-menu-title">Theme</p>
          <div className="theme-menu-options">
            {OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  "theme-option" + (theme === option.value ? " theme-option--active" : "")
                }
                aria-pressed={theme === option.value}
                onClick={() => {
                  setTheme(option.value);
                  setState(option.value);
                }}
              >
                <span className={`theme-thumb theme-thumb--${option.value}`} aria-hidden="true">
                  <span className="theme-thumb-head">
                    <span className="theme-thumb-gem" />
                    <span className="theme-thumb-bar" />
                  </span>
                  <span className="theme-thumb-body">
                    <span className="theme-thumb-bar" />
                    <span className="theme-thumb-bar" />
                  </span>
                </span>
                <span className="theme-option-name">
                  {option.label}
                  {theme === option.value && (
                    <span className="theme-option-check" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
          <p className="theme-menu-note">System follows your OS setting.</p>
        </div>
      )}
    </div>
  );
}
