import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import styles from "./EmptyState.module.css";

type EmptyStateProps = {
  title: string;
  description: string;
  href?: string;
  actionLabel?: string;
};

export function EmptyState({
  title,
  description,
  href,
  actionLabel,
}: EmptyStateProps): React.ReactElement {
  return (
    <section className={styles.empty}>
      <div className={styles.icon}>
        <Icon name="info" size={18} aria-hidden />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {href && actionLabel ? (
        <Link href={href} className="fn-btn fn-btn-primary">
          {actionLabel}
        </Link>
      ) : null}
    </section>
  );
}
