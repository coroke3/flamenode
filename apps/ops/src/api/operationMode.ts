// MIG-0719 U06: MIG-0661 CostGuardBanner contract (GET /api/operation-mode/banner).
import { CostGuardBannerResponseSchema, type CostGuardBannerResponse } from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";
export type OperationMode = CostGuardBannerResponse["mode"];
export type OperationModeBanner = CostGuardBannerResponse;
export async function loadOperationMode(fetchFn: OpsFetch, signal?: AbortSignal): Promise<OpsResult<OperationModeBanner>> {
  const result = await getJson<unknown>(fetchFn, "/api/operation-mode/banner", signal);
  if (result.status !== "ok") return result;
  const parsed = CostGuardBannerResponseSchema.safeParse(result.data);
  return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
}
