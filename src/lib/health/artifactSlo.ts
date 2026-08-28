/**
 * Global public artifact SLO probes (docs/operations/static-delivery.md §主な公開 artifact).
 * Deep health and check:artifact-slo share this contract.
 */

import { cancelR2BodyBestEffort } from "../r2Body.ts";
import {
  normalizePublicVisibilityBlockedEntitiesManifest,
  PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
} from "../publicData/publicVisibilityManifestCore.ts";
import {
  normalizeRandomVideoPool,
  RANDOM_VIDEO_POOL_OBJECT_KEY,
} from "../publicData/randomVideoPoolCore.ts";
import {
  normalizeRecommendCore,
  RECOMMEND_CORE_OBJECT_KEY,
} from "../publicData/staticRecommendCore.ts";
import {
  normalizeYoutubeRelatedBlocklist,
  YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY,
} from "../publicData/staticYoutubeRelatedBlocklistCore.ts";

export const STATIC_ARTIFACT_SLO_MAX_AGE_SEC = 90 * 24 * 3600;
export const TOP_NOSTALGIC_SHUFFLE_SLO_MAX_AGE_SEC = 2 * 24 * 3600;
/** Health diagnostics must fail fast on corrupt/oversized artifacts instead of parsing unbounded JSON. */
export const ARTIFACT_SLO_MAX_OBJECT_BYTES = 16 * 1024 * 1024;

/**
 * Deep-health freshness ceilings. Keep inventory probes at the static default
 * so rebuild lag does not false-fail production smoke; nostalgic shuffle keeps
 * its dedicated 2-day check inside assertArtifactShape.
 */
export const ARTIFACT_SLO_MAX_AGE_SEC = Object.freeze({
  video_detail: STATIC_ARTIFACT_SLO_MAX_AGE_SEC,
  event_detail: STATIC_ARTIFACT_SLO_MAX_AGE_SEC,
  list_recent: STATIC_ARTIFACT_SLO_MAX_AGE_SEC,
  list_popular: STATIC_ARTIFACT_SLO_MAX_AGE_SEC,
  search: STATIC_ARTIFACT_SLO_MAX_AGE_SEC,
  top: STATIC_ARTIFACT_SLO_MAX_AGE_SEC,
  recommend: STATIC_ARTIFACT_SLO_MAX_AGE_SEC,
  recommend_core: STATIC_ARTIFACT_SLO_MAX_AGE_SEC,
  events_index: STATIC_ARTIFACT_SLO_MAX_AGE_SEC,
  users_index: STATIC_ARTIFACT_SLO_MAX_AGE_SEC,
  related_blocklist: STATIC_ARTIFACT_SLO_MAX_AGE_SEC,
  random_pool: STATIC_ARTIFACT_SLO_MAX_AGE_SEC,
  rules: STATIC_ARTIFACT_SLO_MAX_AGE_SEC,
});

export type ArtifactSloProbe = {
  key: string;
  requiredKeys: string[];
  maxAgeSec?: number;
  /** Missing object is OK until first write (bootstrap). */
  allowMissing?: boolean;
};

export type TrackedDetailArtifactSloProbe = {
  targetType: "video" | "event";
  expectedCountField: "public_video_detail_count" | "public_event_detail_count";
  trackedCountField: "tracked_video_detail_count" | "tracked_event_detail_count";
  oldestGeneratedAtField:
    | "oldest_video_detail_generated_at"
    | "oldest_event_detail_generated_at";
  maxAgeSec: number;
};

export type TrackedDetailArtifactSloRow = Partial<
  Record<
    TrackedDetailArtifactSloProbe[
      | "expectedCountField"
      | "trackedCountField"
      | "oldestGeneratedAtField"
    ],
    unknown
  >
>;

/** Detail keys are dynamic, so deep health probes their D1 tracking inventory. */
export const TRACKED_DETAIL_ARTIFACT_SLO_PROBES: readonly TrackedDetailArtifactSloProbe[] =
  Object.freeze([
    {
      targetType: "video",
      expectedCountField: "public_video_detail_count",
      trackedCountField: "tracked_video_detail_count",
      oldestGeneratedAtField: "oldest_video_detail_generated_at",
      maxAgeSec: ARTIFACT_SLO_MAX_AGE_SEC.video_detail,
    },
    {
      targetType: "event",
      expectedCountField: "public_event_detail_count",
      trackedCountField: "tracked_event_detail_count",
      oldestGeneratedAtField: "oldest_event_detail_generated_at",
      maxAgeSec: ARTIFACT_SLO_MAX_AGE_SEC.event_detail,
    },
  ]);

/** Requirement 14.2 global artifact inventory. */
export const ARTIFACT_SLO_PROBES: readonly ArtifactSloProbe[] = Object.freeze([
  {
    key: "top.json",
    requiredKeys: [
      "generated_at",
      "latest",
      "nostalgic_pool",
      "nostalgic",
      "nostalgic_shuffled_at",
      "stats",
    ],
    maxAgeSec: ARTIFACT_SLO_MAX_AGE_SEC.top,
  },
  {
    key: "list/recent.json",
    requiredKeys: ["generated_at", "total", "items"],
    maxAgeSec: ARTIFACT_SLO_MAX_AGE_SEC.list_recent,
  },
  {
    key: "list/popular.json",
    requiredKeys: ["generated_at", "total", "items"],
    maxAgeSec: ARTIFACT_SLO_MAX_AGE_SEC.list_popular,
  },
  {
    key: "search-index-lite.json",
    requiredKeys: ["generated_at", "videos", "users"],
    maxAgeSec: ARTIFACT_SLO_MAX_AGE_SEC.search,
  },
  {
    key: "events/index.json",
    requiredKeys: ["generated_at", "items", "group_sections"],
    maxAgeSec: ARTIFACT_SLO_MAX_AGE_SEC.events_index,
  },
  {
    key: "users/index.json",
    requiredKeys: ["generated_at", "items"],
    maxAgeSec: ARTIFACT_SLO_MAX_AGE_SEC.users_index,
  },
  {
    key: RECOMMEND_CORE_OBJECT_KEY,
    requiredKeys: [
      "schema_version",
      "generated_at",
      "recommended",
      "latest",
      "underrated",
    ],
    maxAgeSec: ARTIFACT_SLO_MAX_AGE_SEC.recommend_core,
    allowMissing: true,
  },
  {
    key: "recommend.json",
    requiredKeys: ["generated_at", "recommended", "latest", "underrated", "creators"],
    maxAgeSec: ARTIFACT_SLO_MAX_AGE_SEC.recommend,
  },
  {
    key: "rules/current.json",
    requiredKeys: ["generated_at", "version_label", "body_markdown"],
    maxAgeSec: ARTIFACT_SLO_MAX_AGE_SEC.rules,
  },
  {
    key: YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY,
    requiredKeys: ["schema_version", "generated_at", "blocked"],
    maxAgeSec: ARTIFACT_SLO_MAX_AGE_SEC.related_blocklist,
  },
  {
    key: RANDOM_VIDEO_POOL_OBJECT_KEY,
    requiredKeys: ["schema_version", "generated_at", "generation_key", "items"],
    maxAgeSec: ARTIFACT_SLO_MAX_AGE_SEC.random_pool,
  },
  {
    key: PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
    requiredKeys: ["schema_version", "revision", "generated_at", "entities"],
    allowMissing: true,
  },
]);

function parseGeneratedAt(value: unknown, label: string): number {
  const generatedAt = Number(value);
  if (!Number.isFinite(generatedAt) || generatedAt <= 0) {
    throw new Error(`${label}: invalid generated_at`);
  }
  return generatedAt;
}

function assertArrayField(
  payload: Record<string, unknown>,
  key: string,
  label: string,
): void {
  if (!Array.isArray(payload[key])) {
    throw new Error(`${label}: ${key} must be an array`);
  }
}

function assertArtifactShape(
  probe: ArtifactSloProbe,
  payload: Record<string, unknown>,
  nowSec: number,
): void {
  const generatedAt = parseGeneratedAt(payload.generated_at, probe.key);
  if (generatedAt > nowSec + 60) {
    throw new Error(`${probe.key}: generated_at is in the future`);
  }
  const maxAgeSec = probe.maxAgeSec ?? STATIC_ARTIFACT_SLO_MAX_AGE_SEC;
  if (nowSec - generatedAt > maxAgeSec) {
    throw new Error(`${probe.key}: generated_at is stale`);
  }

  if (probe.key === "top.json") {
    assertArrayField(payload, "latest", probe.key);
    assertArrayField(payload, "nostalgic_pool", probe.key);
    assertArrayField(payload, "nostalgic", probe.key);
    const shuffledAt = parseGeneratedAt(
      payload.nostalgic_shuffled_at,
      "top.json nostalgic_shuffled_at",
    );
    if (shuffledAt > nowSec + 60) {
      throw new Error("top.json: nostalgic_shuffled_at is in the future");
    }
    if (nowSec - shuffledAt > TOP_NOSTALGIC_SHUFFLE_SLO_MAX_AGE_SEC) {
      throw new Error("top.json: nostalgic_shuffled_at is stale");
    }
    if (!payload.stats || typeof payload.stats !== "object") {
      throw new Error("top.json: stats must be an object");
    }
    return;
  }

  if (probe.key === "list/recent.json" || probe.key === "list/popular.json") {
    assertArrayField(payload, "items", probe.key);
    const total = Number(payload.total);
    if (!Number.isFinite(total) || total < 0) {
      throw new Error(`${probe.key}: invalid total`);
    }
    const items = payload.items;
    if (Array.isArray(items) && items.length > total) {
      throw new Error(`${probe.key}: items length exceeds total`);
    }
    return;
  }

  if (probe.key === "search-index-lite.json") {
    assertArrayField(payload, "videos", probe.key);
    assertArrayField(payload, "users", probe.key);
    return;
  }

  if (probe.key === "events/index.json") {
    assertArrayField(payload, "items", probe.key);
    assertArrayField(payload, "group_sections", probe.key);
    return;
  }

  if (probe.key === "users/index.json") {
    assertArrayField(payload, "items", probe.key);
    return;
  }

  if (probe.key === RECOMMEND_CORE_OBJECT_KEY) {
    if (!normalizeRecommendCore(payload)) {
      throw new Error(`${probe.key}: malformed recommend core`);
    }
    return;
  }

  if (probe.key === "recommend.json") {
    assertArrayField(payload, "recommended", probe.key);
    assertArrayField(payload, "latest", probe.key);
    assertArrayField(payload, "underrated", probe.key);
    assertArrayField(payload, "creators", probe.key);
    return;
  }

  if (probe.key === YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY) {
    if (!normalizeYoutubeRelatedBlocklist(payload)) {
      throw new Error(`${probe.key}: malformed related blocklist`);
    }
    return;
  }

  if (probe.key === RANDOM_VIDEO_POOL_OBJECT_KEY) {
    if (!normalizeRandomVideoPool(payload)) {
      throw new Error(`${probe.key}: malformed random pool`);
    }
    return;
  }

  if (probe.key === PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY) {
    const normalized = normalizePublicVisibilityBlockedEntitiesManifest(payload);
    if (!normalized) {
      throw new Error(`${probe.key}: malformed visibility manifest`);
    }
  }
}

type ArtifactSloR2Object = {
  text: () => Promise<string>;
  size?: number;
  body?: unknown;
};

export async function assertArtifactSloFresh(
  bucket: { get: (key: string) => Promise<ArtifactSloR2Object | null> },
  nowSec: number,
  probes: readonly ArtifactSloProbe[] = ARTIFACT_SLO_PROBES,
): Promise<void> {
  for (const probe of probes) {
    const object = await bucket.get(probe.key);
    if (!object) {
      if (probe.allowMissing) continue;
      throw new Error(`static artifact missing: ${probe.key}`);
    }
    if (
      typeof object.size === "number" &&
      (!Number.isSafeInteger(object.size) ||
        object.size < 0 ||
        object.size > ARTIFACT_SLO_MAX_OBJECT_BYTES)
    ) {
      await cancelR2BodyBestEffort(object);
      throw new Error(`static artifact too large: ${probe.key}`);
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(await object.text()) as Record<string, unknown>;
    } catch {
      throw new Error(`static artifact malformed: ${probe.key}`);
    }
    for (const key of probe.requiredKeys) {
      if (!(key in payload)) {
        throw new Error(`${probe.key}: missing required field ${key}`);
      }
    }
    assertArtifactShape(probe, payload, nowSec);
  }
}

function parseArtifactCount(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label}: invalid artifact count`);
  }
  return parsed;
}

/** Validate dynamic video/event detail inventory recorded in static_artifacts. */
export function assertTrackedDetailArtifactSloFresh(
  row: TrackedDetailArtifactSloRow,
  nowSec: number,
  probes: readonly TrackedDetailArtifactSloProbe[] =
    TRACKED_DETAIL_ARTIFACT_SLO_PROBES,
): void {
  for (const probe of probes) {
    const expectedCount = parseArtifactCount(
      row[probe.expectedCountField],
      `${probe.targetType} detail expected`,
    );
    const trackedCount = parseArtifactCount(
      row[probe.trackedCountField],
      `${probe.targetType} detail tracked`,
    );
    if (trackedCount < expectedCount) {
      throw new Error(
        `${probe.targetType} detail artifact inventory is incomplete`,
      );
    }
    if (expectedCount === 0) continue;
    const generatedAt = parseGeneratedAt(
      row[probe.oldestGeneratedAtField],
      `${probe.targetType} detail oldest generated_at`,
    );
    if (generatedAt > nowSec + 60) {
      throw new Error(
        `${probe.targetType} detail oldest generated_at is in the future`,
      );
    }
    if (nowSec - generatedAt > probe.maxAgeSec) {
      throw new Error(`${probe.targetType} detail artifact is stale`);
    }
  }
}

export function listArtifactSloKeys(): string[] {
  return ARTIFACT_SLO_PROBES.map((probe) => probe.key);
}
