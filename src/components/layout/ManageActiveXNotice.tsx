import * as React from "react";
import Link from "next/link";
import { getDatabase } from "@/lib/cloudflare";
import {
  getEditableEventIds,
  getManageStaffXUserIds,
  shouldWarnManageActiveXMismatch,
} from "@/lib/auth/ownership";

type ManageActiveXNoticeProps = {
  userId: string;
  activeXUserId: string | null | undefined;
};

/** /manage 本文上部: Active X と運営 X の不一致を示す（入場判定には使わない） */
export async function ManageActiveXNotice({
  userId,
  activeXUserId,
}: ManageActiveXNoticeProps): Promise<React.ReactElement | null> {
  const db = getDatabase();
  if (!db) return null;

  const eventIds = await getEditableEventIds(db, userId);
  if (eventIds.length === 0) return null;

  const manageStaffXIds = await getManageStaffXUserIds(db, userId, eventIds);
  if (!shouldWarnManageActiveXMismatch(activeXUserId, manageStaffXIds)) {
    return null;
  }

  const activeX = activeXUserId?.trim() || null;

  return (
    <div
      role="status"
      style={{
        marginBottom: 14,
        padding: "10px 14px",
        background: "var(--accent-warning-soft, rgba(255,200,0,0.08))",
        border: "1px solid var(--accent-warning, #c08a00)",
        borderRadius: "var(--radius-md)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <strong>Active X ID と運営権限の X ID が一致していません</strong>
      <p style={{ margin: "6px 0 0", color: "var(--text-secondary)" }}>
        運営画面への入場・審査は承認済み X ID 全体で判定されます（現在の Active X:{" "}
        {activeX ? `@${activeX}` : "未選択"}）。投稿や枠確保の主体を変える場合は{" "}
        <Link href="/dashboard/settings">設定</Link> で Active X を切り替えてください。
      </p>
    </div>
  );
}
