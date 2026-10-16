import React from "react";
import { Link } from "../adapters/index.js";
import { Button } from "../components/Button.js";

export interface ErrorCalloutProps {
  message: string;
  reason?: string;
  retry?: () => void;
  retryLabel?: string;
  cta?: {
    href: string;
    label: string;
  };
  className?: string;
}

function cx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function ErrorCallout({
  message,
  reason,
  retry,
  retryLabel = "再試行",
  cta,
  className,
}: ErrorCalloutProps): React.ReactElement {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cx("fn-error-callout", className)}
    >
      <span className="fn-error-message">{message}</span>
      {retry ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={retry}
          className="fn-error-retry"
        >
          {retryLabel}
        </Button>
      ) : null}
      {cta ? (
        <Link href={cta.href} className="fn-btn fn-btn--secondary fn-btn--sm">
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
