import * as React from "react";
import type { CSSProperties } from "react";
import { ManageActiveXNotice } from "@/components/layout/ManageActiveXNotice";
import {
  ConsolePageHeader,
  type ConsolePageHeaderAction,
} from "@/components/layout/ConsolePageHeader";
import { ManageEventTabs } from "@/components/manage/ManageEventTabs";

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
  /** overview / edit / youtube-playlist only — each notice adds D1 reads. */
  showActiveXNotice?: boolean;
  activeXUserId?: string | null;
  manageStaffXUserIds?: readonly string[];
}

export function ManageEventPageShell({
  eventId,
  title,
  description,
  backHref = "/manage",
  backLabel = "担当イベント一覧へ",
  actions,
  isAdmin = false,
  children,
  accentStyle,
  headerChildren,
  pendingCount,
  showActiveXNotice = false,
  activeXUserId,
  manageStaffXUserIds = [],
}: ManageEventPageShellProps): React.ReactElement {
  return (
    <div className="manage-event-page-shell" style={accentStyle}>
      {showActiveXNotice ? (
        <ManageActiveXNotice
          activeXUserId={activeXUserId ?? null}
          manageStaffXUserIds={manageStaffXUserIds}
        />
      ) : null}
      <ConsolePageHeader
        title={title}
        description={description}
        backHref={backHref}
        backLabel={backLabel}
        actions={actions}
        accent
      >
        {headerChildren}
      </ConsolePageHeader>
      <ManageEventTabs
        eventId={eventId}
        isAdmin={isAdmin}
        pendingCount={pendingCount}
      />
      {children}
    </div>
  );
}
