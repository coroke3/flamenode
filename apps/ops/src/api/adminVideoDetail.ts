import {
  AdminVideoDetailResponseSchema,
  type AdminVideoDetailResponse,
  type AdminVideoModerationCase,
} from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

/** MIG-0729 U02: keep detail's optional event context in the GET and return URLs. */
export function adminVideoDetailPath(videoId: string, event: string | null = null): string {
  const path = `/admin/videos/${encodeURIComponent(videoId)}`;
  return event ? `${path}?event=${encodeURIComponent(event)}` : path;
}

export function adminVideoBackHref(event: string | null): string {
  return event
    ? `/admin/videos?status=review&event=${encodeURIComponent(event)}`
    : "/admin/videos";
}

/** CURRENT chooses the first open void case, otherwise the first open case. */
export function selectOpenVoidCaseId(cases: readonly AdminVideoModerationCase[]): string | null {
  return cases.find((item) => item.status === "open" && item.case_type === "void")?.id
    ?? cases.find((item) => item.status === "open")?.id
    ?? null;
}

export async function loadAdminVideoDetail(
  fetchFn: OpsFetch,
  videoId: string,
  event: string | null,
  signal?: AbortSignal,
): Promise<OpsResult<AdminVideoDetailResponse>> {
  if (!videoId || videoId.length > 256) return { status: "notFound" };
  const url = `/api/admin-read/videos/${encodeURIComponent(videoId)}${event ? `?event=${encodeURIComponent(event)}` : ""}`;
  const response = await getJson<unknown>(fetchFn, url, signal);
  if (response.status !== "ok") return response;
  const parsed = AdminVideoDetailResponseSchema.safeParse(response.data);
  if (!parsed.success || parsed.data.video.id !== videoId) return { status: "unavailable" };
  return { status: "ok", data: parsed.data };
}
