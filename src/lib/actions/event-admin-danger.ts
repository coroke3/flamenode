"use server";

import { and, eq, exists, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { mutateWithAudit } from "@/lib/audit/mutate";
import {
  events,
  publicVisibilityFences,
  videoEvents,
  videos,
} from "@/lib/db/schema";
import { getPublicVisibilityFence } from "@/lib/publicData/publicVisibilityFenceStore";
import { invalidateEventExportCache } from "@/lib/api/eventExportCache";
import {
  compensateEventVisibilityFenceRenameOnD1Failure,
  compensateEventVisibilityRenameTombstoneOnD1Failure,
  preCommitEventVisibilityFenceRename,
  preCommitEventVisibilityRenameTombstone,
  type EventVisibilityFenceRenamePrecommit,
  type EventVisibilityRenameTombstonePrecommit,
} from "@/lib/event/eventVisibilityTransition";
import {
  compensateEventIdReuseOnD1Failure,
  preCommitEventIdReuse,
  type EventIdReusePrecommit,
  type EventIdReuseTombstone,
} from "@/lib/event/eventIdReuse";
import {
  buildEventChangeQueueBatch,
} from "@/lib/staticRebuild/hooks";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { deletePublicJsonCaches } from "@/lib/publicData/publicCache";
import {
  eventBaseObjectKey,
  eventComposedObjectKey,
  eventSlotsObjectKey,
  eventReleaseObjectKey,
} from "@/lib/publicData/staticEventDetailCore";
import { EVENT_ID_PATTERN } from "@/lib/event/eventForm";
import {
  markPendingPublicReflection,
  type PendingPublicReflection,
} from "@/lib/staticRebuild/publicReflectionNotice";
import { generateId } from "@/lib/utils/id";

export interface RenameEventIdResult extends PendingPublicReflection {
  ok: boolean;
  message?: string;
  eventId?: string;
}

// mutateWithAudit reserves ten D1 calls for the caller.  The rename already
// includes the reference updates and the old/new event queue batches, so keep
// the linked-video fan-out bounded by the remaining atomic batch budget.  A
// rename that cannot enqueue every affected video must fail closed instead of
// leaving a permanently stale event id in a public video artifact.
const MAX_RENAME_VIDEO_REBUILD_TARGETS = 70;
const RENAME_VIDEO_REBUILD_CHUNK_SIZE = 10;

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

  // Renamed-away IDs keep a temporary old-URL tombstone. Reuse is evaluated
  // after the cleanup queue is planned and only succeeds once all old public
  // artifacts have been removed.
  const targetTombstone = (
    await db
      .select()
      .from(publicVisibilityFences)
      .where(
        and(
          eq(publicVisibilityFences.entity_type, "event"),
          eq(publicVisibilityFences.entity_id, newId),
          eq(publicVisibilityFences.state, "blocked"),
          eq(publicVisibilityFences.reason, "event_id_rename_old_cleanup"),
        )!,
      )
      .limit(1)
  )[0];
  // Do not move a release-pending fence without its R2 manifest entry. The
  // worker would otherwise see the new D1 id but the old manifest id and
  // could clear the fence before the renamed public projection is safe.
  const pendingFence = (
    await db
      .select({
        state: publicVisibilityFences.state,
        reason: publicVisibilityFences.reason,
      })
      .from(publicVisibilityFences)
      .where(
        and(
          eq(publicVisibilityFences.entity_type, "event"),
          eq(publicVisibilityFences.entity_id, oldId),
        )!,
      )
      .limit(1)
  )[0];
  if (pendingFence?.state === "release_pending") {
    return {
      ok: false,
      message:
        "イベントの公開反映中はIDを変更できません。公開反映が完了してから再試行してください。",
    };
  }
  if (pendingFence?.reason === "event_id_rename_old_cleanup") {
    return {
      ok: false,
      message: "event_id_reserved_by_old_tombstone",
    };
  }

  const actorUserId = guard.user.id;
  const now = Math.max(
    Math.floor(Date.now() / 1000),
    before.updated_at + 1,
  );
  const after = { ...before, id: newId, updated_at: now };

  // A video detail artifact embeds both `event_ids` and `public_events`.
  // Renaming only the event artifact therefore leaves every linked video
  // carrying the old event id until its own rebuild runs.  Read the complete
  // affected set before changing the relations, then enqueue one video target
  // for each row in the same atomic mutation as the rename.
  const linkedVideoRows = await db
    .select({
      id: videos.id,
      youtube_video_id: videos.youtube_video_id,
    })
    .from(videos)
    .where(
      or(
        eq(videos.primary_event_id, oldId),
        exists(
          db
            .select({ one: sql`1` })
            .from(videoEvents)
            .where(
              and(
                eq(videoEvents.video_id, videos.id),
                eq(videoEvents.event_id, oldId),
              ),
            ),
        ),
      ),
    )
    .limit(MAX_RENAME_VIDEO_REBUILD_TARGETS + 1);
  if (linkedVideoRows.length > MAX_RENAME_VIDEO_REBUILD_TARGETS) {
    return {
      ok: false,
      message:
        "このイベントに紐づく動画が多いため、公開JSONを安全に更新できません。動画数を減らしてからIDを変更してください。",
    };
  }

  const [oldQueue, newQueue] = await Promise.all([
    buildEventChangeQueueBatch(db, {
      eventId: oldId,
      reason: "event_id_rename_old_cleanup",
      requestedByUserId: actorUserId,
      priority: "high",
      includeComposedCleanup: true,
    }),
    buildEventChangeQueueBatch(db, {
      eventId: newId,
      reason: "event_id_rename",
      requestedByUserId: actorUserId,
      priority: "high",
    }),
  ]);
  const videoQueueBatches = [];
  for (
    let offset = 0;
    offset < linkedVideoRows.length;
    offset += RENAME_VIDEO_REBUILD_CHUNK_SIZE
  ) {
    videoQueueBatches.push(
      await buildStaticRebuildQueueBatch(
        db,
        linkedVideoRows
          .slice(offset, offset + RENAME_VIDEO_REBUILD_CHUNK_SIZE)
          .map((video) => ({
            targetType: "video" as const,
            targetId: video.id,
            reason: "event_id_rename",
            priority: "high" as const,
            requestedByUserId: actorUserId,
          })),
      ),
    );
  }
  const videoQueueStatements = videoQueueBatches.flatMap(
    (batch) => batch.statements,
  );
  const videoQueueExpectedChanges = videoQueueBatches.flatMap(
    (batch) => batch.expectedChanges,
  );

  let targetReusePrecommit: EventIdReusePrecommit | null = null;
  if (targetTombstone) {
    const reuse = await preCommitEventIdReuse({
      db,
      eventId: newId,
      tombstone: targetTombstone satisfies EventIdReuseTombstone,
      now: Math.floor(Date.now() / 1000),
    });
    if (!reuse.ok) {
      return {
        ok: false,
        message:
          "指定したIDは旧URL保護のため再利用できません。公開データの削除完了後に再試行してください。",
      };
    }
    targetReusePrecommit = reuse.precommit;
  }

  // Keep every statement-builder await before the R2 pre-commit. If queue
  // planning fails, no manifest mutation has happened and the D1 row remains
  // untouched, so there is nothing to compensate.
  const oldFence = await getPublicVisibilityFence(db, "event", oldId);
  const renameTombstoneToken = generateId("vf");
  let manifestRename: EventVisibilityFenceRenamePrecommit | null = null;
  let renameTombstone: EventVisibilityRenameTombstonePrecommit | null = null;
  try {
    // Keep the existing fence move, then retain an
    // old-id tombstone so stale `events/{oldId}.json` cannot be served after
    // the D1 primary key is renamed.
    if (
      oldFence &&
      (oldFence.state === "blocked" || oldFence.state === "release_pending")
    ) {
      manifestRename = await preCommitEventVisibilityFenceRename({
        oldEventId: oldId,
        newEventId: newId,
        fenceToken: oldFence.fence_token,
        reason: oldFence.reason,
      });
    }
    renameTombstone = await preCommitEventVisibilityRenameTombstone({
      eventId: oldId,
      fenceToken: renameTombstoneToken,
      reason: "event_id_rename_old_cleanup",
    });
  } catch (error) {
    if (renameTombstone) {
      try {
        await compensateEventVisibilityRenameTombstoneOnD1Failure(
          renameTombstone,
        );
      } catch (compensationError) {
        console.warn(
          "[event-admin-danger] visibility rename tombstone compensation failed",
          compensationError,
        );
      }
    }
    if (manifestRename) {
      try {
        await compensateEventVisibilityFenceRenameOnD1Failure(manifestRename);
      } catch (compensationError) {
        console.warn(
          "[event-admin-danger] visibility fence rename compensation failed",
          compensationError,
        );
      }
    }
    if (targetReusePrecommit) {
      await compensateEventIdReuseOnD1Failure(targetReusePrecommit).catch(
        (compensationError) =>
          console.warn(
            "[event-admin-danger] event ID reuse compensation failed",
            compensationError,
          ),
      );
    }
    console.warn(
      "[event-admin-danger] visibility fence rename precommit failed",
      error,
    );
    return {
      ok: false,
      message:
        "イベントID変更前の公開状態保護に失敗しました。時間をおいて再試行してください。",
    };
  }

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
    db.run(sql`
      UPDATE notification_outbox
      SET event_id = ${newId},
          payload_json = CASE
            WHEN json_valid(payload_json) = 1 THEN replace(
              json_set(payload_json, '$.event_id', ${newId}),
              ${`/event/${oldId}`},
              ${`/event/${newId}`}
            )
            ELSE replace(payload_json, ${`/event/${oldId}`}, ${`/event/${newId}`})
          END
      WHERE event_id = ${oldId}
    `),
    db.run(sql`
      UPDATE public_visibility_fences
      SET entity_id = ${newId}
      WHERE entity_type = 'event' AND entity_id = ${oldId}
    `),
  ];
  const renameTombstoneStatement = db
    .insert(publicVisibilityFences)
    .values({
      entity_type: "event",
      entity_id: oldId,
      fence_token: renameTombstoneToken,
      state: "blocked",
      reason: "event_id_rename_old_cleanup",
      requirements_json: null,
      blocked_at: now,
      release_requested_at: null,
      requested_by_auth_user_id: actorUserId,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: [publicVisibilityFences.entity_type, publicVisibilityFences.entity_id],
      set: {
        fence_token: renameTombstoneToken,
        state: "blocked",
        reason: "event_id_rename_old_cleanup",
        requirements_json: null,
        blocked_at: now,
        release_requested_at: null,
        requested_by_auth_user_id: actorUserId,
        updated_at: now,
      },
    });
  const targetFenceDelete = targetReusePrecommit
    ? db
        .delete(publicVisibilityFences)
        .where(
          and(
            eq(publicVisibilityFences.entity_type, "event"),
            eq(publicVisibilityFences.entity_id, newId),
            eq(publicVisibilityFences.fence_token, targetReusePrecommit.fenceToken),
            eq(publicVisibilityFences.state, "blocked"),
            eq(
              publicVisibilityFences.reason,
              "event_id_rename_old_cleanup",
            ),
          )!,
        )
    : null;

  try {
    const mutationStatements = [
      db.run(sql`PRAGMA defer_foreign_keys = on`),
      ...(targetFenceDelete ? [targetFenceDelete] : []),
      db
        .update(events)
        .set({ id: newId, updated_at: now })
        .where(and(eq(events.id, oldId), eq(events.updated_at, before.updated_at))),
      ...referenceUpdates,
      renameTombstoneStatement,
      ...oldQueue.statements,
      ...newQueue.statements,
      ...videoQueueStatements,
    ];
    const expectedMutationChanges = [
      null,
      ...(targetFenceDelete ? [1] : []),
      1,
      ...referenceUpdates.map(() => null),
      1,
      ...oldQueue.expectedChanges,
      ...newQueue.expectedChanges,
      ...videoQueueExpectedChanges,
    ];

    await mutateWithAudit(db, {
      mutationStatements,
      expectedMutationChanges,
      audits: [
        ...(targetReusePrecommit
          ? [
              {
                table_name: "public_visibility_fences",
                target_id: newId,
                operation: "DELETE" as const,
                before: targetTombstone,
                after: null,
                actor_user_id: actorUserId,
                context: "event-id-rename:release-target-tombstone",
                reason: "event_id_rename_old_cleanup_complete",
                retention_class: "long_audit" as const,
                strict: true,
              },
            ]
          : []),
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
        oldQueue.statements.length +
          newQueue.statements.length +
          videoQueueStatements.length >
        0
          ? "admin"
          : undefined,
    });
  } catch (error) {
    if (renameTombstone) {
      try {
        await compensateEventVisibilityRenameTombstoneOnD1Failure(
          renameTombstone,
        );
      } catch (compensationError) {
        console.warn(
          "[event-admin-danger] visibility rename tombstone compensation failed",
          compensationError,
        );
      }
    }
    if (manifestRename) {
      try {
        await compensateEventVisibilityFenceRenameOnD1Failure(manifestRename);
      } catch (compensationError) {
        console.warn(
          "[event-admin-danger] visibility fence rename compensation failed",
          compensationError,
        );
      }
    }
    if (targetReusePrecommit) {
      await compensateEventIdReuseOnD1Failure(targetReusePrecommit).catch(
        (compensationError) =>
          console.warn(
            "[event-admin-danger] event ID reuse compensation failed",
            compensationError,
          ),
      );
    }
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
    deletePublicJsonCaches([
      eventComposedObjectKey(oldId),
      eventBaseObjectKey(oldId),
      eventSlotsObjectKey(oldId),
      eventReleaseObjectKey(oldId),
      eventComposedObjectKey(newId),
      eventBaseObjectKey(newId),
      eventSlotsObjectKey(newId),
      eventReleaseObjectKey(newId),
      // Event IDs are embedded in the global event/top projections too.  The
      // queue rebuild will refresh R2, but the Cache API can otherwise serve
      // the old ID until its normal TTL expires.
      "events/index.json",
      "list/recent.json",
      "list/popular.json",
      "top/sections/events.v1.json",
      "top.json",
      ...linkedVideoRows.flatMap((video) => {
        const keys = new Set<string>([`videos/${video.id}.json`]);
        if (video.youtube_video_id) {
          keys.add(`videos/${video.youtube_video_id}.json`);
        }
        return [...keys];
      }),
    ]),
  ]);
  revalidateRenamedEventPaths(oldId, newId);

  return markPendingPublicReflection(
    {
      ok: true,
      eventId: newId,
      message: `イベントIDを「${oldId}」から「${newId}」へ変更しました。`,
    },
    oldQueue.statements.length +
      newQueue.statements.length +
      videoQueueStatements.length >
      0,
  );
}
