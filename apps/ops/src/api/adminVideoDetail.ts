import {
  AdminVideoDetailResponseSchema,
  type AdminVideoDetailResponse,
  type AdminVideoModerationCase,
} from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

/** CURRENT extractYoutubeId parity for the two unmounted admin consumers.
 * Reconcile with the MIG-0724 shared video-review owner (D-17-6) before mount.
 */
export function adminVideoYoutubeId(supplied: string | null | undefined): string | null {
  const youtubeIdPattern = /^[A-Za-z0-9_-]{11}$/;
  if (typeof supplied === "string" && supplied) {
    const trimmed = supplied.trim();
    if (youtubeIdPattern.test(trimmed)) return trimmed;
    try {
      const url = new URL(trimmed);
      if (url.protocol === "http:" || url.protocol === "https:") {
        const host = url.hostname.toLowerCase().replace(/^www\./, "");
        if (host === "youtu.be") {
          const id = url.pathname.split("/").filter(Boolean)[0];
          if (id && youtubeIdPattern.test(id)) return id;
        }
        if (host === "youtube.com" || host.endsWith(".youtube.com")) {
          const queryId = url.searchParams.get("v");
          if (queryId && youtubeIdPattern.test(queryId)) return queryId;
          const parts = url.pathname.split("/").filter(Boolean);
          const index = parts.findIndex(part =>
            ["shorts", "embed", "live", "v"].includes(part));
          if (index >= 0 && parts[index + 1] &&
              youtubeIdPattern.test(parts[index + 1]!)) {
            return parts[index + 1]!;
          }
        }
      }
    } catch {
      // Invalid or hostile video URL: no image request.
    }
  }
  return null;
}

export function adminVideoThumbnailHref(
  supplied: string | null | undefined,
  size: "default" | "maxresdefault",
): string | null {
  const id = adminVideoYoutubeId(supplied);
  return id ? `/api/youtube-thumbnail/${id}/${size}` : null;
}

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

type AdminVideoDetailResult = OpsResult<AdminVideoDetailResponse> | { status: "invalid" };

export async function loadAdminVideoDetail(
  fetchFn: OpsFetch,
  videoId: string,
  event: string | null,
  signal?: AbortSignal,
): Promise<AdminVideoDetailResult> {
  if (!videoId || videoId.length > 256) return { status: "notFound" };
  const url = `/api/admin-read/videos/${encodeURIComponent(videoId)}${event ? `?event=${encodeURIComponent(event)}` : ""}`;
  // A received HTTP 200 with an unreadable body is an invalid private
  // receipt, not an ordinary pre-header/network or non-200 transport failure.
  // Keep shared getJson authorization and cancellation handling unchanged.
  let received200 = false;
  const response = await getJson<unknown>(async (path, init) => {
    const received = await fetchFn(path, init);
    received200 = received.status === 200;
    return received;
  }, url, signal);
  if (response.status === "unavailable" && received200 && !signal?.aborted) {
    return { status: "invalid" };
  }
  if (response.status !== "ok") return response;
  const parsed = AdminVideoDetailResponseSchema.safeParse(response.data);
  // The Hono read handler echoes c.req.query("event")?.trim() || null.
  // Accept only the DTO for this exact video and normalized review context.
  const expectedEvent = event?.trim() || null;
  if (!parsed.success || parsed.data.video.id !== videoId || parsed.data.event !== expectedEvent) {
    return { status: "invalid" };
  }
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
