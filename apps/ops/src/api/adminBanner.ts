/** MIG-0726 U02/U05: admin CostGuardBanner read (GET /api/admin-read/cost-guard-banner, MIG-0661 DTO). */
import type { CostGuardBannerResponse } from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

export type { CostGuardBannerResponse };

const MODES = new Set(["normal", "economy", "read_only", "static_only", "maintenance"]);
/** Mirrors MAX_COST_GUARD_BANNER_REASON_CHARS; the zod schema is not bundled into the browser. */
const MAX_REASON_CHARS = 2048;

/** Strict parse of the MIG-0661 schema. Anything else renders no banner, like CURRENT's catch -> null. */
export function parseCostGuardBanner(value: unknown): CostGuardBannerResponse | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const { mode, reason } = value as Record<string, unknown>;
  if (typeof mode !== "string" || !MODES.has(mode)) return null;
  if (reason !== null && (typeof reason !== "string" || reason.length > MAX_REASON_CHARS)) return null;
  return { mode: mode as CostGuardBannerResponse["mode"], reason };
}

export async function fetchCostGuardBanner(
  fetchFn: OpsFetch,
  signal?: AbortSignal,
): Promise<OpsResult<CostGuardBannerResponse>> {
  const result = await getJson<unknown>(fetchFn, "/api/admin-read/cost-guard-banner", signal);
  if (result.status !== "ok") return result;
  const parsed = parseCostGuardBanner(result.data);
  return parsed ? { status: "ok", data: parsed } : { status: "unavailable" };
}
