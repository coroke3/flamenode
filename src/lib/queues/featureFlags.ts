/**
 * Queue feature flags（env のみ。D1 を読まない）。
 */

import { QUEUE_FEATURE_FLAG_NAMES } from "./wakeBudget.ts";

/** Worker/Web の Env 全体を渡せるよう、flag 以外の binding は無視する。 */
export type QueueFeatureFlagEnv = object;

function truthyFlag(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export type QueueFeatureFlags = {
  dispatchEnabled: boolean;
  continuationEnabled: boolean;
  youtubeSyncEnabled: boolean;
};

export function resolveQueueFeatureFlags(
  env: QueueFeatureFlagEnv | null | undefined,
): QueueFeatureFlags {
  const source = (env ?? {}) as Record<string, unknown>;
  return {
    dispatchEnabled: truthyFlag(source[QUEUE_FEATURE_FLAG_NAMES.dispatch]),
    continuationEnabled: truthyFlag(
      source[QUEUE_FEATURE_FLAG_NAMES.continuation],
    ),
    youtubeSyncEnabled: truthyFlag(
      source[QUEUE_FEATURE_FLAG_NAMES.youtubeSync],
    ),
  };
}
