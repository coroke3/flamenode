import React from "react";
import { Link } from "../adapters/index.js";
import { Button } from "../components/Button.js";
import { FEEDBACK_MESSAGES } from "./StatusNotice.js";

/**
 * Error with the next step for its cause. The reason → CTA / tone table is CURRENT
 * `src/components/ui/ErrorCallout.tsx`; `retry` is new (MIG-0204 T01).
 */
export type ErrorCalloutReason =
  | "unauthenticated"
  | "banned"
  | "tos_required"
  | "tos_reaccept_required"
  | "maintenance_mode"
  | "cost_guard_blocked"
  | "active_x_required"
  | "active_x_rejected"
  | "active_x_not_approved"
  | "duplicate_youtube_id"
  | "permission_denied"
  | "submitter_change_denied"
  | (string & {});

export interface ErrorCalloutCta {
  href: string;
  label: string;
}

export interface ErrorCalloutProps {
  reason?: ErrorCalloutReason;
  message?: string | null;
  /**
   * Path + query the CTA returns to (`next=`). CURRENT reads `window.location`;
   * pass it when rendering on the server. Defaults to the current location, else "/".
   */
  currentPath?: string;
  /** Extra CTA after the reason's own one (CURRENT `extraCta`). */
  extraCta?: ErrorCalloutCta | null;
  retry?: () => void;
  retryLabel?: string;
  className?: string;
}

function locationPath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

function withQueryParam(path: string, key: string, value: string): string {
  const hashIndex = path.indexOf("#");
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const queryIndex = withoutHash.indexOf("?");
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const params = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "");
  params.set(key, value);
  const encoded = params.toString();
  return `${pathname}${encoded ? `?${encoded}` : ""}${hash}`;
}

export function errorCalloutCta(reason: ErrorCalloutReason, next: string): ErrorCalloutCta | null {
  switch (reason) {
    case "unauthenticated":
      return { href: `/entry?next=${encodeURIComponent(next)}`, label: "ログイン" };
    case "tos_required":
    case "tos_reaccept_required":
      return { href: `/onboarding?next=${encodeURIComponent(next)}`, label: "利用規約を確認" };
    case "active_x_required":
    case "active_x_rejected":
    case "active_x_not_approved":
      return { href: `/onboarding?next=${encodeURIComponent(next)}`, label: "初期設定を続ける" };
    case "duplicate_youtube_id":
      return { href: "/list", label: "既存作品を探す" };
    case "submitter_change_denied":
      return { href: withQueryParam(next, "privileged", "admin"), label: "管理者モードに切替" };
    default:
      // banned / maintenance_mode / cost_guard_blocked: explanation only.
      return null;
  }
}

export function errorCalloutTone(reason: ErrorCalloutReason | undefined): "danger" | "warning" {
  return reason === "maintenance_mode" || reason === "cost_guard_blocked" ||
    reason === "tos_required" || reason === "tos_reaccept_required"
    ? "warning"
    : "danger";
}

export function ErrorCallout({
  reason,
  message,
  currentPath,
  extraCta,
  retry,
  retryLabel = "再試行",
  className,
}: ErrorCalloutProps): React.ReactElement | null {
  // CURRENT renders nothing without a reason or a message.
  if (!reason && !message) return null;
  const cta = reason ? errorCalloutCta(reason, currentPath ?? locationPath()) : null;
  const tone = errorCalloutTone(reason);
  return (
    <div
      role="alert"
      aria-live="assertive"
      data-tone={tone}
      className={["fn-error-callout", `fn-error-callout--${tone}`, className].filter(Boolean).join(" ")}
    >
      <span className="fn-error-message">{message ?? FEEDBACK_MESSAGES.error}</span>
      {cta ? (
        <Link href={cta.href} className="fn-btn fn-btn--primary fn-btn--sm">
          {cta.label}
        </Link>
      ) : null}
      {extraCta ? (
        <Link href={extraCta.href} className="fn-btn fn-btn--tertiary fn-btn--sm">
          {extraCta.label}
        </Link>
      ) : null}
      {retry ? (
        <Button variant="secondary" size="sm" onClick={retry} className="fn-error-retry">
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
