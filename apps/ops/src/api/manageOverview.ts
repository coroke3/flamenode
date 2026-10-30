/** MIG-0720 U02a: event-scoped Manage overview read; no privileged cache. */
import { ManageOverviewResponseSchema, type ManageOverviewResponse } from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

export type ManageNotifCategory = ManageOverviewResponse["notifCategory"];

/** Mirrors Hono/CURRENT: unsupported notification filters become "all". */
export function normalizeManageNotifFilter(raw: string | null | undefined): ManageNotifCategory {
  return raw === "video" || raw === "x_id" || raw === "slot" ||
    raw === "chapter" || raw === "other" ? raw : "all";
}

export function manageOverviewPath(eventId: string, notif: ManageNotifCategory): string {
  const path = `/api/manage/events/${encodeURIComponent(eventId)}`;
  return notif === "all" ? path : `${path}?notif=${encodeURIComponent(notif)}`;
}

export async function loadManageOverview(
  fetchFn: OpsFetch,
  eventId: string,
  notifRaw: string | null | undefined,
  signal?: AbortSignal,
): Promise<OpsResult<ManageOverviewResponse>> {
  // Never dispatch a request with an empty route parameter.
  if (!eventId.trim() || eventId.length > 256 || /[\u0000-\u001f\u007f]/.test(eventId)) {
    return { status: "notFound" };
  }
  const category = normalizeManageNotifFilter(notifRaw);
  const response = await getJson<unknown>(fetchFn, manageOverviewPath(eventId, category), signal);
  if (response.status !== "ok") return response;

  const parsed = ManageOverviewResponseSchema.safeParse(response.data);
  // A schema mismatch, wrong event or mismatched filter is not a usable
  // response. In particular, never render previously authorized event data.
  if (!parsed.success || parsed.data.event.id !== eventId ||
      parsed.data.notifCategory !== category) {
    return { status: "unavailable" };
  }
  return { status: "ok", data: parsed.data };
}
