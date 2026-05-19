import * as React from "react";
import styles from "./StatusPanel.module.css";

type StatusPanelProps = {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "info" | "success" | "warning" | "danger";
};

export function StatusPanel({
  title,
  children,
  action,
  tone = "info",
}: StatusPanelProps): React.ReactElement {
  return (
    <section className={`${styles.panel} ${styles[tone]}`}>
      <div className={styles.text}>
        <h2>{title}</h2>
        {children ? <div className={styles.body}>{children}</div> : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </section>
  );
}
