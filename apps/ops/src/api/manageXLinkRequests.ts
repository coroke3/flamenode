/** MIG-0725 U03a: read-only pending X ID link requests; keep writes unmounted until MIG-0605 contract parity. */
import { ManageXLinkRequestsResponseSchema, type ManageXLinkRequestsResponse } from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

/** Server-side manageGate is the authority. A 404 must never reveal request contents. */
export async function readManageXLinkRequests(
  fetchFn: OpsFetch,
  signal?: AbortSignal,
): Promise<OpsResult<ManageXLinkRequestsResponse>> {
  const result = await getJson<unknown>(fetchFn, "/api/manage/x-link-requests", signal);
  if (result.status !== "ok") return result;
  const parsed = ManageXLinkRequestsResponseSchema.safeParse(result.data);
  // An ill-formed 200 response is not permission to render partial request records.
  return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
}
