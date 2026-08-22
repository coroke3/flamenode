"use server";

import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { assertCanEditEvent } from "@/lib/auth/ownership";
import { writeGuard } from "@/lib/auth/writeGuard";
import { getDatabase } from "@/lib/cloudflare";
import { mutateWithAudit } from "@/lib/audit/mutate";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { slots, videos } from "@/lib/db/schema";
import { buildNotificationOutboxStatement } from "@/lib/notifications/enqueue";
import {
  buildSlotForceReleasedNotification,
  buildSlotSubmissionReleasedNotification,
} from "@/lib/notifications/templates/slot";
import { buildSlotChangeQueueBatch } from "@/lib/staticRebuild/hooks";
import {
  markPendingPublicReflection,
  type PendingPublicReflection,
} from "@/lib/staticRebuild/publicReflectionNotice";
import { MAX_SLOTS_PER_VIDEO } from "@/lib/slots/limits";
import { resolveSlotReservationSubject } from "@/lib/slot/reservationGroupsCore";
import { versionedSlotWhere } from "@/lib/slots/versionedPredicate";

export interface ForceReleaseSubmittedSlotResult extends PendingPublicReflection {
  ok: boolean;
  message?: string;
}

type SlotRow = typeof slots.$inferSelect;
type DB = NonNullable<ReturnType<typeof getDatabase>>;

type SubmittedSlotOperatorContext = {
  db: DB;
  userId: string;
  row: SlotRow;
};

async function authorizeSubmittedSlotOperator(
  slotId: string,
): Promise<
  | { ok: true; context: SubmittedSlotOperatorContext }
  | { ok: false; result: ForceReleaseSubmittedSlotResult }
> {
  let guard: Awaited<ReturnType<typeof writeGuard>>;
  try {
    guard = await writeGuard({ feature: "manage_slot_update" });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[authorizeSubmittedSlotOperator] write guard failed", error);
    return {
      ok: false,
      result: { ok: false, message: "認証状態を確認できませんでした。時間をおいて再試行してください。" },
    };
  }
  if (!guard.ok) return { ok: false, result: { ok: false, message: guard.message } };

  let row: SlotRow | undefined;
  try {
    row = (
      await guard.db.select().from(slots).where(eq(slots.id, slotId)).limit(1)
    )[0];
  } catch (error) {
    unstable_rethrow(error);
    console.error("[authorizeSubmittedSlotOperator] slot lookup failed", error);
    return {
      ok: false,
      result: { ok: false, message: "枠の状態を確認できませんでした。時間をおいて再試行してください。" },
    };
  }
  if (!row) {
    return { ok: false, result: { ok: false, message: "対象の枠が見つかりません。" } };
  }

  try {
    await assertCanEditEvent(
      guard.db,
      { id: guard.user.id, role: guard.user.role ?? null },
      row.event_id,
      "event.slots",
    );
  } catch (error) {
    unstable_rethrow(error);
    return {
      ok: false,
      result: { ok: false, message: "このイベントの枠を操作する権限がありません。" },
    };
  }

  return { ok: true, context: { db: guard.db, userId: guard.user.id, row } };
}

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

type SubmittedSlotReleasePreparation =
  | {
      ok: true;
      groupId: string | null;
      targetRows: SlotRow[];
      videoId: string;
      videoBefore: typeof videos.$inferSelect;
      shouldDetachVideoScheduling: boolean;
    }
  | { ok: false; message: string };

async function prepareSubmittedSlotRelease(
  db: DB,
  row: SlotRow,
): Promise<SubmittedSlotReleasePreparation> {
  if (row.status !== "submitted") {
    return { ok: false, message: "提出済みの枠だけを操作できます。" };
  }

  const groupValue = row.reservation_group_id;
  const groupId = groupValue?.trim() || null;
  const targetRows = groupId
    ? await db
        .select()
        .from(slots)
        .where(
          and(
            eq(slots.event_id, row.event_id),
            eq(slots.reservation_group_id, groupValue!),
          )!,
        )
        .limit(MAX_SLOTS_PER_VIDEO + 1)
    : [row];

  if (
    targetRows.length === 0 ||
    targetRows.length > MAX_SLOTS_PER_VIDEO ||
    !targetRows.some((candidate) => candidate.id === row.id)
  ) {
    return {
      ok: false,
      message: "提出グループの状態が変わりました。画面を更新して再試行してください。",
    };
  }

  const first = targetRows[0]!;
  if (
    targetRows.some(
      (candidate) =>
        candidate.status !== "submitted" ||
        candidate.reserved_by_user_id !== row.reserved_by_user_id ||
        candidate.x_user_id !== row.x_user_id ||
        candidate.reserved_x_id_snapshot !== row.reserved_x_id_snapshot ||
        candidate.display_name !== row.display_name ||
        candidate.video_id !== row.video_id,
    )
  ) {
    return {
      ok: false,
      message: "提出グループの予約情報または作品が一致しないため中止しました。",
    };
  }

  const subjectResult = resolveSlotReservationSubject(targetRows);
  if (!subjectResult.ok) {
    return {
      ok: false,
      message: "提出グループの予約情報が不整合なため中止しました。",
    };
  }
  if (subjectResult.subject.reservedByUserId !== first.reserved_by_user_id?.trim()) {
    return {
      ok: false,
      message: "提出グループの取得者情報が不整合なため中止しました。",
    };
  }

  const videoId = row.video_id?.trim() || "";
  if (!videoId) {
    return {
      ok: false,
      message: "提出済み枠に紐づく作品が見つかりません。",
    };
  }
  const videoBefore = (
    await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  )[0];
  if (!videoBefore) {
    return {
      ok: false,
      message: "提出済み枠に紐づく作品が見つからないため中止しました。",
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
      message: "作品を参照する提出済み枠が上限を超えているため中止しました。",
    };
  }
  const targetIds = new Set(targetRows.map((candidate) => candidate.id));
  return {
    ok: true,
    groupId,
    targetRows,
    videoId,
    videoBefore,
    shouldDetachVideoScheduling:
      videoBefore.scheduling_type === "slotted" &&
      submittedRefs.every((candidate) => targetIds.has(candidate.id)),
  };
}

/**
 * global admin または対象イベントの event.slots 運営が使える「提出済み枠」の強制解放。
 * 作品自体は削除しない。枠との紐付けだけを解除し、同じ作品を参照する提出済み枠が
 * 1件も残らない場合は動画を slotted -> manual に戻す。
 */
export async function forceReleaseSubmittedSlot(
  formData: FormData,
): Promise<ForceReleaseSubmittedSlotResult> {
  const slotId = String(formData.get("slot_id") ?? "").trim();
  if (!slotId) return { ok: false, message: "slot_id が必要です。" };

  const authorization = await authorizeSubmittedSlotOperator(slotId);
  if (!authorization.ok) return authorization.result;

  const { db, row } = authorization.context;
  if (!row) return { ok: false, message: "枠が見つかりません。" };
  try {
  if (row.status !== "submitted") {
    return { ok: false, message: "提出済みの枠だけ強制解放できます。" };
  }

  const groupValue = row.reservation_group_id;
  const groupId = groupValue?.trim() || null;
  const targetRows = groupId
    ? await db
        .select()
        .from(slots)
        .where(
          and(
            eq(slots.event_id, row.event_id),
            // Match the stored value exactly. Legacy reservations may carry
            // surrounding whitespace; trimming here would make the group
            // query miss its sibling rows and could turn a group operation
            // into an anchor-only release.
            eq(slots.reservation_group_id, groupValue!),
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
  // A concurrent submit/release can split the group between the anchor read
  // and this query. Do not force-release a different remaining group.
  if (!targetRows.some((candidate) => candidate.id === row.id)) {
    return {
      ok: false,
      message: "指定した枠の状態が変わりました。再試行してください。",
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
    videoBefore =
      (
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
    requestedByUserId: authorization.context.userId,
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
    const audits: WriteAuditLogInput[] = targetRows.map((candidate, index) => ({
      table_name: "slots",
      target_id: candidate.id,
      operation: "UPDATE",
      before: snapshot(candidate),
      after: snapshot(slotAfterRows[index]),
      actor_user_id: authorization.context.userId,
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
        actor_user_id: authorization.context.userId,
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

  try {
    revalidateForceReleasedPaths(row.event_id, videoId);
  } catch (error) {
    console.warn("[forceReleaseSubmittedSlot] post-commit revalidation failed", error);
  }
  return markPendingPublicReflection(
    {
      ok: true,
      message: `${targetRows.length}件の提出済み枠を強制解放しました。作品は削除していません。`,
    },
    queue.statements.length > 0,
  );
  } catch (error) {
    unstable_rethrow(error);
    console.error("[forceReleaseSubmittedSlot] preparation failed", error);
    return {
      ok: false,
      message: "提出済み枠の状態を確認できませんでした。時間をおいて再試行してください。",
    };
  }
}

/**
 * Submitted video を枠から外し、予約情報を維持したまま reserved に戻す。
 * 予約者は同じ枠へ別作品を提出できる。video レコード自体は保持する。
 */
export async function releaseSubmittedVideoKeepReservation(
  formData: FormData,
): Promise<ForceReleaseSubmittedSlotResult> {
  const slotId = String(formData.get("slot_id") ?? "").trim();
  if (!slotId) return { ok: false, message: "slot_id が必要です。" };

  const authorization = await authorizeSubmittedSlotOperator(slotId);
  if (!authorization.ok) return authorization.result;
  const { db, row, userId } = authorization.context;

  let prepared: SubmittedSlotReleasePreparation;
  try {
    prepared = await prepareSubmittedSlotRelease(db, row);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[releaseSubmittedVideoKeepReservation] preparation failed", error);
    return {
      ok: false,
      message: "提出済み枠の状態を確認できませんでした。時間をおいて再試行してください。",
    };
  }
  if (!prepared.ok) return prepared;

  const { groupId, targetRows, videoId, videoBefore } = prepared;
  const now = Math.floor(Date.now() / 1000);
  let queue: Awaited<ReturnType<typeof buildSlotChangeQueueBatch>>;
  const notifications: BatchItem<"sqlite">[] = [];
  try {
    queue = await buildSlotChangeQueueBatch(db, {
      eventId: row.event_id,
      reason: "slot_admin_release_submitted_video",
      requestedByUserId: userId,
    });
    if (row.reserved_by_user_id) {
      const notification = await buildNotificationOutboxStatement(db, {
        recipientUserId: row.reserved_by_user_id,
        type: "slot_submission_released",
        dedupeKey: `slot_submission_released:${row.event_id}:${row.id}:${groupId ?? "solo"}:${row.version}:submitted`,
        payload: buildSlotSubmissionReleasedNotification({
          eventId: row.event_id,
          slotIds: targetRows.map((candidate) => candidate.id),
          reservationGroupId: groupId,
        }),
        eventId: row.event_id,
      });
      if (notification) notifications.push(notification.statement);
    }
  } catch (error) {
    unstable_rethrow(error);
    console.error("[releaseSubmittedVideoKeepReservation] queue preparation failed", error);
    return {
      ok: false,
      message: "公開反映または通知の準備に失敗したため、操作を中止しました。",
    };
  }

  const slotAfterRows = targetRows.map((candidate) => ({
    ...candidate,
    status: "reserved" as const,
    video_id: null,
    updated_at: now,
    version: candidate.version + 1,
  }));
  const videoAfter = prepared.shouldDetachVideoScheduling
    ? { ...videoBefore, scheduling_type: "manual" as const, updated_at: now }
    : null;

  try {
    const mutationStatements: BatchItem<"sqlite">[] = [
      db
        .update(slots)
        .set({
          status: "reserved",
          video_id: null,
          updated_at: now,
          version: sql`${slots.version} + 1`,
        })
        .where(versionedSlotWhere(row.event_id, targetRows, "submitted")),
    ];
    const expectedMutationChanges: Array<number | null> = [targetRows.length];
    const audits: WriteAuditLogInput[] = targetRows.map((candidate, index) => ({
      table_name: "slots",
      target_id: candidate.id,
      operation: "UPDATE",
      before: snapshot(candidate),
      after: snapshot(slotAfterRows[index]),
      actor_user_id: userId,
      context: "slot-admin:release-submitted-video",
      reason: "予約を維持したまま提出作品を解除",
      retention_class: "long_audit",
      strict: true,
    }));

    if (videoAfter) {
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
        actor_user_id: userId,
        context: "slot-admin:release-submitted-video",
        reason: "提出済み参照がなくなったため manual scheduling へ戻す",
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
          ? `提出作品の解除に失敗しました: ${error.message}`
          : "提出作品の解除に失敗しました。",
    };
  }

  try {
    revalidateForceReleasedPaths(row.event_id, videoId);
  } catch (error) {
    console.warn(
      "[releaseSubmittedVideoKeepReservation] post-commit revalidation failed",
      error,
    );
  }
  return markPendingPublicReflection(
    {
      ok: true,
      message: `${targetRows.length}枠の提出作品を解除しました。予約状態は維持されています。`,
    },
    queue.statements.length > 0,
  );
}
