import * as React from "react";
import styles from "./AppShell.module.css";

type AppShellProps = {
  children: React.ReactNode;
  size?: "narrow" | "default" | "wide" | "full";
  tone?: "default" | "dark";
  className?: string;
};

/**
 * 認証エリアのページ本文ラッパー。
 * 公開面と同じ `fn-public-container` / `fn-page` レールに揃える。
 */
export function AppShell({
  children,
  size = "default",
  tone = "default",
  className,
}: AppShellProps): React.ReactElement {
  return (
    <main
      className={`fn-public-container fn-page ${styles.shell} ${styles[size]} ${
        tone === "dark" ? styles.dark : ""
      }${className ? ` ${className}` : ""}`}
    >
      {children}
    </main>
  );
}
