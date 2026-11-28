import { and, eq, isNotNull, sql } from "drizzle-orm";
import { videoMembers } from "@flamenode/db/schema";
import { MAX_VIDEO_MEMBERS, MAX_VIDEO_HIDDEN_EDITORS } from "@flamenode/domain/video/atomicLimits";
import { normalizeXId } from "@flamenode/domain/xid";
import { compareSqliteBinaryText } from "./memberSetSnapshot.ts";
import type { ServerCoreDb } from "../db.ts";

type MemberRow = typeof videoMembers.$inferSelect;

export type PermissionMembersRead =
  | { ok: false; message: string }
  | {
      ok: true;
      existingRows: MemberRow[];
      rowsByXid: Map<string, MemberRow[]>;
      currentHiddenEditorCount: number;
    };

/**
 * SA-082..084: bounded snapshot of the selected collaborators and hidden-editor
 * count. The write caller must re-check these reads with the permission-set
 * and hidden-count CAS guards in the SAME atomic D1 mutation batch.
 */
export async function loadPermissionMembersRead(
  db: ServerCoreDb,
  videoId: string,
  xids: readonly string[],
): Promise<PermissionMembersRead> {
  const xidsPayload = JSON.stringify(xids);
  const existingRowLimit = MAX_VIDEO_MEMBERS + MAX_VIDEO_HIDDEN_EDITORS + 1;
  const existingRows = await db
    .select()
    .from(videoMembers)
    .where(
      and(
        eq(videoMembers.video_id, videoId),
        isNotNull(videoMembers.x_user_id),
        sql`lower(${videoMembers.x_user_id}) IN (
          SELECT lower(CAST(value AS TEXT)) FROM json_each(${xidsPayload})
        )`,
      )!,
    )
    .limit(existingRowLimit);
  if (existingRows.length >= existingRowLimit) {
    return {
      ok: false,
      message: "同じ X ID の権限行が多すぎるため、安全に更新できません。重複データを整理してください。",
    };
  }

  const rowsByXid = new Map<string, MemberRow[]>();
  for (const row of existingRows) {
    const key = normalizeXId(row.x_user_id ?? "");
    if (!key) continue;
    const current = rowsByXid.get(key) ?? [];
    current.push(row);
    rowsByXid.set(key, current);
  }
  for (const rows of rowsByXid.values()) {
    rows.sort(
      (left, right) =>
        right.is_public_member - left.is_public_member ||
        right.can_edit - left.can_edit ||
        compareSqliteBinaryText(left.id, right.id),
    );
  }

  const currentHiddenCountRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(videoMembers)
    .where(
      and(
        eq(videoMembers.video_id, videoId),
        eq(videoMembers.is_public_member, 0),
      )!,
    );
  return {
    ok: true,
    existingRows,
    rowsByXid,
    currentHiddenEditorCount: Number(currentHiddenCountRow[0]?.count ?? 0),
  };
}
