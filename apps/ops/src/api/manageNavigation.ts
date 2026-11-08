import { ManageNavigationResponseSchema, type ManageNavigationResponse } from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

export async function loadManageNavigation(fetchFn: OpsFetch, signal?: AbortSignal): Promise<OpsResult<ManageNavigationResponse>> {
  const response = await getJson<unknown>(fetchFn, "/api/manage/navigation", signal);
  if (response.status !== "ok") return response;
  const parsed = ManageNavigationResponseSchema.safeParse(response.data);
  return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
}
