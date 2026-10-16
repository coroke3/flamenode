import React from "react";
import { Link } from "../adapters/index.js";

export type EmptyStateTone = "neutral" | "success" | "warning" | "danger";

export interface EmptyStateAction {
  href: string;
  label: string;
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  tone?: EmptyStateTone;
  action?: EmptyStateAction;
  actions?: EmptyStateAction[];
  className?: string;
}

function cx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function EmptyState({
  title,
  description,
  icon,
  tone = "neutral",
  action,
  actions,
  className,
}: EmptyStateProps): React.ReactElement {
  const allActions = actions ?? (action ? [action] : []);

  return (
    <section
      className={cx("fn-empty-state", `fn-empty-state--${tone}`, className)}
      aria-label={title}
    >
      {icon ? (
        <div className="fn-empty-state-icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h2 className="fn-empty-state-title">{title}</h2>
      {description ? (
        <p className="fn-empty-state-description">{description}</p>
      ) : null}
      {allActions.length > 0 ? (
        <div className="fn-empty-state-actions">
          {allActions.map((act) => (
            <Link
              key={`${act.href}-${act.label}`}
              href={act.href}
              className="fn-btn fn-btn--primary"
            >
              {act.label}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
