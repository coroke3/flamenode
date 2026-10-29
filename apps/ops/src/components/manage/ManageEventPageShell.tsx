import * as React from "react";
import type { CSSProperties } from "react";
import { ConsolePageHeader, type ConsolePageHeaderAction } from "../shared/ConsolePageHeader.js";
import { OpsLink as Link } from "../shared/OpsLink.js";
import { ManageEventTabs } from "./ManageEventTabs.js";

export interface ManageEventPageShellProps {
  eventId: string;
  title: string;
  description?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  actions?: ConsolePageHeaderAction[];
  isAdmin?: boolean;
  children: React.ReactNode;
  accentStyle?: CSSProperties;
  headerChildren?: React.ReactNode;
  pendingCount?: number;
  /** Only overview/edit/playlist read this extra notice data. */
  showActiveXNotice?: boolean;
  activeXUserId?: string | null;
  manageStaffXUserIds?: readonly string[];
}

/** CURRENT's mismatch is a notice only; backend access remains authoritative. */
export function ManageEventPageShell({
  eventId, title, description, backHref = "/manage", backLabel = "担当イベント一覧へ",
  actions, isAdmin = false, children, accentStyle, headerChildren, pendingCount,
  showActiveXNotice = false, activeXUserId, manageStaffXUserIds = [],
}: ManageEventPageShellProps): React.ReactElement {
  const activeX = activeXUserId?.trim() || null;
  const hasMismatch = Boolean(activeX && manageStaffXUserIds.length > 0 && !manageStaffXUserIds.includes(activeX));
  return (
    <div className="manage-event-page-shell" style={accentStyle}>
      {showActiveXNotice && hasMismatch ? (
        <div role="status" className="manage-active-x-notice">
          <strong>Active X ID と運営権限の X ID が一致していません</strong>
          <p>運営画面への入場・審査は承認済み X ID 全体で判定されます（現在の Active X: @{activeX}）。
            投稿や枠確保の主体を変える場合は <Link href="/dashboard/settings">設定</Link> で Active X を切り替えてください。
          </p>
        </div>
      ) : null}
      <ConsolePageHeader title={title} description={description} backHref={backHref} backLabel={backLabel}
        actions={actions} accent>
        {headerChildren}
      </ConsolePageHeader>
      <ManageEventTabs eventId={eventId} isAdmin={isAdmin} pendingCount={pendingCount} />
      {children}
    </div>
  );
}
