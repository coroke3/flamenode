import "server-only";

import { getEnv } from "@/lib/cloudflare";
import {
  loadRandomVideoPool,
  loadYoutubeRelatedBlocklist,
  type StaticJsonLoadStatus,
} from "@/lib/publicData/staticSharedInputsLoader";
import { RANDOM_VIDEO_POOL_OBJECT_KEY } from "@/lib/publicData/randomVideoPoolCore";
import { YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY } from "@/lib/publicData/staticYoutubeRelatedBlocklistCore";
import type { StaticRebuildTargetType } from "@/lib/staticRebuild/types";

export type StaticSharedInputObjectState =
  | "present"
  | "missing"
  | "unavailable";

export type StaticSharedInputDiagnostic = {
  kind: "youtube_related_blocklist" | "random_video_pool";
  label: string;
  objectKey: string;
  objectState: StaticSharedInputObjectState;
  loadStatus: StaticJsonLoadStatus;
  generatedAt: number | null;
  itemCount: number | null;
  itemUnit: string;
  targetType: StaticRebuildTargetType;
};

async function inspectR2Object(
  key: string,
): Promise<StaticSharedInputObjectState> {
  try {
    const bucket = getEnv().BUCKET;
    const object = await bucket.head(key);
    return object ? "present" : "missing";
  } catch {
    return "unavailable";
  }
}

export async function loadStaticSharedInputDiagnostics(): Promise<
  StaticSharedInputDiagnostic[]
> {
  const [blocklistObjectState, randomPoolObjectState, blocklist, randomPool] =
    await Promise.all([
      inspectR2Object(YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY),
      inspectR2Object(RANDOM_VIDEO_POOL_OBJECT_KEY),
      loadYoutubeRelatedBlocklist(),
      loadRandomVideoPool(),
    ]);

  return [
    {
      kind: "youtube_related_blocklist",
      label: "YouTube関連動画 blocklist",
      objectKey: YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY,
      objectState: blocklistObjectState,
      loadStatus: blocklist.status,
      generatedAt:
        blocklist.status === "unavailable"
          ? null
          : blocklist.value.generatedAt,
      itemCount:
        blocklist.status === "unavailable"
          ? null
          : blocklist.value.blockedIds.size,
      itemUnit: "件",
      targetType: "youtube_related_blocklist",
    },
    {
      kind: "random_video_pool",
      label: "関連動画ランダムプール",
      objectKey: RANDOM_VIDEO_POOL_OBJECT_KEY,
      objectState: randomPoolObjectState,
      loadStatus: randomPool.status,
      generatedAt:
        randomPool.status === "unavailable"
          ? null
          : randomPool.value.generatedAt,
      itemCount:
        randomPool.status === "unavailable"
          ? null
          : randomPool.value.items.length,
      itemUnit: "件",
      targetType: "random_video_pool",
    },
  ];
}
