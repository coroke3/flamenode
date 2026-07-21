"use client";

import * as React from "react";
import styles from "./ThemeToggle.module.css";
import { Icon } from "@/components/ui/Icon";
import {
  THEME_STORAGE_KEY,
  nextThemeMode,
  normalizeThemeMode,
  resolveTheme,
  type ResolvedTheme,
  type ThemeMode,
} from "@/lib/theme/mode";

function getPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function applyTheme(mode: ThemeMode, persist = true): ResolvedTheme {
  const resolved = resolveTheme(mode, getPrefersDark());
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

export function ThemeToggle({
  variant = "cycle",
}: {
  variant?: "cycle" | "segmented";
}): React.ReactElement {
  const [mode, setMode] = React.useState<ThemeMode>("system");
  const [resolvedMode, setResolvedMode] =
    React.useState<ResolvedTheme>("light");

  React.useEffect(() => {
    let initial: ThemeMode = "system";
    try {
      initial = normalizeThemeMode(localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
      /* noop */
    }
    setMode(initial);
    setResolvedMode(applyTheme(initial, false));
  }, []);

  React.useEffect(() => {
    if (mode !== "system") return;
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => setResolvedMode(applyTheme("system", false));
    query?.addEventListener?.("change", onChange);
    return () => query?.removeEventListener?.("change", onChange);
  }, [mode]);

  const select = (next: ResolvedTheme) => {
    setMode(next);
    setResolvedMode(applyTheme(next));
  };

  if (variant === "segmented") {
    return (
      <div className={styles.segmented} role="group" aria-label="テーマ設定">
        {(["light", "dark"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={styles.segment}
            data-active={item === resolvedMode || undefined}
            aria-pressed={item === resolvedMode}
            onClick={() => select(item)}
          >
            <Icon
              name={item === "light" ? "sun" : "moon"}
              size={13}
              aria-hidden
            />
            {item === "light" ? "ライト" : "ダーク"}
          </button>
        ))}
      </div>
    );
  }

  const label =
    resolvedMode === "light"
      ? "現在はライトテーマ。ダークテーマへ切り替え"
      : "現在はダークテーマ。ライトテーマへ切り替え";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={styles.button}
      onClick={() => {
        select(nextThemeMode(resolvedMode));
      }}
    >
      <Icon
        name={resolvedMode === "dark" ? "moon" : "sun"}
        size={15}
      />
      <span className={styles.dot} aria-hidden />
    </button>
  );
}
