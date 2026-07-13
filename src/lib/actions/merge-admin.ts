"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import {
  eventStaff,
  slots,
  videoChapters,
  videoInteractions,
  videoMembers,
  videos,
  xUserAliases,
  xUserIcons,
  xUsers,
} from "@/lib/db/schema";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { planXIdMergeEventStaffOwnerProtection } from "@/lib/event/eventOwnershipCore";
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
 * - audit_logs (long_audit) に before/after 件数を記録
 * - 通知は enqueue しない (本人通知は別フェーズの UI から発火)
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

  // 影響件数と owner 競合を事前集計する。後続 batch の changes() 検査に使うため、
  // 同時更新が発生した場合は fail-closed で全操作を rollback する。
  const [vc, cc, mc, sc, ic, ec, iconc, aliasOwnerc, aliasRefc, aliasSourceRefc, interactionCollisionc, iconCollisionc, aliasCollisionc, linkRequestc, affectedStaff] = await Promise.all([
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
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(xUserIcons)
      .where(eq(xUserIcons.x_user_id, fromXId)),
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(xUserAliases)
      .where(eq(xUserAliases.x_user_id, fromXId)),
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(xUserAliases)
      .where(eq(xUserAliases.alias_x_id, fromXId)),
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(xUserAliases)
      .where(and(
        eq(xUserAliases.x_user_id, fromXId),
        eq(xUserAliases.alias_x_id, fromXId),
      )!),
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videoInteractions)
      .where(sql`
        ${videoInteractions.x_user_id} = ${fromXId}
        AND EXISTS (
          SELECT 1 FROM video_interactions b
          WHERE b.x_user_id = ${toXId}
            AND b.video_id = ${videoInteractions.video_id}
            AND b.interaction_type = ${videoInteractions.interaction_type}
        )
      `),
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(xUserIcons)
      .where(sql`
        ${xUserIcons.x_user_id} = ${fromXId}
        AND EXISTS (
          SELECT 1 FROM x_user_icons b
          WHERE b.x_user_id = ${toXId}
            AND b.icon_url = ${xUserIcons.icon_url}
        )
      `),
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(xUserAliases)
      .where(sql`
        ${xUserAliases.x_user_id} = ${fromXId}
        AND ${xUserAliases.alias_x_id} <> ${fromXId}
        AND EXISTS (
          SELECT 1 FROM x_user_aliases b
          WHERE b.x_user_id = ${toXId}
            AND b.alias_x_id = ${xUserAliases.alias_x_id}
        )
      `),
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(sql`x_account_link_requests`)
      .where(sql`
        status = 'pending'
          AND link_type = 'merge'
          AND requested_x_id = ${fromXId}
          AND target_x_user_id = ${toXId}
      `),
    db
      .select()
      .from(eventStaff)
      .where(inArray(eventStaff.x_user_id, [fromXId, toXId])),
  ]);
  const counts = {
    videos: Number(vc[0]?.c ?? 0),
    video_chapters: Number(cc[0]?.c ?? 0),
    video_members: Number(mc[0]?.c ?? 0),
    slots: Number(sc[0]?.c ?? 0),
    video_interactions: Number(ic[0]?.c ?? 0),
    event_staff: Number(ec[0]?.c ?? 0),
    x_user_icons: Number(iconc[0]?.c ?? 0),
    x_user_aliases_owner: Number(aliasOwnerc[0]?.c ?? 0),
    x_user_aliases_ref: Number(aliasRefc[0]?.c ?? 0),
  };

  const mergeOwnerPlan = planXIdMergeEventStaffOwnerProtection({
    rows: affectedStaff,
    fromXUserId: fromXId,
    toXUserId: toXId,
  });
  const collidedSourceStaffIds = new Set(mergeOwnerPlan.collidedSourceStaffIds);
  const promotedTargetStaffIds = new Set(mergeOwnerPlan.promotedTargetStaffIds);
  const collisionCount = collidedSourceStaffIds.size;
  const promotionCount = promotedTargetStaffIds.size;
  const interactionCollisionCount = Number(interactionCollisionc[0]?.c ?? 0);
  const iconCollisionCount = Number(iconCollisionc[0]?.c ?? 0);
  const aliasCollisionCount = Number(aliasCollisionc[0]?.c ?? 0);
  const aliasSourceRefCount = Number(aliasSourceRefc[0]?.c ?? 0);
  const linkRequestCount = Number(linkRequestc[0]?.c ?? 0);
  const mergedStaffAfter = affectedStaff
    .filter((row) => !collidedSourceStaffIds.has(row.id))
    .map((row) => {
      if (promotedTargetStaffIds.has(row.id)) {
        return {
          ...row,
          permission_preset: "owner" as const,
          role: "representative" as const,
          updated_at: now,
        };
      }
      if (row.x_user_id === fromXId) {
        return { ...row, x_user_id: toXId, updated_at: now };
      }
      return row;
    });

  try {
    await mutateWithAudit(db, {
      mutationStatements: [
        db.run(sql`
          DELETE FROM video_interactions
          WHERE x_user_id = ${fromXId}
            AND EXISTS (
              SELECT 1 FROM video_interactions b
              WHERE b.x_user_id = ${toXId}
                AND b.video_id = video_interactions.video_id
                AND b.interaction_type = video_interactions.interaction_type
            )
        `),
        db.run(sql`
          UPDATE event_staff
          SET permission_preset = 'owner', role = 'representative', updated_at = ${now}
          WHERE x_user_id = ${toXId}
            AND EXISTS (
              SELECT 1 FROM event_staff source
              WHERE source.x_user_id = ${fromXId}
                AND source.event_id = event_staff.event_id
                AND source.permission_preset = 'owner'
            )
            AND permission_preset <> 'owner'
        `),
        db.run(sql`
          DELETE FROM event_staff
          WHERE x_user_id = ${fromXId}
            AND EXISTS (
              SELECT 1 FROM event_staff b
              WHERE b.x_user_id = ${toXId}
                AND b.event_id = event_staff.event_id
            )
        `),
        db.run(sql`
          DELETE FROM x_user_icons
          WHERE x_user_id = ${fromXId}
            AND EXISTS (
              SELECT 1 FROM x_user_icons b
              WHERE b.x_user_id = ${toXId}
                AND b.icon_url = x_user_icons.icon_url
            )
        `),
        db.run(sql`
          DELETE FROM x_user_aliases WHERE alias_x_id = ${fromXId}
        `),
        db.run(sql`
          DELETE FROM x_user_aliases
          WHERE x_user_id = ${fromXId}
            AND alias_x_id <> ${fromXId}
            AND EXISTS (
              SELECT 1 FROM x_user_aliases b
              WHERE b.x_user_id = ${toXId}
                AND b.alias_x_id = x_user_aliases.alias_x_id
            )
        `),
        db.run(sql`UPDATE videos SET creator_x_user_id = ${toXId} WHERE creator_x_user_id = ${fromXId}`),
        db.run(sql`UPDATE video_chapters SET x_user_id = ${toXId} WHERE x_user_id = ${fromXId}`),
        db.run(sql`UPDATE video_members SET x_user_id = ${toXId} WHERE x_user_id = ${fromXId}`),
        db.run(sql`UPDATE slots SET x_user_id = ${toXId} WHERE x_user_id = ${fromXId}`),
        db.run(sql`UPDATE video_interactions SET x_user_id = ${toXId} WHERE x_user_id = ${fromXId}`),
        db.run(sql`
          UPDATE event_staff
          SET x_user_id = ${toXId}, updated_at = ${now}
          WHERE x_user_id = ${fromXId}
        `),
        db.run(sql`UPDATE x_user_icons SET x_user_id = ${toXId} WHERE x_user_id = ${fromXId}`),
        db.run(sql`UPDATE x_user_aliases SET x_user_id = ${toXId} WHERE x_user_id = ${fromXId}`),
        db.run(sql`INSERT INTO x_user_aliases (x_user_id, alias_x_id) VALUES (${toXId}, ${fromXId})`),
        db.run(sql`UPDATE x_users SET linked_user_id = NULL WHERE id = ${fromXId}`),
        db.run(sql`
          UPDATE x_account_link_requests
          SET status = 'approved'
          WHERE status = 'pending'
            AND link_type = 'merge'
            AND requested_x_id = ${fromXId}
            AND target_x_user_id = ${toXId}
        `),
      ],
      expectedMutationChanges: [
        interactionCollisionCount,
        promotionCount,
        collisionCount,
        iconCollisionCount,
        counts.x_user_aliases_ref,
        aliasCollisionCount,
        counts.videos,
        counts.video_chapters,
        counts.video_members,
        counts.slots,
        counts.video_interactions - interactionCollisionCount,
        counts.event_staff - collisionCount,
        counts.x_user_icons - iconCollisionCount,
        counts.x_user_aliases_owner - aliasSourceRefCount - aliasCollisionCount,
        1,
        1,
        linkRequestCount,
      ],
      audits: [{
        table_name: "x_users",
        target_id: fromXId,
        operation: "MERGE",
        before: {
          from_x_user: fromRow[0],
          to_x_user: toRow[0],
          event_staff: affectedStaff,
          counts,
        },
        after: {
          from_x_user: { ...fromRow[0], linked_user_id: null },
          to_x_user: toRow[0],
          event_staff: mergedStaffAfter,
          merged_into: toXId,
          counts,
          collision_counts: {
            video_interactions: interactionCollisionCount,
            event_staff: collisionCount,
            promoted_event_staff: promotionCount,
            x_user_icons: iconCollisionCount,
            x_user_aliases: aliasCollisionCount,
          },
        },
        actor_user_id: u.id,
        reason: "管理者による X ID 統合",
        context: "x-id-merge",
        retention_class: "long_audit",
        restore_strategy: "none",
        strict: true,
      }],
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "X ID 統合を安全に確定できませんでした。",
    };
  }

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
