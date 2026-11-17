// MIG-0730 provisional read adapter (D-16-1): write SA-085 is still owned by MIG-0650.
// A successful read response is data for rendering, never proof of authorization.
import { AdminVideoMembersResponseSchema, type AdminVideoMembersResponse } from "@flamenode/contracts";
import { MAX_VIDEO_MEMBERS } from "@flamenode/domain/video/atomicLimits";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

/** Only CURRENT's publicly displayed member rows belong in this editor. */
export async function readAdminVideoMembers(
  videoId: string,
  fetchFn: OpsFetch = (path, init) => fetch(path, init),
  signal?: AbortSignal,
): Promise<OpsResult<AdminVideoMembersResponse>> {
  // Keep read and SA-085 write route IDs under the same fail-closed bounds.
  // Never make a GET for a malformed/overlong path or an already-aborted load.
  if (typeof videoId !== "string" || !videoId || videoId.length > 64 ||
      videoId.trim() !== videoId || videoId === "." || videoId === ".." ||
      /[\\/\\\\\\x00-\\x1f]/.test(videoId) || signal?.aborted) {
    return { status: "unavailable" };
  }
  // Invalid UTF-16 must fail closed without rejecting the load promise.
  let encoded: string;
  try {
    encoded = encodeURIComponent(videoId);
  } catch {
    return { status: "unavailable" };
  }

  const response = await getJson<unknown>(
    fetchFn, `/api/admin-read/videos/${encoded}/members`, signal,
  );
  if (response.status !== "ok") return response;
  // Do not parse an unbounded array on a malformed 200. CURRENT returns 404
  // when the authoritative D1 public-member query contains >100 rows.
  const body = response.data;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { status: "unavailable" };
  }
  const members = (body as { initialMembers?: unknown }).initialMembers;
  if (!Array.isArray(members) || members.length > MAX_VIDEO_MEMBERS) {
    return { status: "unavailable" };
  }
  const parsed = AdminVideoMembersResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.video.id !== videoId ||
      parsed.data.initialMembers.some((member) => member.is_public_member !== 1)) {
    // A hidden edit-only member must never become a public participant input.
    return { status: "unavailable" };
  }
  return { status: "ok", data: parsed.data };
}
