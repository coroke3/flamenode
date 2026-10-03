"use client";

import * as React from "react";
import styles from "./redesign.module.css";

type Theme = "light" | "dark" | "system";

function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function RedesignThemeToggle(): React.ReactElement {
  const [theme, setTheme] = React.useState<Theme>("system");

  React.useEffect(() => {
    const value = document.documentElement.getAttribute("data-theme-preference");
    if (value === "light" || value === "dark" || value === "system") {
      setTheme(value);
    }
  }, []);

  const apply = (next: Theme): void => {
    setTheme(next);
    try {
      localStorage.setItem("fn-theme", next);
    } catch {
      // The mock must remain usable when storage is unavailable.
    }
    document.documentElement.setAttribute("data-theme", resolveTheme(next));
    document.documentElement.setAttribute("data-theme-preference", next);
  };

  return (
    <div className={styles.themeToggle} role="group" aria-label="モックのテーマ">
      {(["light", "dark", "system"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          className={theme === value ? styles.themeActive : undefined}
          onClick={() => apply(value)}
        >
          {value === "light" ? "Light" : value === "dark" ? "Dark" : "System"}
        </button>
      ))}
    </div>
  );
}
