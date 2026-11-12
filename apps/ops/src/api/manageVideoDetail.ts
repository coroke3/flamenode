/** MIG-0724 U03: read-only detail client; Hono permission checks are authoritative. */
import { ManageVideoDetailResponseSchema, type ManageVideoDetailResponse } from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

export type ManageVideoDetailApi = ReturnType<typeof createManageVideoDetailApi>;

function validateDetail(payload: unknown, eventId: string, videoId: string): ManageVideoDetailResponse | null {
  const parsed = ManageVideoDetailResponseSchema.safeParse(payload);
  if (!parsed.success) return null;
  const data = parsed.data;
  // A syntactically valid but misplaced response must never disclose another event's video.
  if (data.event.id !== eventId || data.video.id !== videoId ||
      !data.video.event_ids.includes(eventId) ||
      data.video.event_ids.length === 0 ||
      !Number.isSafeInteger(data.video.created_at) ||
      !Number.isSafeInteger(data.pendingCount) || data.pendingCount < 0 ||
      data.video.customAnswers.length > 100 || data.video.members.length > 100) return null;
  return data;
}

export function createManageVideoDetailApi(fetchFn: OpsFetch) {
  return {
    async getDetail(
      eventId: string, videoId: string, signal?: AbortSignal,
    ): Promise<OpsResult<ManageVideoDetailResponse>> {
      if (!eventId || !videoId || signal?.aborted) return { status: "unavailable" };
      const path = `/api/manage/events/${encodeURIComponent(eventId)}/videos/${encodeURIComponent(videoId)}`;
      const response = await getJson<unknown>(fetchFn, path, signal);
      if (response.status !== "ok") return response;
      if (signal?.aborted) return { status: "unavailable" };
      const data = validateDetail(response.data, eventId, videoId);
      return data ? { status: "ok", data } : { status: "unavailable" };
    },
  };
}
