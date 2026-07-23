import type { OperationMode } from "./types";

export const ISOLATE_MODE_TTL_MS = 30_000;

const isolateModeCache: {
  mode: OperationMode | null;
  expiresAt: number;
} = {
  mode: null,
  expiresAt: 0,
};

/** FORCE_STATIC_ONLY env: 1 / true / yes (case-insensitive). */
export function isForceStaticOnlyEnv(raw: string | undefined): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function resolveForcedOperationMode(
  raw: string | undefined,
): OperationMode | null {
  return isForceStaticOnlyEnv(raw) ? "static_only" : null;
}

export function readIsolateModeCache(now = Date.now()): OperationMode | null {
  if (isolateModeCache.mode && now < isolateModeCache.expiresAt) {
    return isolateModeCache.mode;
  }
  return null;
}

export function writeIsolateModeCache(
  mode: OperationMode,
  now = Date.now(),
): void {
  isolateModeCache.mode = mode;
  isolateModeCache.expiresAt = now + ISOLATE_MODE_TTL_MS;
}

export function resetPublicOperationModeCacheForTests(): void {
  isolateModeCache.mode = null;
  isolateModeCache.expiresAt = 0;
}
