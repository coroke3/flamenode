import * as React from "react";
import styles from "./PageHero.module.css";

type PageHeroProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  metrics?: React.ReactNode;
};

export function PageHero({
  eyebrow,
  title,
  description,
  actions,
  metrics,
}: PageHeroProps): React.ReactElement {
  return (
    <header className={styles.hero}>
      <div className={styles.text}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? (
          <p className={styles.description}>{description}</p>
        ) : null}
      </div>

      {actions ? <div className={styles.actions}>{actions}</div> : null}
      {metrics ? <div className={styles.metrics}>{metrics}</div> : null}
    </header>
  );
}
