import { eq } from "drizzle-orm";
import { videoEvents } from "@flamenode/db/schema";
import { mergeVideoRebuildEventIds } from "@flamenode/domain/video";
import type { ServerCoreDb } from "../db.ts";
import { MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS } from "../staticRebuild/hooks.ts";

/**
 * Resolve rebuild targets from canonical D1 for SA-082..085 and video visibility writes.
 * Preserve CURRENT ordering (primary first, then linked), the bounded read,
 * and the fail-closed limit before enqueuing any rebuild.
 */
export async function loadVideoRebuildEventIds(
  db: ServerCoreDb,
  videoId: string,
  primaryEventId: string | null | undefined,
): Promise<{ ok: true; eventIds: string[] } | { ok: false; message: string }> {
  const eventRows = await db
    .select({ event_id: videoEvents.event_id })
    .from(videoEvents)
    .where(eq(videoEvents.video_id, videoId))
    .limit(MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS + 1);
  const eventIds = mergeVideoRebuildEventIds(
    primaryEventId,
    eventRows.map((row) => row.event_id),
  );
  if (eventIds.length > MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS) {
    return {
      ok: false,
      message: "関連イベント数が処理上限を超えています。",
    };
  }
  return { ok: true, eventIds };
}
