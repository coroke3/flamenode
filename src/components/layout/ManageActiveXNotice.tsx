import * as React from "react";
import Link from "next/link";
import { shouldWarnManageActiveXMismatch } from "@/lib/auth/ownership";

type ManageActiveXNoticeProps = {
  activeXUserId: string | null | undefined;
  manageStaffXUserIds: readonly string[];
};

/** /manage 本文上部: Active X と運営 X の不一致を示す（入場判定には使わない） */
export function ManageActiveXNotice({
  activeXUserId,
  manageStaffXUserIds,
}: ManageActiveXNoticeProps): React.ReactElement | null {
  if (!shouldWarnManageActiveXMismatch(activeXUserId, manageStaffXUserIds)) {
    return null;
  }

  const activeX = activeXUserId?.trim() || null;

  return (
    <div role="status" className="manage-active-x-notice">
      <strong>Active X ID と運営権限の X ID が一致していません</strong>
      <p>
        運営画面への入場・審査は承認済み X ID 全体で判定されます（現在の Active X:{" "}
        {activeX ? `@${activeX}` : "未選択"}）。投稿や枠確保の主体を変える場合は{" "}
        <Link href="/dashboard/settings">設定</Link> で Active X を切り替えてください。
      </p>
    </div>
  );
}
