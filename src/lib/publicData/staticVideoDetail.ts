import "server-only";

import { createPublicJsonLoader } from "./createPublicJsonLoader";
import {
  normalizeStaticVideoDetail,
  type StaticVideoDetail,
  type StaticVideoDetailPayload,
} from "./staticVideoDetailCore";

export const loadStaticVideoDetail =
  createPublicJsonLoader<
    StaticVideoDetailPayload,
    StaticVideoDetail
  >({
    r2Key: (videoId) => `videos/${videoId}.json`,
    targetType: "video",
    reason: "public_video_detail_miss",
    normalize: normalizeStaticVideoDetail,
  });

export type { StaticVideoDetail } from "./staticVideoDetailCore";
