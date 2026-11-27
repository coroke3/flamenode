import { ManageNotificationCenterResponseSchema, type ManageNotificationCenterResponse } from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

/**
 * MIG-0725 U02: CURRENT GET-form parameters, including empty values, are the
 * single source of truth for both the URL and the Hono request.
 */
export function notificationCenterPath(search: URLSearchParams): string {
  const query = new URLSearchParams();
  for (const name of ["event", "notif", "status"]) {
    if (search.has(name)) query.set(name, search.get(name) ?? "");
  }
  const suffix = query.toString();
  return "/api/manage/notifications" + (suffix ? "?" + suffix : "");
}

export async function readManageNotifications(
  fetchFn: OpsFetch,
  search: URLSearchParams,
  signal?: AbortSignal,
): Promise<OpsResult<ManageNotificationCenterResponse>> {
  const result = await getJson<unknown>(fetchFn, notificationCenterPath(search), signal);
  if (result.status !== "ok") return result;
  const parsed = ManageNotificationCenterResponseSchema.safeParse(result.data);
  // A malformed 200 must not expose partial protected data or masquerade as empty.
  return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
}
