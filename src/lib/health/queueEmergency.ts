import { resolveQueueFeatureFlags } from "../queues/featureFlags.ts";

export type QueueEmergencyState = {
  active: boolean;
  reason: string | null;
  expiresAtSec: number | null;
};

function truthyFlag(value: string | undefined | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseExpiresAtSec(value: string | undefined | null): number | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed / 1000);
}

export function resolveQueueEmergencyState(env: {
  QUEUE_EMERGENCY_DISABLED?: string;
  QUEUE_EMERGENCY_REASON?: string;
  QUEUE_EMERGENCY_EXPIRES_AT?: string;
}): QueueEmergencyState {
  if (!truthyFlag(env.QUEUE_EMERGENCY_DISABLED)) {
    return { active: false, reason: null, expiresAtSec: null };
  }
  const reason = env.QUEUE_EMERGENCY_REASON?.trim() ?? "";
  const expiresAtSec = parseExpiresAtSec(env.QUEUE_EMERGENCY_EXPIRES_AT);
  if (!reason || expiresAtSec === null) {
    return { active: false, reason: null, expiresAtSec: null };
  }
  return { active: true, reason, expiresAtSec };
}

export function isProductionRuntime(env: {
  FLAMENODE_LOCAL_PREVIEW?: string;
}): boolean {
  return env.FLAMENODE_LOCAL_PREVIEW?.trim() !== "1";
}

export type QueueHealthEvaluation = {
  status: "ok" | "degraded";
  emergency?: QueueEmergencyState;
};

export function evaluateDeepHealthQueueConfiguration(env: {
  FLAMENODE_LOCAL_PREVIEW?: string;
  QUEUE_DISPATCH_ENABLED?: string;
  QUEUE_CONTINUATION_ENABLED?: string;
  QUEUE_YOUTUBE_SYNC_ENABLED?: string;
  QUEUE_EMERGENCY_DISABLED?: string;
  QUEUE_EMERGENCY_REASON?: string;
  QUEUE_EMERGENCY_EXPIRES_AT?: string;
  NOTIFICATION_WAKE_QUEUE?: { send?: unknown };
  STATIC_REBUILD_WAKE_QUEUE?: { send?: unknown };
  YOUTUBE_SYNC_WAKE_QUEUE?: { send?: unknown };
}): QueueHealthEvaluation {
  const flags = resolveQueueFeatureFlags({
    QUEUE_DISPATCH_ENABLED: env.QUEUE_DISPATCH_ENABLED,
    QUEUE_CONTINUATION_ENABLED: env.QUEUE_CONTINUATION_ENABLED,
    QUEUE_YOUTUBE_SYNC_ENABLED: env.QUEUE_YOUTUBE_SYNC_ENABLED,
  });
  const anyEnabled =
    flags.dispatchEnabled ||
    flags.continuationEnabled ||
    flags.youtubeSyncEnabled;
  const allEnabled =
    flags.dispatchEnabled &&
    flags.continuationEnabled &&
    flags.youtubeSyncEnabled;
  const emergency = resolveQueueEmergencyState(env);
  const production = isProductionRuntime(env);

  if (emergency.active) {
    if (anyEnabled && !allEnabled) {
      throw new Error("queue emergency cannot coexist with partially enabled flags");
    }
    if (emergency.expiresAtSec !== null) {
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec > emergency.expiresAtSec) {
        throw new Error("queue emergency expired");
      }
    }
    if (!anyEnabled) {
      return { status: "degraded", emergency };
    }
  }

  if (!anyEnabled) {
    if (production) {
      throw new Error("queues disabled in production");
    }
    return { status: "ok" };
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

  return { status: "ok" };
}
