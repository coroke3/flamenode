"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import {
  eventStaff,
  historyLogs,
  slots,
  videoChapters,
  videoInteractions,
  videoMembers,
  videos,
  xAccountLinkRequests,
  xUserAliases,
  xUsers,
} from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";

export interface MergeXIdsResult {
  ok: boolean;
  message?: string;
  fromXId?: string;
  toXId?: string;
  counts?: Record<string, number>;
}

/**
 * X ID merge Server Action (Opus #8 Phase B 最小実装)。
 *
 * - admin 限定
 * - dry-run なしのため必ず docs/merge-flow-design.md を読んでから実行
 * - video_interactions の UNIQUE 衝突対策: 旧 ID の重複行を先に DELETE
 * - history_logs (long_audit) に before/after 件数を記録
 * - 通知は enqueue しない (本人通知は Phase C で別 UI から発火)
 */
export async function mergeXIds(
  formData: FormData,
): Promise<MergeXIdsResult> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id || u.role !== "admin") {
    return { ok: false, message: "admin のみ実行できます。" };
  }

  const fromRaw = String(formData.get("from") ?? "").trim();
  const toRaw = String(formData.get("to") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();
  const fromXId = normalizeXId(fromRaw);
  const toXId = normalizeXId(toRaw);

  if (!fromXId || !toXId) {
    return { ok: false, message: "from / to が必要です。" };
  }
  if (fromXId === toXId) {
    return { ok: false, message: "from と to が同じ X ID です。" };
  }
  if (confirm !== "MERGE") {
    return { ok: false, message: "確認文字列 'MERGE' が一致しません。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  // 両 ID の存在確認
  const [fromRow, toRow] = await Promise.all([
    db.select().from(xUsers).where(eq(xUsers.id, fromXId)).limit(1),
    db.select().from(xUsers).where(eq(xUsers.id, toXId)).limit(1),
  ]);
  if (fromRow.length === 0) {
    return { ok: false, message: `from X ID @${fromXId} が見つかりません。` };
  }
  if (toRow.length === 0) {
    return { ok: false, message: `to X ID @${toXId} が見つかりません。` };
  }

  const now = Math.floor(Date.now() / 1000);

  // 影響件数を事前集計
  const [vc, cc, mc, sc, ic, ec] = await Promise.all([
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videos)
      .where(eq(videos.creator_x_user_id, fromXId)),
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videoChapters)
      .where(eq(videoChapters.x_user_id, fromXId)),
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videoMembers)
      .where(eq(videoMembers.x_user_id, fromXId)),
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(slots)
      .where(eq(slots.x_user_id, fromXId)),
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videoInteractions)
      .where(eq(videoInteractions.x_user_id, fromXId)),
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(eventStaff)
      .where(eq(eventStaff.x_user_id, fromXId)),
  ]);
  const counts = {
    videos: Number(vc[0]?.c ?? 0),
    video_chapters: Number(cc[0]?.c ?? 0),
    video_members: Number(mc[0]?.c ?? 0),
    slots: Number(sc[0]?.c ?? 0),
    video_interactions: Number(ic[0]?.c ?? 0),
    event_staff: Number(ec[0]?.c ?? 0),
  };

  // video_interactions UNIQUE 衝突対策: 旧 ID の (video_id, interaction_type) が
  // 新 ID にも存在する場合は旧 ID 側を先に削除する。
  await db.run(sql`
    DELETE FROM video_interactions
    WHERE x_user_id = ${fromXId}
      AND EXISTS (
        SELECT 1 FROM video_interactions b
        WHERE b.x_user_id = ${toXId}
          AND b.video_id = video_interactions.video_id
          AND b.interaction_type = video_interactions.interaction_type
      )
  `);

  // event_staff の UNIQUE 制約 (event_id, x_user_id) 衝突対策: 旧側 (旧 ID + 同 event) を削除
  await db.run(sql`
    DELETE FROM event_staff
    WHERE x_user_id = ${fromXId}
      AND EXISTS (
        SELECT 1 FROM event_staff b
        WHERE b.x_user_id = ${toXId}
          AND b.event_id = event_staff.event_id
      )
  `);

  // 各テーブルで x_user_id / creator_x_user_id を付け替え
  await db.update(videos).set({ creator_x_user_id: toXId }).where(eq(videos.creator_x_user_id, fromXId));
  await db.update(videoChapters).set({ x_user_id: toXId }).where(eq(videoChapters.x_user_id, fromXId));
  await db.update(videoMembers).set({ x_user_id: toXId }).where(eq(videoMembers.x_user_id, fromXId));
  await db.update(slots).set({ x_user_id: toXId }).where(eq(slots.x_user_id, fromXId));
  await db
    .update(videoInteractions)
    .set({ x_user_id: toXId })
    .where(eq(videoInteractions.x_user_id, fromXId));
  await db
    .update(eventStaff)
    .set({ x_user_id: toXId })
    .where(eq(eventStaff.x_user_id, fromXId));

  // x_user_aliases に旧 ID を新 ID の別名として記録 (重複は ON CONFLICT で無視)
  try {
    await db
      .insert(xUserAliases)
      .values({ x_user_id: toXId, alias_x_id: fromXId })
      .onConflictDoNothing();
  } catch {
    // composite PK 重複は無視
  }

  // 旧 x_users の Discord 紐付けを外す (行自体は保持)
  await db
    .update(xUsers)
    .set({ linked_discord_user_id: null })
    .where(and(eq(xUsers.id, fromXId))!);

  // pending 状態の x_account_link_requests (link_type=merge, requested_x_id=fromXId, target_x_user_id=toXId)
  // を一括で approved にする (UI からの承認ボタンを兼ねる)
  await db.run(sql`
    UPDATE x_account_link_requests
    SET status = 'approved'
    WHERE status = 'pending'
      AND link_type = 'merge'
      AND requested_x_id = ${fromXId}
      AND target_x_user_id = ${toXId}
  `);

  // 監査ログ (long_audit)
  await db.insert(historyLogs).values({
    table_name: "x_users",
    record_id: fromXId,
    action: "UPDATE",
    before_data: JSON.stringify({ x_user_id: fromXId, linked_discord_user_id: fromRow[0].linked_discord_user_id }),
    after_data: JSON.stringify({
      merged_into: toXId,
      counts,
      executor: u.id,
    }),
    operator_discord_id: u.id,
    retention_class: "long_audit",
    created_at: now,
  });

  revalidatePath("/admin/x-link-requests");
  revalidatePath(`/admin/users`);
  revalidatePath(`/user/${fromXId}`);
  revalidatePath(`/user/${toXId}`);

  return {
    ok: true,
    message: `@${fromXId} → @${toXId} に merge しました (合計 ${Object.values(counts).reduce((a, b) => a + b, 0)} 行)。`,
    fromXId,
    toXId,
    counts,
  };
}
