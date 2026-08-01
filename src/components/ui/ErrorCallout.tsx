"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

/**
 * writeGuard 等から返ってきた `reason` を元に、次に取るべきアクション (CTA)
 * を明示するコンポーネント。
 *
 * - 同じ「赤いエラー」でも原因が違えば CTA は変える:
 *   - `tos_required` → 利用規約へ
 *   - `unauthenticated` → ログインへ
 *   - `active_x_not_approved` → 初期設定へ
 *   - `cost_guard_blocked` / `maintenance_mode` → 説明だけ (ボタンなし)
 *
 * - `nextHref` は CTA に next= で付加する。未指定なら現在 URL を encodeURIComponent。
 *
 * 想定値: writeGuard / form action / mutation 結果の `result.reason` 等。
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
  | string;

interface CtaSpec {
  href: string;
  label: string;
}

function buildNext(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

function ctaFor(reason: ErrorCalloutReason): CtaSpec | null {
  const next = buildNext();
  switch (reason) {
    case "unauthenticated":
      return { href: `/entry?next=${encodeURIComponent(next)}`, label: "ログイン" };
    case "tos_required":
    case "tos_reaccept_required":
      return {
        href: `/onboarding?next=${encodeURIComponent(next)}`,
        label: "利用規約を確認",
      };
    case "active_x_required":
    case "active_x_rejected":
    case "active_x_not_approved":
      return {
        href: `/onboarding?next=${encodeURIComponent(next)}`,
        label: "初期設定を続ける",
      };
    case "duplicate_youtube_id":
      return { href: "/list", label: "既存作品を探す" };
    case "submitter_change_denied":
      return { href: `${buildNext()}?privileged=admin`, label: "管理者モードに切替" };
    case "banned":
    case "maintenance_mode":
    case "cost_guard_blocked":
    default:
      return null;
  }
}

function toneFor(reason: ErrorCalloutReason): "danger" | "warning" {
  if (
    reason === "maintenance_mode" ||
    reason === "cost_guard_blocked" ||
    reason === "tos_required" ||
    reason === "tos_reaccept_required"
  ) {
    return "warning";
  }
  return "danger";
}

export interface ErrorCalloutProps {
  reason?: ErrorCalloutReason;
  message?: string | null;
  /** 補助 CTA。reason に対するデフォルト CTA に加えて出す。 */
  extraCta?: CtaSpec | null;
}

export function ErrorCallout({
  reason,
  message,
  extraCta,
}: ErrorCalloutProps): React.ReactElement | null {
  if (!reason && !message) return null;
  const tone = toneFor(reason ?? "");
  const cta = reason ? ctaFor(reason) : null;
  const color =
    tone === "warning" ? "var(--accent-warning, #b45309)" : "var(--accent-danger, #b91c1c)";
  return (
    <div
      role="alert"
      style={{
        marginTop: 12,
        padding: "10px 12px",
        border: `1px solid ${color}`,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        color,
        borderRadius: "var(--radius-sm)",
        fontSize: 12,
        fontWeight: 600,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
      }}
    >
      <Icon name="alert" size={12} aria-hidden />
      <span style={{ flex: 1, minWidth: 0 }}>{message ?? "エラーが発生しました"}</span>
      {cta ? (
        <Link href={cta.href} className="fn-btn fn-btn-sm fn-btn-primary">
          {cta.label}
        </Link>
      ) : null}
      {extraCta ? (
        <Link href={extraCta.href} className="fn-btn fn-btn-sm fn-btn-ghost">
          {extraCta.label}
        </Link>
      ) : null}
    </div>
  );
}
