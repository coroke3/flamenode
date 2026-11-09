import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { videoEvents } from "@/lib/db/schema";
import { MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS } from "@/lib/staticRebuild/hooks";
import { mergeVideoRebuildEventIds } from "@flamenode/domain/video";

// Pure helpers live in @flamenode/domain/video (visibility.ts); re-exported for
// existing importers. loadVideoRebuildEventIds stays here because it reads D1.
export {
  SAME_VIDEO_STATUS_MESSAGE,
  mergeVideoRebuildEventIds,
  monotonicVideoUpdatedAt,
} from "@flamenode/domain/video";

export async function loadVideoRebuildEventIds(
  db: DB,
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
