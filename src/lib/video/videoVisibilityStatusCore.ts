import type { DB } from "@/lib/db/client";
import { loadVideoRebuildEventIds as loadVideoRebuildEventIdsCore } from "@flamenode/server-core/video/rebuildEventIds";

// Pure helpers live in @flamenode/domain/video (visibility.ts); re-exported for
// existing importers. The bounded D1 lookup is implemented once in server-core.
export {
  SAME_VIDEO_STATUS_MESSAGE,
  mergeVideoRebuildEventIds,
  monotonicVideoUpdatedAt,
} from "@flamenode/domain/video";

export function loadVideoRebuildEventIds(
  db: DB,
  videoId: string,
  primaryEventId: string | null | undefined,
): ReturnType<typeof loadVideoRebuildEventIdsCore> {
  return loadVideoRebuildEventIdsCore(db, videoId, primaryEventId);
}
