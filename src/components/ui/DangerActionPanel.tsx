import * as React from "react";
import styles from "./DangerActionPanel.module.css";

type DangerActionPanelProps = {
  title: string;
  description: string;
  impactItems: Array<{ label: string; value: number | string }>;
  confirmText: string;
  actionLabel: string;
  inputName?: string;
};

export function DangerActionPanel({
  title,
  description,
  impactItems,
  confirmText,
  actionLabel,
  inputName = "confirm",
}: DangerActionPanelProps): React.ReactElement {
  return (
    <section className={styles.danger}>
      <div>
        <p className={styles.eyebrow}>Danger</p>
        <h2>{title}</h2>
        <p className={styles.description}>{description}</p>
      </div>

      <dl className={styles.impactList}>
        {impactItems.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>

      <label className={styles.confirm}>
        <span>確認文字列</span>
        <code>{confirmText}</code>
        <input name={inputName} autoComplete="off" />
      </label>

      <button type="submit" className={styles.action}>
        {actionLabel}
      </button>
    </section>
  );
}
