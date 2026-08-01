import { resolveQueueFeatureFlags } from "../queues/featureFlags.ts";

const STATIC_ARTIFACT_MAX_AGE_SEC = 90 * 24 * 3600;

type StaticArtifactProbe = {
  key: string;
  requiredKeys: string[];
};

const STATIC_ARTIFACT_PROBES: StaticArtifactProbe[] = [
  {
    key: "top.json",
    requiredKeys: ["generated_at", "latest", "stats"],
  },
  {
    key: "list/recent.json",
    requiredKeys: ["generated_at", "total", "items"],
  },
];

function assertQueueConfiguration(env: {
  QUEUE_DISPATCH_ENABLED?: string;
  QUEUE_CONTINUATION_ENABLED?: string;
  QUEUE_YOUTUBE_SYNC_ENABLED?: string;
  NOTIFICATION_WAKE_QUEUE?: { send?: unknown };
  STATIC_REBUILD_WAKE_QUEUE?: { send?: unknown };
  YOUTUBE_SYNC_WAKE_QUEUE?: { send?: unknown };
}): void {
  const flags = resolveQueueFeatureFlags({
    QUEUE_DISPATCH_ENABLED: env.QUEUE_DISPATCH_ENABLED,
    QUEUE_CONTINUATION_ENABLED: env.QUEUE_CONTINUATION_ENABLED,
    QUEUE_YOUTUBE_SYNC_ENABLED: env.QUEUE_YOUTUBE_SYNC_ENABLED,
  });
  // Template / Build 既定は "0"。全オフは意図的な停止として deep health を通す。
  // 1つでも有効なら3旗とも "1" かつ wake binding を要求する（部分有効は fail-closed）。
  const anyEnabled =
    flags.dispatchEnabled ||
    flags.continuationEnabled ||
    flags.youtubeSyncEnabled;
  if (!anyEnabled) {
    return;
  }
  if (!flags.dispatchEnabled) {
    throw new Error("queue dispatch disabled");
  }
  if (!flags.continuationEnabled) {
    throw new Error("queue continuation disabled");
  }
  if (!flags.youtubeSyncEnabled) {
    throw new Error("youtube sync queue disabled");
  }
  if (typeof env.NOTIFICATION_WAKE_QUEUE?.send !== "function") {
    throw new Error("notification wake queue binding missing");
  }
  if (typeof env.STATIC_REBUILD_WAKE_QUEUE?.send !== "function") {
    throw new Error("static rebuild wake queue binding missing");
  }
  if (typeof env.YOUTUBE_SYNC_WAKE_QUEUE?.send !== "function") {
    throw new Error("youtube sync wake queue binding missing");
  }
}

function parseGeneratedAt(value: unknown, label: string): number {
  const generatedAt = Number(value);
  if (!Number.isFinite(generatedAt) || generatedAt <= 0) {
    throw new Error(`${label}: invalid generated_at`);
  }
  return generatedAt;
}

export async function assertStaticArtifactsFresh(
  bucket: { get: (key: string) => Promise<{ text: () => Promise<string> } | null> },
  nowSec: number,
): Promise<void> {
  for (const probe of STATIC_ARTIFACT_PROBES) {
    const object = await bucket.get(probe.key);
    if (!object) {
      throw new Error(`static artifact missing: ${probe.key}`);
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
    const generatedAt = parseGeneratedAt(payload.generated_at, probe.key);
    if (generatedAt > nowSec + 60) {
      throw new Error(`${probe.key}: generated_at is in the future`);
    }
    if (nowSec - generatedAt > STATIC_ARTIFACT_MAX_AGE_SEC) {
      throw new Error(`${probe.key}: generated_at is stale`);
    }
    if (probe.key === "top.json") {
      if (!Array.isArray(payload.latest)) {
        throw new Error("top.json: latest must be an array");
      }
      if (!payload.stats || typeof payload.stats !== "object") {
        throw new Error("top.json: stats must be an object");
      }
    }
    if (probe.key === "list/recent.json") {
      if (!Array.isArray(payload.items)) {
        throw new Error("list/recent.json: items must be an array");
      }
      const total = Number(payload.total);
      if (!Number.isFinite(total) || total < 0) {
        throw new Error("list/recent.json: invalid total");
      }
      if (payload.items.length > total) {
        throw new Error("list/recent.json: items length exceeds total");
      }
    }
  }
}

export function assertDeepHealthQueueConfiguration(env: {
  QUEUE_DISPATCH_ENABLED?: string;
  QUEUE_CONTINUATION_ENABLED?: string;
  QUEUE_YOUTUBE_SYNC_ENABLED?: string;
  NOTIFICATION_WAKE_QUEUE?: { send?: unknown };
  STATIC_REBUILD_WAKE_QUEUE?: { send?: unknown };
  YOUTUBE_SYNC_WAKE_QUEUE?: { send?: unknown };
}): void {
  assertQueueConfiguration(env);
}
