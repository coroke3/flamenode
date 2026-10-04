import { RANDOM_VIDEO_POOL_OBJECT_KEY } from "../../src/lib/publicData/randomVideoPoolCore.ts";
import { YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY } from "../../src/lib/publicData/staticYoutubeRelatedBlocklistCore.ts";
import { enqueueStaticRebuildTargets, globalTargets } from "./staticRebuildEnqueue.ts";

type EnqueueEnv = { DB: D1Database; R2: R2Bucket };

export const YOUTUBE_RELATED_PROJECTION_TARGETS = [
  "youtube_related_blocklist",
  "random_video_pool",
  "top_nostalgic",
] as const;

/** 1 chunk = JSON1 upsert 1 statement。video source targetsも250 IDs/chunkでbounded化する。 */
export const YOUTUBE_RELATED_REBUILD_MAX_D1_STATEMENTS = 1;
export const YOUTUBE_RELATED_SOURCE_VIDEO_BATCH_SIZE = 250;
export const YOUTUBE_RELATED_SOURCE_VIDEO_MAX_IDS = 2000;

export async function enqueueYoutubeRelatedProjectionRebuilds(
  env: EnqueueEnv,
  reason: string,
  priority: "high" | "low",
  signal?: AbortSignal,
  sourceVideoIds: readonly string[] = [],
): Promise<number> {
  signal?.throwIfAborted();

  const videoIds = Array.from(
    new Set(sourceVideoIds.map((id) => id.trim()).filter(Boolean)),
  );
  if (videoIds.length > YOUTUBE_RELATED_SOURCE_VIDEO_MAX_IDS) {
    throw new Error("youtube_related_video_source_target_limit_exceeded");
  }
  // eligibility依存の固定global targetsと、source用video targetsだけを予約する。
  const targets = [
    ...globalTargets(YOUTUBE_RELATED_PROJECTION_TARGETS),
    ...videoIds.map((targetId) => ({ targetType: "video", targetId })),
  ];
  let changes = 0;
  for (
    let offset = 0;
    offset < targets.length;
    offset += YOUTUBE_RELATED_SOURCE_VIDEO_BATCH_SIZE
  ) {
    changes += await enqueueStaticRebuildTargets(
      env,
      targets.slice(offset, offset + YOUTUBE_RELATED_SOURCE_VIDEO_BATCH_SIZE),
      reason,
      priority,
      signal,
    );
  }
  return changes;
}

/** R2上の共有JSONが欠けていれば blocklist と random pool をまとめて enqueue する。 */
export async function ensureYoutubeRelatedSharedInputsOnR2(
  env: EnqueueEnv,
  options: {
    reason: string;
    priority: "high" | "low";
    signal?: AbortSignal;
  },
): Promise<number> {
  options.signal?.throwIfAborted();
  const [blocklistHead, poolHead] = await Promise.all([
    env.R2.head(YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY),
    env.R2.head(RANDOM_VIDEO_POOL_OBJECT_KEY),
  ]);
  if (blocklistHead && poolHead) {
    return 0;
  }
  return enqueueYoutubeRelatedProjectionRebuilds(
    env,
    options.reason,
    options.priority,
    options.signal,
  );
}
