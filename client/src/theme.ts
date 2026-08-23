// Theme override. The stylesheet is built on light-dark(), so the
// browser follows the OS setting by default; setting data-theme on
// <html> forces color-scheme one way (see index.css) and flips every
// token at once. "system" = no attribute = follow the OS.

const THEME_KEY = "svc.theme";

export type Theme = "system" | "light" | "dark";

function isTheme(value: string | null): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

export function getTheme(): Theme {
  const raw = localStorage.getItem(THEME_KEY);
  return isTheme(raw) ? raw : "system";
}

export function setTheme(theme: Theme): void {
  if (theme === "system") {
    localStorage.removeItem(THEME_KEY);
    delete document.documentElement.dataset.theme;
  } else {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
  }
}

// Called once at startup so the saved choice applies before render.
export function initTheme(): void {
  setTheme(getTheme());
}
