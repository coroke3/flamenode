import React from "react";

export type StatusNoticeType = "degraded" | "pending" | "success" | "info";

export interface StatusNoticeProps {
  status: StatusNoticeType;
  message: string;
  title?: string;
  className?: string;
}

function cx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function StatusNotice({
  status,
  message,
  title,
  className,
}: StatusNoticeProps): React.ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx("fn-status-notice", `fn-status-notice--${status}`, className)}
    >
      {title ? <strong className="fn-status-title">{title}</strong> : null}
      <span className="fn-status-message">{message}</span>
    </div>
  );
}
