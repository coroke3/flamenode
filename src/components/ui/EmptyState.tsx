import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils/cn";
import styles from "./EmptyState.module.css";

export type EmptyStateTone = "neutral" | "success" | "warning" | "danger";

export type EmptyStateAction = {
  href: string;
  label: string;
  variant?: "primary" | "ghost" | "danger";
};

export type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  iconName?: IconName;
  actions?: EmptyStateAction[];
  tone?: EmptyStateTone;
  className?: string;
};

function toneIcon(tone: EmptyStateTone): IconName {
  switch (tone) {
    case "success":
      return "check";
    case "warning":
      return "warning";
    case "danger":
      return "alert";
    default:
      return "info";
  }
}

function actionClass(variant: EmptyStateAction["variant"]): string {
  switch (variant) {
    case "danger":
      return "fn-btn fn-btn-danger";
    case "ghost":
      return "fn-btn fn-btn-ghost";
    case "primary":
    default:
      return "fn-btn fn-btn-primary";
  }
}

export function EmptyState({
  title,
  description,
  icon,
  iconName,
  actions,
  tone = "neutral",
  className,
}: EmptyStateProps): React.ReactElement {
  const resolvedActions = actions ?? [];

  const iconNode =
    icon ??
    (iconName ? (
      <Icon name={iconName} size={18} aria-hidden />
    ) : (
      <Icon name={toneIcon(tone)} size={18} aria-hidden />
    ));

  return (
    <section
      className={cn(
        "fn-empty-state",
        styles.empty,
        styles[`tone-${tone}`],
        className,
      )}
    >
      <div className={styles.icon} aria-hidden>
        {iconNode}
      </div>
      <h2 className={styles.title}>{title}</h2>
      {description ? <p className={styles.description}>{description}</p> : null}
      {resolvedActions.length > 0 ? (
        <div className={styles.actions}>
          {resolvedActions.map((action) => (
            <Link
              key={`${action.href}-${action.label}`}
              href={action.href}
              className={actionClass(action.variant)}
            >
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
