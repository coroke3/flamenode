"use server";

import { and, eq, sql } from "drizzle-orm";
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { writeGuard } from "@/lib/auth/writeGuard";
import {
  eventYoutubePlaylistItems,
  eventYoutubePlaylistSync,
} from "@/lib/db/schema";
import { resolveEventEditPermissions } from "@/lib/event/eventEditPermissions";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";
import { sendYoutubePlaylistSyncWakeBestEffort } from "@/lib/queues/youtubePlaylistSyncWake";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import {
  extractYoutubePlaylistId,
  parsePlaylistSyncInterval,
  parsePlaylistSyncMode,
} from "@/lib/youtube/playlist";

function cleanEventId(raw: FormDataEntryValue | null): string {
  return String(raw ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 64);
}

function settingsHref(eventId: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  return `/manage/events/${encodeURIComponent(eventId)}/youtube-playlist?${query}`;
}

function revalidateEventYoutubePlaylistPath(eventId: string): void {
  revalidatePath(`/manage/events/${eventId}/youtube-playlist`);
}

async function revalidateEventYoutubePlaylistPathBestEffort(
  eventId: string,
): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "event_youtube_playlist", traceId: createTraceId() },
    [
      {
        name: "revalidate_event_youtube_playlist_path",
        run: async () => {
          revalidateEventYoutubePlaylistPath(eventId);
        },
      },
    ],
  );
}

export async function saveEventYoutubePlaylistSettings(
  formData: FormData,
): Promise<void> {
  const eventId = cleanEventId(formData.get("event_id"));
  if (!eventId) redirect("/manage");

  const guard = await writeGuard({ feature: "manage_event_update" });
  if (!guard.ok) {
    redirect(settingsHref(eventId, { error: guard.message }));
  }

  const permissions = await resolveEventEditPermissions(
    guard.db,
    { id: guard.user.id, role: guard.user.role ?? null },
    eventId,
  );
  if (!permissions.publish) {
    redirect(
      settingsHref(eventId, {
        error: "YouTube再生リスト同期を変更する権限がありません。",
      }),
    );
  }

  const mode = parsePlaylistSyncMode(String(formData.get("sync_mode") ?? "off"));
  const rawPlaylist = String(formData.get("playlist_id") ?? "").trim();
  const playlistId = extractYoutubePlaylistId(rawPlaylist);
  const interval = parsePlaylistSyncInterval(
    String(formData.get("sync_interval_minutes") ?? "720"),
  );

  if (rawPlaylist && !playlistId) {
    redirect(
      settingsHref(eventId, {
        error: "YouTube再生リストのURLまたはIDが正しくありません。",
      }),
    );
  }
  if (mode !== "off" && !playlistId) {
    redirect(
      settingsHref(eventId, {
        error: "同期を有効にするには再生リストURLまたはIDが必要です。",
      }),
    );
  }

  const before = (
    await guard.db
      .select()
      .from(eventYoutubePlaylistSync)
      .where(eq(eventYoutubePlaylistSync.event_id, eventId))
      .limit(1)
  )[0];
  const now = Math.floor(Date.now() / 1000);
  if (
    before?.run_lease_token &&
    Number(before.run_lease_expires_at ?? 0) > now
  ) {
    redirect(
      settingsHref(eventId, {
        error: "再生リスト同期が実行中です。完了後にもう一度お試しください。",
      }),
    );
  }
  const enabled = mode === "off" ? 0 : 1;
  const playlistChanged = (before?.playlist_id ?? null) !== playlistId;

  const after = {
    event_id: eventId,
    playlist_id: playlistId,
    enabled,
    sync_mode: mode,
    sync_interval_minutes: interval,
    sync_status: enabled ? ("idle" as const) : ("disabled" as const),
    next_sync_at: enabled ? now : null,
    last_synced_at: playlistChanged ? null : (before?.last_synced_at ?? null),
    last_full_scan_at: null,
    scan_started_at: null,
    scan_page_token: null,
    last_error: null,
    pending_trigger: enabled ? ("settings_change" as const) : null,
    // Settings changes fence any in-flight sync before the post-commit wake.
    // The old worker keeps running, but every D1/external mutation is guarded
    // by this lease identity and therefore becomes a no-op after the change.
    run_lease_token: null,
    run_lease_expires_at: null,
    created_at: before?.created_at ?? now,
    updated_at: now,
  } satisfies typeof eventYoutubePlaylistSync.$inferInsert;

  const itemCount = playlistChanged
    ? Number(
        (
          await guard.db
            .select({ count: sql<number>`COUNT(*)` })
            .from(eventYoutubePlaylistItems)
            .where(eq(eventYoutubePlaylistItems.event_id, eventId))
        )[0]?.count ?? 0,
      )
    : 0;

  const upsert = guard.db
    .insert(eventYoutubePlaylistSync)
    .values(after)
    .onConflictDoUpdate({
      target: eventYoutubePlaylistSync.event_id,
      // The preflight check above is only a user-facing fast path.  Keep the
      // lease predicate on the actual UPSERT so a worker claiming the row
      // between the read and this batch cannot be overwritten by settings.
      where: sql`
        run_lease_token IS NULL
        OR run_lease_expires_at IS NULL
        OR run_lease_expires_at <= ${now}
      `,
      set: {
        playlist_id: after.playlist_id,
        enabled: after.enabled,
        sync_mode: after.sync_mode,
        sync_interval_minutes: after.sync_interval_minutes,
        sync_status: after.sync_status,
        next_sync_at: after.next_sync_at,
        last_synced_at: after.last_synced_at,
        last_full_scan_at: after.last_full_scan_at,
        scan_started_at: after.scan_started_at,
        scan_page_token: after.scan_page_token,
        last_error: after.last_error,
        pending_trigger: after.pending_trigger,
        run_lease_token: after.run_lease_token,
        run_lease_expires_at: after.run_lease_expires_at,
        updated_at: after.updated_at,
      },
    });

  const resetItems = guard.db
    .delete(eventYoutubePlaylistItems)
    .where(eq(eventYoutubePlaylistItems.event_id, eventId));
  const mutationStatements =
    playlistChanged && itemCount > 0 ? [upsert, resetItems] : [upsert];
  const expectedMutationChanges =
    playlistChanged && itemCount > 0 ? [1, itemCount] : [1];

  try {
    // The projection invalidation is part of the same D1 batch as the
    // settings/audit mutation. Only the queue wake is post-commit; if queue
    // planning or its UPSERT fails, the settings change must roll back rather
    // than leaving the public CTA indefinitely stale.
    const projectionQueue = await buildStaticRebuildQueueBatch(guard.db, [
      {
        targetType: "event_base",
        targetId: eventId,
        reason: "event_youtube_playlist_settings",
        priority: "high",
        requestedByUserId: guard.user.id,
      },
    ]);
    await mutateWithAudit(guard.db, {
      mutationStatements: [...mutationStatements, ...projectionQueue.statements],
      expectedMutationChanges: [
        ...expectedMutationChanges,
        ...projectionQueue.expectedChanges,
      ],
      audits: [
        {
          table_name: "event_youtube_playlist_sync",
          target_id: eventId,
          operation: before ? "UPDATE" : "CREATE",
          before: before ?? null,
          after,
          actor_user_id: guard.user.id,
          reason: "event-youtube-playlist-settings",
          context: `event:${eventId}`,
          retention_class: "normal",
          strict: true,
        },
      ],
      staticRebuildWakeSource:
        projectionQueue.statements.length > 0 ? "web" : undefined,
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[event-youtube-playlist] settings update failed", error);
    redirect(
      settingsHref(eventId, {
        error:
          "設定を保存できませんでした。同じ再生リストが別イベントに設定されていないか確認してください。",
      }),
    );
  }

  // D1のnext_sync_atを正本として先にcommitし、Queueはドアベルだけにする。
  // Queue無効/送信失敗なら従来どおり :52 Cron が回収する。
  if (enabled === 1) {
    await sendYoutubePlaylistSyncWakeBestEffort("manage");
  }
  await revalidateEventYoutubePlaylistPathBestEffort(eventId);
  redirect(settingsHref(eventId, { saved: "1" }));
}

export async function queueEventYoutubePlaylistSync(formData: FormData): Promise<void> {
  const eventId = cleanEventId(formData.get("event_id"));
  if (!eventId) redirect("/manage");

  const guard = await writeGuard({ feature: "manage_event_update" });
  if (!guard.ok) redirect(settingsHref(eventId, { error: guard.message }));

  const permissions = await resolveEventEditPermissions(
    guard.db,
    { id: guard.user.id, role: guard.user.role ?? null },
    eventId,
  );
  if (!permissions.publish) {
    redirect(
      settingsHref(eventId, {
        error: "YouTube再生リスト同期を実行予約する権限がありません。",
      }),
    );
  }

  const before = (
    await guard.db
      .select()
      .from(eventYoutubePlaylistSync)
      .where(eq(eventYoutubePlaylistSync.event_id, eventId))
      .limit(1)
  )[0];
  if (!before || before.enabled !== 1 || !before.playlist_id) {
    redirect(settingsHref(eventId, { error: "同期が有効になっていません。" }));
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    before.run_lease_token &&
    Number(before.run_lease_expires_at ?? 0) > now
  ) {
    redirect(
      settingsHref(eventId, {
        error: "再生リスト同期が実行中です。完了後にもう一度お試しください。",
      }),
    );
  }
  const after = {
    ...before,
    sync_status: "idle" as const,
    next_sync_at: now,
    // 手動同期はremote membershipと投稿枠順の両方を再検証する。
    last_full_scan_at: null,
    scan_started_at: null,
    scan_page_token: null,
    last_error: null,
    pending_trigger: "manual" as const,
    run_lease_token: null,
    run_lease_expires_at: null,
    updated_at: now,
  };
  try {
    await mutateWithAudit(guard.db, {
      mutationStatements: [
        guard.db
          .update(eventYoutubePlaylistSync)
          .set({
            sync_status: after.sync_status,
            next_sync_at: after.next_sync_at,
            last_full_scan_at: after.last_full_scan_at,
            scan_started_at: after.scan_started_at,
            scan_page_token: after.scan_page_token,
            last_error: after.last_error,
            pending_trigger: "manual",
            run_lease_token: after.run_lease_token,
            run_lease_expires_at: after.run_lease_expires_at,
            updated_at: after.updated_at,
          })
          .where(
            and(
              eq(eventYoutubePlaylistSync.event_id, eventId),
              sql`
                (
                  run_lease_token IS NULL
                  OR run_lease_expires_at IS NULL
                  OR run_lease_expires_at <= ${now}
                )
              `,
            ),
          ),
      ],
      expectedMutationChanges: 1,
      audits: [
        {
          table_name: "event_youtube_playlist_sync",
          target_id: eventId,
          operation: "UPDATE",
          before,
          after,
          actor_user_id: guard.user.id,
          reason: "event-youtube-playlist-queue",
          context: `event:${eventId}`,
          retention_class: "normal",
          strict: true,
        },
      ],
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[event-youtube-playlist] queue sync failed", error);
    redirect(
      settingsHref(eventId, {
        error: "同期予約に失敗しました。再読み込みしてお試しください。",
      }),
    );
  }

  await sendYoutubePlaylistSyncWakeBestEffort("manage");
  await revalidateEventYoutubePlaylistPathBestEffort(eventId);
  redirect(settingsHref(eventId, { queued: "1" }));
}
