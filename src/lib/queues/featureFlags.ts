/**
 * Queue feature flags（env のみ。D1 を読まない）。
 */

import { QUEUE_FEATURE_FLAG_NAMES } from "./wakeBudget.ts";

function truthyFlag(value: string | undefined | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export type QueueFeatureFlags = {
  dispatchEnabled: boolean;
  continuationEnabled: boolean;
  youtubeSyncEnabled: boolean;
};

export function resolveQueueFeatureFlags(
  env: Record<string, string | undefined> | null | undefined,
): QueueFeatureFlags {
  const source = env ?? {};
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
