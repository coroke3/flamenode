import "server-only";
import { loadPublicJson } from "./loader";
import {
  normalizeStaticVideoDetail,
  type StaticVideoDetail,
  type StaticVideoDetailPayload,
} from "./staticVideoDetailCore";

export async function loadStaticVideoDetail(
  videoId: string,
): Promise<{
  detail: StaticVideoDetail | null;
  strategy: Awaited<ReturnType<typeof loadPublicJson>>["strategy"];
  enqueued: boolean;
}> {
  const result = await loadPublicJson<StaticVideoDetailPayload>({
    r2Key: `videos/${videoId}.json`,
    targetType: "video",
    targetId: videoId,
    reason: "public_video_detail_miss",
  });
  return {
    detail: result.data ? normalizeStaticVideoDetail(result.data) : null,
    strategy: result.strategy,
    enqueued: result.enqueued,
  };
}

export type { StaticVideoDetail } from "./staticVideoDetailCore";
