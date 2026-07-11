"use client";

import * as React from "react";
import styles from "./ThemeToggle.module.css";
import { Icon } from "@/components/ui/Icon";
import {
  THEME_STORAGE_KEY,
  nextThemeMode,
  normalizeThemeMode,
  resolveTheme,
  type ThemeMode,
} from "@/lib/theme/mode";

function getPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function applyTheme(mode: ThemeMode, persist = true): void {
  const resolved = resolveTheme(mode, getPrefersDark());
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.setAttribute("data-theme-preference", mode);
  if (!persist) return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* noop */
  }
}

export function ThemeToggle({
  variant = "cycle",
}: {
  variant?: "cycle" | "segmented";
}): React.ReactElement {
  const [mode, setMode] = React.useState<ThemeMode>("system");

  React.useEffect(() => {
    let initial: ThemeMode = "system";
    try {
      initial = normalizeThemeMode(localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
      /* noop */
    }
    setMode(initial);
    applyTheme(initial, false);
  }, []);

  React.useEffect(() => {
    if (mode !== "system") return;
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system", false);
    query?.addEventListener?.("change", onChange);
    return () => query?.removeEventListener?.("change", onChange);
  }, [mode]);

  const select = (next: ThemeMode) => {
    setMode(next);
    applyTheme(next);
  };

  if (variant === "segmented") {
    return (
      <div className={styles.segmented} role="group" aria-label="テーマ">
        {(["light", "dark", "system"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={styles.segment}
            data-active={item === mode || undefined}
            aria-pressed={item === mode}
            onClick={() => select(item)}
          >
            <Icon
              name={item === "light" ? "sun" : item === "dark" ? "moon" : "settings"}
              size={13}
              aria-hidden
            />
            {item === "light" ? "ライト" : item === "dark" ? "ダーク" : "OS設定"}
          </button>
        ))}
      </div>
    );
  }

  const label =
    mode === "system"
      ? "現在はOS設定に追従中。ライトテーマへ切り替え"
      : mode === "light"
        ? "現在はライトテーマ。ダークテーマへ切り替え"
        : "現在はダークテーマ。OS設定に追従へ切り替え";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={styles.button}
      onClick={() => {
        select(nextThemeMode(mode));
      }}
    >
      <Icon
        name={mode === "system" ? "settings" : mode === "dark" ? "moon" : "sun"}
        size={15}
      />
      <span className={styles.dot} aria-hidden />
    </button>
  );
}
