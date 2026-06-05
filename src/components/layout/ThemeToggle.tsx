"use client";

import * as React from "react";
import styles from "./ThemeToggle.module.css";
import { Icon } from "@/components/ui/Icon";

type Mode = "light" | "dark";

const STORAGE_KEY = "fn-theme";

function applyTheme(mode: Mode, persist = true) {
  document.documentElement.setAttribute("data-theme", mode);
  if (!persist) return;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* noop */
  }
}

export function ThemeToggle(): React.ReactElement {
  const [mode, setMode] = React.useState<Mode>("dark");

  React.useEffect(() => {
    let initial: Mode = "dark";
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "light" || saved === "dark") {
        initial = saved;
      }
    } catch {
      /* noop */
    }
    setMode(initial);
    applyTheme(initial, false);
  }, []);

  const next = mode === "dark" ? "light" : "dark";
  const label =
    mode === "dark"
      ? "現在はダークモード。ライトモードへ切り替え"
      : "現在はライトモード。ダークモードへ切り替え";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={styles.button}
      onClick={() => {
        setMode(next);
        applyTheme(next);
      }}
    >
      <Icon name={mode === "dark" ? "moon" : "sun"} size={15} />
      <span className={styles.dot} aria-hidden />
    </button>
  );
}
