import { useState } from "react";
import { getTheme, setTheme, type Theme } from "../theme.ts";

const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

// Placeholder until the UI refactor: one button cycling
// System → Light → Dark, labeled with the current choice.
export function ThemeToggle() {
  const [theme, setState] = useState<Theme>(getTheme);

  return (
    <button
      type="button"
      className="btn"
      title="Cycle theme (System → Light → Dark)"
      onClick={() => {
        const next = NEXT[theme];
        setTheme(next);
        setState(next);
      }}
    >
      Theme: {LABEL[theme]}
    </button>
  );
}
