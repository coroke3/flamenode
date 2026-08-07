import "server-only";

import { getEnv } from "@/lib/cloudflare";
import {
  loadPickupCreatorsArtifact,
  loadRandomVideoPool,
  loadStaticTopSlotStats,
  loadYoutubeRelatedBlocklist,
  type StaticJsonLoadStatus,
} from "@/lib/publicData/staticSharedInputsLoader";
import { RANDOM_VIDEO_POOL_OBJECT_KEY } from "@/lib/publicData/randomVideoPoolCore";
import { PICKUP_CREATORS_OBJECT_KEY } from "@/lib/publicData/publicCreatorProjection";
import { TOP_SLOT_STATS_OBJECT_KEY } from "@/lib/publicData/staticTopSlotStatsCore";
import { YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY } from "@/lib/publicData/staticYoutubeRelatedBlocklistCore";
import type { StaticRebuildTargetType } from "@/lib/staticRebuild/types";

export type StaticSharedInputObjectState =
  | "present"
  | "missing"
  | "unavailable";

export type StaticSharedInputDiagnosticKind =
  | "youtube_related_blocklist"
  | "random_video_pool"
  | "pickup_creators"
  | "top_slot_stats";

export type StaticSharedInputDiagnostic = {
  kind: StaticSharedInputDiagnosticKind;
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
  const [
    blocklistObjectState,
    randomPoolObjectState,
    pickupCreatorsObjectState,
    topSlotStatsObjectState,
    blocklist,
    randomPool,
    pickupCreators,
    topSlotStats,
  ] = await Promise.all([
    inspectR2Object(YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY),
    inspectR2Object(RANDOM_VIDEO_POOL_OBJECT_KEY),
    inspectR2Object(PICKUP_CREATORS_OBJECT_KEY),
    inspectR2Object(TOP_SLOT_STATS_OBJECT_KEY),
    loadYoutubeRelatedBlocklist(),
    loadRandomVideoPool(),
    loadPickupCreatorsArtifact(),
    loadStaticTopSlotStats(),
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
    {
      kind: "pickup_creators",
      label: "Creator棚 pickup artifact",
      objectKey: PICKUP_CREATORS_OBJECT_KEY,
      objectState: pickupCreatorsObjectState,
      loadStatus: pickupCreators.status,
      generatedAt:
        pickupCreators.status === "unavailable"
          ? null
          : pickupCreators.value.generated_at,
      itemCount:
        pickupCreators.status === "unavailable"
          ? null
          : pickupCreators.value.creators.length,
      itemUnit: "件",
      targetType: "users_index",
    },
    {
      kind: "top_slot_stats",
      label: "トップ hero slot_stats artifact",
      objectKey: TOP_SLOT_STATS_OBJECT_KEY,
      objectState: topSlotStatsObjectState,
      loadStatus: topSlotStats.status,
      generatedAt:
        topSlotStats.status === "unavailable"
          ? null
          : topSlotStats.value.generatedAt,
      itemCount:
        topSlotStats.status === "unavailable"
          ? null
          : topSlotStats.value.items.size,
      itemUnit: "件",
      targetType: "top_slot_stats",
    },
  ];
}
