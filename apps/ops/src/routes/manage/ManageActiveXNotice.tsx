import * as React from "react";
import { OpsLink as Link } from "../../components/shared/OpsLink.js";
export function shouldWarnManageActiveXMismatch(activeX: string | null | undefined, staffXIds: readonly string[]): boolean {
  const id = activeX?.trim();
  return Boolean(id && staffXIds.length > 0 && !staffXIds.includes(id));
}
export function ManageActiveXNotice({ activeXUserId, manageStaffXUserIds }: {
  activeXUserId: string | null; manageStaffXUserIds: readonly string[];
}): React.ReactElement | null {
  if (!shouldWarnManageActiveXMismatch(activeXUserId, manageStaffXUserIds)) return null;
  return <div role="status" className="manage-active-x-notice">
    <strong>Active X ID と運営権限の X ID が一致していません</strong>
    <p>運営画面への入場・審査は承認済み X ID 全体で判定されます（現在の Active X: @{activeXUserId?.trim()}）。投稿や枠確保の主体を変える場合は{" "}
      <Link href="/dashboard/settings">設定</Link> で Active X を切り替えてください。</p>
  </div>;
}
