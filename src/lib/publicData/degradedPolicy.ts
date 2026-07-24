import "server-only";

import { getEnv } from "@/lib/cloudflare";
import type { PublicDataStrategy } from "@/lib/operationMode/types";

function readPublicDegradedD1EnabledRaw(): string | undefined {
  if (process.env.PUBLIC_DEGRADED_D1_ENABLED !== undefined) {
    return process.env.PUBLIC_DEGRADED_D1_ENABLED;
  }
  try {
    return getEnv().PUBLIC_DEGRADED_D1_ENABLED;
  } catch {
    return undefined;
  }
}

/** Default enabled. Explicit `0` / `false` / `no` disables D1 fallback after R2 miss. */
export function isPublicDegradedD1Enabled(): boolean {
  const raw = readPublicDegradedD1EnabledRaw();
  if (raw == null || raw === "") return true;
  const normalized = raw.trim().toLowerCase();
  return !(
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  );
}

export function canAttemptDegradedD1(strategy: PublicDataStrategy): boolean {
  return strategy === "static_json_with_live_overlay" && isPublicDegradedD1Enabled();
}
