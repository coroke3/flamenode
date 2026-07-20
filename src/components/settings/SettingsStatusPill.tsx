import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import pageStyles from "./settings-page.module.css";

export type XApprovalStatus = "approved" | "pending" | "rejected" | "imported";

const META: Record<
  XApprovalStatus,
  { tone: string; label: string; dot?: boolean; icon?: "check" }
> = {
  approved: { tone: "ok", label: "承認済み", icon: "check" },
  pending: { tone: "warn", label: "申請中", dot: true },
  rejected: { tone: "muted", label: "却下", dot: true },
  imported: { tone: "ok", label: "移行済み", icon: "check" },
};

export function SettingsStatusPill({
  status,
  children,
}: {
  status: XApprovalStatus;
  children?: React.ReactNode;
}): React.ReactElement {
  const m = META[status];
  const className =
    status === "approved" || status === "imported"
      ? "fn-badge fn-badge-neutral"
      : status === "pending"
        ? "fn-badge fn-badge-warning"
        : "fn-badge fn-badge-neutral";

  return (
    <span className={className}>
      {m.dot ? (
        <span className={pageStyles.pillDot} aria-hidden="true">
          ●
        </span>
      ) : null}
      {m.icon ? <Icon name={m.icon} size={11} aria-hidden /> : null}
      {children ?? m.label}
    </span>
  );
}
