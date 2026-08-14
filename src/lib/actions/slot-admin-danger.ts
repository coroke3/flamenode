"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { revalidatePath } from "next/cache";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { slots, videos } from "@/lib/db/schema";
import { buildNotificationOutboxStatement } from "@/lib/notifications/enqueue";
import { buildSlotForceReleasedNotification } from "@/lib/notifications/templates/slot";
import { buildSlotChangeQueueBatch } from "@/lib/staticRebuild/hooks";
import {
  markPendingPublicReflection,
  type PendingPublicReflection,
} from "@/lib/staticRebuild/publicReflectionNotice";
import { MAX_SLOTS_PER_VIDEO } from "@/lib/slots/limits";
import { versionedSlotWhere } from "@/lib/slots/versionedPredicate";

export interface ForceReleaseSubmittedSlotResult extends PendingPublicReflection {
  ok: boolean;
  message?: string;
}

type SlotRow = typeof slots.$inferSelect;

function snapshot(row: SlotRow): Record<string, unknown> {
  return { ...row };
}

function revalidateForceReleasedPaths(eventId: string, videoId: string | null): void {
  revalidatePath(`/manage/events/${eventId}/slots`);
  revalidatePath(`/manage/events/${eventId}`);
  revalidatePath(`/admin/events/${eventId}/slots`);
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath(`/event/${eventId}`);
  revalidatePath(`/event/${eventId}/slots`);
  if (videoId) {
    revalidatePath(`/manage/events/${eventId}/videos/${videoId}`);
    revalidatePath(`/admin/videos/${videoId}`);
    revalidatePath(`/video/${videoId}`);
  }
}

/**
 * 管理者だけが使える「提出済み枠」の強制解放。
 * 作品自体は削除しない。枠との紐付けだけを解除し、同じ作品を参照する提出済み枠が
 * 1件も残らない場合は動画を slotted -> manual に戻す。
 */
export async function forceReleaseSubmittedSlot(
  formData: FormData,
): Promise<ForceReleaseSubmittedSlotResult> {
  const guard = await requireAdminWrite("manage_slot_update");
  if (!guard.ok) return { ok: false, message: guard.message };

  const slotId = String(formData.get("slot_id") ?? "").trim();
  if (!slotId) return { ok: false, message: "slot_id が必要です。" };

  const { db } = guard;
  const row = (
    await db.select().from(slots).where(eq(slots.id, slotId)).limit(1)
  )[0];
  if (!row) return { ok: false, message: "枠が見つかりません。" };
  if (row.status !== "submitted") {
    return { ok: false, message: "提出済みの枠だけ強制解放できます。" };
  }

  const groupId = row.reservation_group_id?.trim() || null;
  const targetRows = groupId
    ? await db
        .select()
        .from(slots)
        .where(
          and(
            eq(slots.event_id, row.event_id),
            eq(slots.reservation_group_id, groupId),
          )!,
        )
        .limit(MAX_SLOTS_PER_VIDEO + 1)
    : [row];

  if (targetRows.length === 0 || targetRows.length > MAX_SLOTS_PER_VIDEO) {
    return {
      ok: false,
      message: `一度に強制解放できる枠は ${MAX_SLOTS_PER_VIDEO} 件までです。`,
    };
  }
  if (
    targetRows.some(
      (candidate) =>
        candidate.status !== "submitted" ||
        candidate.reserved_by_user_id !== row.reserved_by_user_id ||
        candidate.x_user_id !== row.x_user_id ||
        candidate.video_id !== row.video_id,
    )
  ) {
    return {
      ok: false,
      message: "対象グループに状態・予約者・作品の異なる枠が混在しています。",
    };
  }

  const videoId = row.video_id?.trim() || null;
  const targetIds = new Set(targetRows.map((candidate) => candidate.id));
  let videoBefore: typeof videos.$inferSelect | null = null;
  let shouldDetachVideoScheduling = false;

  if (videoId) {
    videoBefore = (
      await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
    )[0] ?? null;
    if (!videoBefore) {
      return {
        ok: false,
        message: "提出済み枠に紐づく作品が見つからないため、安全のため解放を中止しました。",
      };
    }

    const submittedRefs = await db
      .select({ id: slots.id })
      .from(slots)
      .where(and(eq(slots.video_id, videoId), eq(slots.status, "submitted"))!)
      .limit(MAX_SLOTS_PER_VIDEO + 1);
    if (submittedRefs.length > MAX_SLOTS_PER_VIDEO) {
      return {
        ok: false,
        message: "作品に紐づく提出済み枠数が上限を超えているため、安全のため解放を中止しました。",
      };
    }
    shouldDetachVideoScheduling =
      videoBefore.scheduling_type === "slotted" &&
      submittedRefs.every((candidate) => targetIds.has(candidate.id));
  }

  const now = Math.floor(Date.now() / 1000);
  const queue = await buildSlotChangeQueueBatch(db, {
    eventId: row.event_id,
    reason: "slot_admin_force_release_submitted",
    requestedByUserId: guard.user.id,
  });

  const notifications: BatchItem<"sqlite">[] = [];
  if (row.reserved_by_user_id) {
    const notification = await buildNotificationOutboxStatement(db, {
      recipientUserId: row.reserved_by_user_id,
      type: "slot_force_released",
      dedupeKey: `slot_force_released:${row.event_id}:${row.id}:${groupId ?? "solo"}:${row.version}:submitted`,
      payload: buildSlotForceReleasedNotification({
        eventId: row.event_id,
        slotIds: targetRows.map((candidate) => candidate.id),
        reservationGroupId: groupId,
      }),
      eventId: row.event_id,
    });
    if (notification) notifications.push(notification.statement);
  }

  const slotAfterRows = targetRows.map((candidate) => ({
    ...candidate,
    status: "available" as const,
    reserved_by_user_id: null,
    x_user_id: null,
    reserved_x_id_snapshot: null,
    display_name: null,
    reservation_group_id: null,
    video_id: null,
    updated_at: now,
    version: candidate.version + 1,
  }));

  const videoAfter =
    videoBefore && shouldDetachVideoScheduling
      ? {
          ...videoBefore,
          scheduling_type: "manual" as const,
          updated_at: now,
        }
      : null;

  try {
    const mutationStatements: BatchItem<"sqlite">[] = [
      db
        .update(slots)
        .set({
          status: "available",
          reserved_by_user_id: null,
          x_user_id: null,
          reserved_x_id_snapshot: null,
          display_name: null,
          reservation_group_id: null,
          video_id: null,
          updated_at: now,
          version: sql`${slots.version} + 1`,
        })
        .where(versionedSlotWhere(row.event_id, targetRows, "submitted")),
    ];
    const expectedMutationChanges: Array<number | null> = [targetRows.length];
    const audits: Parameters<typeof mutateWithAudit>[1]["audits"][number][] =
      targetRows.map((candidate, index) => ({
        table_name: "slots",
        target_id: candidate.id,
        operation: "UPDATE",
        before: snapshot(candidate),
        after: snapshot(slotAfterRows[index]),
        actor_user_id: guard.user.id,
        context: "slot-admin:force-release-submitted",
        reason: "管理者が提出済み枠を作品を削除せず強制解放",
        retention_class: "long_audit",
        strict: true,
      }));

    if (videoBefore && videoAfter) {
      mutationStatements.push(
        db
          .update(videos)
          .set({ scheduling_type: "manual", updated_at: now })
          .where(
            and(
              eq(videos.id, videoBefore.id),
              eq(videos.updated_at, videoBefore.updated_at),
              eq(videos.scheduling_type, "slotted"),
            )!,
          ),
      );
      expectedMutationChanges.push(1);
      audits.push({
        table_name: "videos",
        target_id: videoBefore.id,
        operation: "UPDATE",
        before: videoBefore,
        after: videoAfter,
        actor_user_id: guard.user.id,
        context: "slot-admin:force-release-submitted",
        reason: "最後の提出済み枠を解放したため作品をmanual schedulingへ移行",
        retention_class: "long_audit",
        strict: true,
      });
    }

    mutationStatements.push(...queue.statements);
    expectedMutationChanges.push(...queue.expectedChanges);

    await mutateWithAudit(db, {
      mutationStatements,
      expectedMutationChanges,
      audits,
      postAuditStatements: notifications,
      notificationWakeSource: notifications.length > 0 ? "admin" : undefined,
      staticRebuildWakeSource: queue.statements.length > 0 ? "admin" : undefined,
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `提出済み枠の強制解放を取り消しました: ${error.message}`
          : "提出済み枠の強制解放を取り消しました。",
    };
  }

  revalidateForceReleasedPaths(row.event_id, videoId);
  return markPendingPublicReflection(
    {
      ok: true,
      message: `${targetRows.length}件の提出済み枠を強制解放しました。作品は削除していません。`,
    },
    queue.statements.length > 0,
  );
}
