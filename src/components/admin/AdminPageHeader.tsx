import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

export interface AdminPageHeaderAction {
  href: string;
  label: string;
  icon?: React.ReactNode;
  variant?: "primary" | "ghost" | "danger";
}

export interface AdminPageHeaderProps {
  title: string;
  description?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  actions?: AdminPageHeaderAction[];
}

function variantClass(variant: AdminPageHeaderAction["variant"]): string {
  switch (variant) {
    case "primary":
      return "fn-btn fn-btn-primary fn-btn-sm";
    case "danger":
      return "fn-btn fn-btn-danger fn-btn-sm";
    case "ghost":
    default:
      return "fn-btn fn-btn-ghost fn-btn-sm";
  }
}

/**
 * admin 配下ページの共通上部ヘッダー。
 */
export function AdminPageHeader({
  title,
  description,
  backHref,
  backLabel = "戻る",
  actions = [],
}: AdminPageHeaderProps): React.ReactElement {
  return (
    <header className="fn-console-head">
      <div className="fn-console-head-main">
        {backHref ? (
          <p className="fn-console-back">
            <Link href={backHref}>
              <Icon name="chevron-left" size={12} aria-hidden /> {backLabel}
            </Link>
          </p>
        ) : null}
        <h1 className="fn-console-title">{title}</h1>
        {description ? (
          <div className="fn-console-lead">{description}</div>
        ) : null}
      </div>
      {actions.length > 0 ? (
        <div className="fn-console-actions">
          {actions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className={variantClass(action.variant)}
            >
              {action.icon}
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </header>
  );
}
