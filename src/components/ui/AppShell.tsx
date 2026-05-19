import * as React from "react";
import styles from "./AppShell.module.css";

type AppShellProps = {
  children: React.ReactNode;
  size?: "narrow" | "default" | "wide" | "full";
  tone?: "default" | "dark";
};

export function AppShell({
  children,
  size = "default",
  tone = "default",
}: AppShellProps): React.ReactElement {
  return (
    <main className={`${styles.shell} ${styles[size]} ${styles[tone]}`}>
      {children}
    </main>
  );
}
