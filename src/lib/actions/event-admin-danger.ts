"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { events } from "@/lib/db/schema";
import { invalidateEventExportCache } from "@/lib/api/eventExportCache";
import { buildEventChangeQueueBatch } from "@/lib/staticRebuild/hooks";
import {
  markPendingPublicReflection,
  type PendingPublicReflection,
} from "@/lib/staticRebuild/publicReflectionNotice";

export interface RenameEventIdResult extends PendingPublicReflection {
  ok: boolean;
  message?: string;
  eventId?: string;
}

const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function revalidateRenamedEventPaths(oldId: string, newId: string): void {
  revalidatePath("/admin/events");
  revalidatePath("/manage");
  revalidatePath("/event");
  for (const eventId of [oldId, newId]) {
    revalidatePath(`/admin/events/${eventId}`);
    revalidatePath(`/admin/events/${eventId}/slots`);
    revalidatePath(`/manage/events/${eventId}`);
    revalidatePath(`/manage/events/${eventId}/edit`);
    revalidatePath(`/manage/events/${eventId}/slots`);
    revalidatePath(`/event/${eventId}`);
    revalidatePath(`/event/${eventId}/slots`);
  }
}

/**
 * 管理者専用のイベントID変更。
 *
 * events.id は多数の外部キーから参照されるため、親だけを更新してはいけない。
 * D1 batch の先頭で defer_foreign_keys を有効にし、親と全参照を同一の
 * all-or-nothing batch で移動する。static_artifacts は旧R2 keyの削除追跡に
 * 必要なので意図的に書き換えず、旧IDと新IDのrebuildを両方enqueueする。
 */
export async function renameEventId(
  formData: FormData,
): Promise<RenameEventIdResult> {
  const guard = await requireAdminWrite("manage_event_update");
  if (!guard.ok) return { ok: false, message: guard.message };

  const oldId = String(formData.get("old_event_id") ?? "").trim();
  const newId = String(formData.get("new_event_id") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();

  if (!oldId || !newId) {
    return { ok: false, message: "変更前・変更後のイベントIDが必要です。" };
  }
  if (!EVENT_ID_PATTERN.test(newId)) {
    return {
      ok: false,
      message: "イベントIDは64文字以内の半角英数字・_・-のみ使用できます。",
    };
  }
  if (oldId === newId) {
    return { ok: true, eventId: oldId, message: "イベントIDは変更されていません。" };
  }
  if (confirm !== oldId) {
    return {
      ok: false,
      message: "確認のため、現在のイベントIDと同じ文字列を入力してください。",
    };
  }

  const { db } = guard;
  const before = (
    await db.select().from(events).where(eq(events.id, oldId)).limit(1)
  )[0];
  if (!before) return { ok: false, message: "イベントが見つかりません。" };

  const duplicate = (
    await db.select({ id: events.id }).from(events).where(eq(events.id, newId)).limit(1)
  )[0];
  if (duplicate) {
    return { ok: false, message: `ID「${newId}」は既に存在します。` };
  }

  const actorUserId = guard.user.id;
  const now = Math.floor(Date.now() / 1000);
  const after = { ...before, id: newId, updated_at: now };

  const [oldQueue, newQueue] = await Promise.all([
    buildEventChangeQueueBatch(db, {
      eventId: oldId,
      reason: "event_id_rename_old_cleanup",
      requestedByUserId: actorUserId,
      priority: "high",
    }),
    buildEventChangeQueueBatch(db, {
      eventId: newId,
      reason: "event_id_rename",
      requestedByUserId: actorUserId,
      priority: "high",
    }),
  ]);

  // FKを持つ正本テーブルに加え、event_idを論理参照として保持する正規化済み
  // テーブルも同じbatchで追従させる。既存audit/static_artifactsは履歴・旧key
  // cleanup用なので変更しない。
  const referenceUpdates = [
    db.run(sql`UPDATE event_group_events SET event_id = ${newId} WHERE event_id = ${oldId}`),
    db.run(sql`UPDATE event_staff SET event_id = ${newId} WHERE event_id = ${oldId}`),
    db.run(sql`UPDATE videos SET primary_event_id = ${newId} WHERE primary_event_id = ${oldId}`),
    db.run(sql`UPDATE slot_reservation_groups SET event_id = ${newId} WHERE event_id = ${oldId}`),
    db.run(sql`UPDATE slots SET event_id = ${newId} WHERE event_id = ${oldId}`),
    db.run(sql`UPDATE event_youtube_playlist_sync SET event_id = ${newId} WHERE event_id = ${oldId}`),
    db.run(sql`UPDATE event_youtube_playlist_items SET event_id = ${newId} WHERE event_id = ${oldId}`),
    db.run(sql`UPDATE video_events SET event_id = ${newId} WHERE event_id = ${oldId}`),
    db.run(sql`UPDATE event_custom_questions SET event_id = ${newId} WHERE event_id = ${oldId}`),
    db.run(sql`UPDATE video_custom_answers SET event_id = ${newId} WHERE event_id = ${oldId}`),
    db.run(sql`UPDATE event_templates SET source_event_id = ${newId} WHERE source_event_id = ${oldId}`),
    db.run(sql`UPDATE notification_outbox SET event_id = ${newId} WHERE event_id = ${oldId}`),
    db.run(sql`
      UPDATE public_visibility_fences
      SET entity_id = ${newId}
      WHERE entity_type = 'event' AND entity_id = ${oldId}
    `),
  ];

  try {
    const mutationStatements = [
      db.run(sql`PRAGMA defer_foreign_keys = on`),
      db
        .update(events)
        .set({ id: newId, updated_at: now })
        .where(and(eq(events.id, oldId), eq(events.updated_at, before.updated_at))),
      ...referenceUpdates,
      ...oldQueue.statements,
      ...newQueue.statements,
    ];
    const expectedMutationChanges = [
      null,
      1,
      ...referenceUpdates.map(() => null),
      ...oldQueue.expectedChanges,
      ...newQueue.expectedChanges,
    ];

    await mutateWithAudit(db, {
      mutationStatements,
      expectedMutationChanges,
      audits: [
        {
          table_name: "events",
          target_id: newId,
          operation: "UPDATE",
          before,
          after,
          actor_user_id: actorUserId,
          context: "event-id-rename",
          reason: `イベントIDを ${oldId} から ${newId} へ変更`,
          retention_class: "long_audit",
          strict: true,
        },
      ],
      staticRebuildWakeSource:
        oldQueue.statements.length + newQueue.statements.length > 0
          ? "admin"
          : undefined,
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `イベントID変更を取り消しました: ${error.message}`
          : "イベントID変更を取り消しました。",
    };
  }

  await Promise.all([
    invalidateEventExportCache(oldId),
    invalidateEventExportCache(newId),
  ]);
  revalidateRenamedEventPaths(oldId, newId);

  return markPendingPublicReflection(
    {
      ok: true,
      eventId: newId,
      message: `イベントIDを「${oldId}」から「${newId}」へ変更しました。`,
    },
    oldQueue.statements.length + newQueue.statements.length > 0,
  );
}
