import { ManageDashboardResponseSchema, type ManageDashboardResponse } from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

export async function loadManageDashboard(fetchFn: OpsFetch, signal?: AbortSignal): Promise<OpsResult<ManageDashboardResponse>> {
  const response = await getJson<unknown>(fetchFn, "/api/manage", signal);
  if (response.status !== "ok") return response;
  const parsed = ManageDashboardResponseSchema.safeParse(response.data);
  return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
}
