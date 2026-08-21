import "server-only";

import { getEnv } from "@/lib/cloudflare";
import {
  OPERATION_MODE_KV_KEY,
  parseOperationModeKvMirror,
  type OperationModeKvMirror,
} from "./kvMirrorCore";

export {
  OPERATION_MODE_KV_KEY,
  parseOperationModeKvMirror,
  type OperationModeKvMirror,
} from "./kvMirrorCore";

/**
 * Operation mode is deliberately bounded-stale.  It is read by many public
 * layouts, while writes happen only when CostGuard changes the mode.  Keep a
 * small isolate-local mirror so one request does not spend one KV read for
 * the mode and another for the banner reason.
 */
const OPERATION_MODE_KV_CACHE_TTL_MS = 30_000;
const OPERATION_MODE_KV_ERROR_CACHE_TTL_MS = 5_000;

let mirrorCache: {
  value: OperationModeKvMirror | null;
  expiresAt: number;
} = {
  value: null,
  expiresAt: 0,
};

export function getOperationModeKv(): KVNamespace | null {
  try {
    return getEnv().KV ?? null;
  } catch {
    return null;
  }
}

export async function readOperationModeKvMirror(): Promise<OperationModeKvMirror | null> {
  const now = Date.now();
  if (now < mirrorCache.expiresAt) return mirrorCache.value;

  const kv = getOperationModeKv();
  if (!kv) {
    mirrorCache = {
      value: null,
      expiresAt: now + OPERATION_MODE_KV_ERROR_CACHE_TTL_MS,
    };
    return null;
  }

  try {
    const raw = await kv.get(OPERATION_MODE_KV_KEY, {
      cacheTtl: OPERATION_MODE_KV_CACHE_TTL_MS / 1_000,
    });
    const value = typeof raw === "string" ? parseOperationModeKvMirror(raw) : null;
    mirrorCache = {
      value,
      expiresAt: now + OPERATION_MODE_KV_CACHE_TTL_MS,
    };
    return value;
  } catch {
    // KV is a mirror, never a reason to fail public rendering.
    mirrorCache = {
      value: null,
      expiresAt: now + OPERATION_MODE_KV_ERROR_CACHE_TTL_MS,
    };
    return null;
  }
}

export async function writeOperationModeKvMirror(
  mirror: OperationModeKvMirror,
): Promise<void> {
  const kv = getOperationModeKv();
  if (!kv) {
    throw new Error("KV binding is unavailable");
  }
  await kv.put(OPERATION_MODE_KV_KEY, JSON.stringify(mirror));
  mirrorCache = {
    value: mirror,
    expiresAt: Date.now() + OPERATION_MODE_KV_CACHE_TTL_MS,
  };
}

export function resetOperationModeKvMirrorCacheForTests(): void {
  mirrorCache = { value: null, expiresAt: 0 };
}
