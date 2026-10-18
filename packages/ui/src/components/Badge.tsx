import React from "react";
import { cx } from "../cx.js";

export type BadgeStatus =
  | "public"
  | "reserved"
  | "draft"
  | "warning"
  | "error"
  | "live";

export interface BadgeProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  status?: BadgeStatus;
  /** Empty or missing uses the status's default label, as in the mock. */
  label?: string;
  /**
   * The mock always draws a Font Awesome icon per status. The project has no icon
   * font yet, so the icon is passed in until MIG-0203/0204 decide the icon set.
   */
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

export function Badge({ status, label, icon, className, ...props }: BadgeProps) {
  // Unknown statuses fall back to draft, as in the mock.
  const known: BadgeStatus = status && status in DEFAULT_LABELS ? status : "draft";
  return (
    <span
      className={cx("fn-status", `fn-status--${known}`, className)}
      data-status={known}
      {...props}
    >
      {icon ? (
        <span className="fn-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span>{label || DEFAULT_LABELS[known]}</span>
    </span>
  );
}
