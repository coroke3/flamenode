import {
  OPERATION_MODE_KV_KEY,
  parseOperationModeKvMirror,
} from "./kvMirrorCore";

// Middleware runs for nearly every document/API request.  Maintenance mode is
// an operational redirect rather than an authorization boundary, so a very
// short bounded-stale cache is safe and avoids one KV read per request.
const MIDDLEWARE_MAINTENANCE_LOCAL_TTL_MS = 5_000;
const MIDDLEWARE_MAINTENANCE_KV_CACHE_TTL_SEC = 30;

let maintenanceCache: {
  value: boolean;
  expiresAt: number;
} = {
  value: false,
  expiresAt: 0,
};

/**
 * Edge middleware 向けメンテナンス判定。
 * 優先: MAINTENANCE_MODE env → KV operation_mode ミラー。
 */
export async function resolveMiddlewareMaintenance(): Promise<boolean> {
  if (process.env.MAINTENANCE_MODE === "1") return true;

  const now = Date.now();
  if (now < maintenanceCache.expiresAt) return maintenanceCache.value;

  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const kv = getCloudflareContext().env.KV;
    if (!kv) {
      maintenanceCache = {
        value: false,
        expiresAt: now + MIDDLEWARE_MAINTENANCE_LOCAL_TTL_MS,
      };
      return false;
    }
    const raw = await kv.get(OPERATION_MODE_KV_KEY, {
      cacheTtl: MIDDLEWARE_MAINTENANCE_KV_CACHE_TTL_SEC,
    });
    const mirror = parseOperationModeKvMirror(raw);
    const value = mirror?.mode === "maintenance";
    maintenanceCache = {
      value,
      expiresAt: now + MIDDLEWARE_MAINTENANCE_LOCAL_TTL_MS,
    };
    return value;
  } catch {
    // A KV outage must not turn the middleware into a 500.  Cache the
    // fail-open result briefly to avoid retrying a broken binding per request.
    maintenanceCache = {
      value: false,
      expiresAt: now + MIDDLEWARE_MAINTENANCE_LOCAL_TTL_MS,
    };
    return false;
  }
}

export function resetMiddlewareMaintenanceCacheForTests(): void {
  maintenanceCache = { value: false, expiresAt: 0 };
}
