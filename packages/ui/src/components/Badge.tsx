import React from "react";

export type BadgeStatus =
  | "public"
  | "reserved"
  | "draft"
  | "warning"
  | "error"
  | "live";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: BadgeStatus;
  label?: string;
  icon?: React.ReactNode;
}

const DEFAULT_LABELS: Record<BadgeStatus, string> = {
  public: "PUBLIC",
  reserved: "RESERVED",
  draft: "DRAFT",
  warning: "WARNING",
  error: "ERROR",
  live: "LIVE",
};

function cx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function Badge({
  status = "draft",
  label,
  icon,
  className,
  children,
  ...props
}: BadgeProps) {
  const displayLabel = label ?? (children ? null : DEFAULT_LABELS[status]);

  return (
    <span
      className={cx("fn-status", `fn-status--${status}`, className)}
      data-status={status}
      {...props}
    >
      {icon ? (
        <span className="fn-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {displayLabel ? <span>{displayLabel}</span> : null}
      {children}
    </span>
  );
}

// Alias matching mock component naming
export const Status = Badge;
