import * as React from "react";
import styles from "./MetricTile.module.css";

type MetricTileProps = {
  label: string;
  value: string | number;
  suffix?: string;
  hint?: string;
  tone?: "default" | "accent" | "warning" | "danger";
};

export function MetricTile({
  label,
  value,
  suffix,
  hint,
  tone = "default",
}: MetricTileProps): React.ReactElement {
  return (
    <div className={`${styles.tile} ${styles[tone]}`}>
      <span className={styles.label}>{label}</span>
      <div className={styles.valueRow}>
        <strong>{value}</strong>
        {suffix ? <span>{suffix}</span> : null}
      </div>
      {hint ? <p>{hint}</p> : null}
    </div>
  );
}
