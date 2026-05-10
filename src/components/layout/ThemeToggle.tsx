"use client";

import * as React from "react";
import styles from "./ThemeToggle.module.css";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";

type Mode = "light" | "dark" | "system";

const STORAGE_KEY = "fn-theme";

function applyTheme(mode: Mode) {
  const html = document.documentElement;
  if (mode === "system") {
    html.removeAttribute("data-theme");
  } else {
    html.setAttribute("data-theme", mode);
  }
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* noop */
  }
}

/**
 * ライト / ダーク / システムを切り替えるコンパクトなピル UI。
 * 黄色アクセントでアクティブを示す。
 */
export function ThemeToggle(): React.ReactElement {
  const [mode, setMode] = React.useState<Mode>("system");

  React.useEffect(() => {
    let saved: Mode = "system";
    try {
      const v = localStorage.getItem(STORAGE_KEY) as Mode | null;
      if (v === "light" || v === "dark" || v === "system") saved = v;
    } catch {
      /* noop */
    }
    setMode(saved);
    applyTheme(saved);
  }, []);

  const change = (next: Mode) => {
    setMode(next);
    applyTheme(next);
  };

  return (
    <div role="radiogroup" aria-label="テーマ切替" className={styles.root}>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "light"}
        aria-label="ライトモード"
        onClick={() => change("light")}
        className={cn(styles.button, mode === "light" && styles.active)}
      >
        <Icon name="sun" size={14} />
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "system"}
        aria-label="システム追従"
        onClick={() => change("system")}
        className={cn(styles.button, mode === "system" && styles.active)}
      >
        <Icon name="system" size={14} />
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "dark"}
        aria-label="ダークモード"
        onClick={() => change("dark")}
        className={cn(styles.button, mode === "dark" && styles.active)}
      >
        <Icon name="moon" size={14} />
      </button>
    </div>
  );
}
