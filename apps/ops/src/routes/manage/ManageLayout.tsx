import * as React from "react";
import type { ManageNavigationResponse } from "@flamenode/contracts";
import { loadManageNavigation } from "../../api/manageNavigation.js";
import { useApiResult } from "../useApiResult.js";
import { ConsoleShell } from "../../components/shared/ConsoleShell.js";
import { CostGuardBanner } from "../../components/layout/CostGuardBanner.js";
import { ManageSidebarNav } from "./ManageSidebarNav.js";
import { shouldWarnManageActiveXMismatch } from "./ManageActiveXNotice.js";
import { AUTH_UNAVAILABLE } from "../guard.js";

export function decideManageNavigation(result: { status: string; reason?: string }): string | null {
  if (result.status === "ok") return null;
  if (result.status === "anonymous") return "/entry";
  if (result.status === "forbidden" && result.reason === "manage_access_required") return "/dashboard";
  if (result.status === "loading") return null;
  return AUTH_UNAVAILABLE;
}
export function shouldRenderManageSidebar(data: ManageNavigationResponse): boolean {
  return data.access.isAdmin || data.events.length > 0 || data.access.canManageXIdLinkRequests;
}
export function ManageLayout({ children, fetchFn = fetch }: {
  children: React.ReactNode; fetchFn?: typeof fetch;
}): React.ReactElement {
  const result = useApiResult(signal => loadManageNavigation(fetchFn, signal), "manage-navigation");
  const redirect = decideManageNavigation(result);
  React.useEffect(() => { if (redirect) window.location.assign(redirect); }, [redirect]);
  if (result.status !== "ok") return <div role="status" aria-busy="true">読み込み中...</div>;
  const data = result.data;
  const sidebar = shouldRenderManageSidebar(data) ? <aside className="admin-sidebar">
    <div className="manage-mode-banner"><span className="manage-mode-badge">MANAGE</span><span className="manage-mode-label">イベント運営</span><p className="manage-mode-hint">担当イベントの審査・枠・通知を確認できます。サイト全体の管理は管理者のみ <strong>/admin</strong> で行います。</p></div>
    <ManageSidebarNav events={data.events} showXLinkRequests={data.access.canManageXIdLinkRequests}
      warnActiveX={!data.access.isAdmin && shouldWarnManageActiveXMismatch(data.activeXUserId, data.manageStaffXUserIds)}
      activeX={data.activeXUserId} /></aside> : null;
  return <div data-manage-shell data-fn-surface="manage">
    <CostGuardBanner fetchFn={fetchFn} />
    <ConsoleShell consoleMode="manage" navigation={sidebar}><main className="manage-main">{children}</main></ConsoleShell>
  </div>;
}
