"use client";

import * as React from "react";
import styles from "./ThemeToggle.module.css";
import { Icon } from "@/components/ui/Icon";

type Mode = "light" | "dark" | "system";

const STORAGE_KEY = "fn-theme";
const MODES: Mode[] = ["system", "light", "dark"];

const MODE_META: Record<
  Mode,
  { icon: "system" | "sun" | "moon"; label: string; nextLabel: string }
> = {
  system: {
    icon: "system",
    label: "テーマ: システム",
    nextLabel: "ライトへ切り替え",
  },
  light: {
    icon: "sun",
    label: "テーマ: ライト",
    nextLabel: "ダークへ切り替え",
  },
  dark: {
    icon: "moon",
    label: "テーマ: ダーク",
    nextLabel: "システムへ切り替え",
  },
};

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

  const cycle = () => {
    const currentIndex = MODES.indexOf(mode);
    const next = MODES[(currentIndex + 1) % MODES.length] ?? "system";
    setMode(next);
    applyTheme(next);
  };

  const meta = MODE_META[mode];

  return (
    <button
      type="button"
      aria-label={`${meta.label}。${meta.nextLabel}`}
      title={`${meta.label} / ${meta.nextLabel}`}
      className={styles.button}
      onClick={cycle}
    >
      <Icon name={meta.icon} size={15} />
      <span className={styles.dot} aria-hidden />
    </button>
  );
}
