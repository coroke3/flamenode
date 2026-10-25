import React from "react";
import {
  THEME_STORAGE_KEY,
  nextThemeMode,
  normalizeThemeMode,
  resolveTheme,
  type ResolvedTheme,
  type ThemeMode,
} from "../../../../src/lib/theme/mode.ts";

/**
 * Header theme switch (CURRENT `ThemeToggle`, cycle variant). The first paint is already right because the
 * inline bootstrap script in the page head sets `data-theme` (MIG-0501); this Island only reads the stored mode,
 * follows the OS while the mode is `system`, and persists a click under `fn-theme`. The mode/resolve rules are
 * CURRENT's pure `lib/theme/mode.ts`.
 */
const h = React.createElement;

function prefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function applyTheme(mode: ThemeMode, persist = true): ResolvedTheme {
  const resolved = resolveTheme(mode, prefersDark());
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.setAttribute("data-theme-preference", mode);
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      /* noop */
    }
  }
  return resolved;
}

const SUN = "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4";
const MOON = "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z";

export function ThemeToggle(): React.ReactElement {
  const [mode, setMode] = React.useState<ThemeMode>("system");
  const [resolved, setResolved] = React.useState<ResolvedTheme>("light");

  React.useEffect(() => {
    let initial: ThemeMode = "system";
    try {
      initial = normalizeThemeMode(localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
      /* noop */
    }
    setMode(initial);
    setResolved(applyTheme(initial, false));
  }, []);

  React.useEffect(() => {
    if (mode !== "system") return;
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(applyTheme("system", false));
    query?.addEventListener?.("change", onChange);
    return () => query?.removeEventListener?.("change", onChange);
  }, [mode]);

  const label =
    resolved === "light" ? "現在はライトテーマ。ダークテーマへ切り替え" : "現在はダークテーマ。ライトテーマへ切り替え";
  return h(
    "button",
    {
      type: "button",
      className: "ib",
      "aria-label": label,
      title: label,
      onClick: () => {
        const next = nextThemeMode(resolved);
        setMode(next);
        setResolved(applyTheme(next));
      },
    },
    h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" }, h("path", { d: resolved === "dark" ? MOON : SUN })),
  );
}

export default ThemeToggle;
