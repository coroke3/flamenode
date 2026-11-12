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

/**
 * The status-write handler accepts only a matching open case of type "void".
 * CURRENT's fallback to an unrelated open case is rejected by that handler.
 * Do not advertise a possible un-void action until a valid case exists.
 */
export function selectOpenVoidCaseId(cases: readonly AdminVideoModerationCase[]): string | null {
  return cases.find((item) => item.status === "open" && item.case_type === "void")?.id ?? null;
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

const adminDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** Parity with CURRENT formatUnix: timestamps are UTC-based Unix seconds rendered in JST. */
export function formatAdminVideoUnix(unixSec: number | null): string {
  if (unixSec === null || !Number.isFinite(unixSec)) return "-";
  const date = new Date(unixSec * 1000);
  return Number.isFinite(date.getTime()) ? adminDateFormatter.format(date) : "-";
}
