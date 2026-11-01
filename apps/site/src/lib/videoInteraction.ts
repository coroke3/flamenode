/** MIG-0513: POST client for SA-087; request/response shapes come from @flamenode/contracts (MIG-0640). No Server Actions. */
import { VideoInteractionBodySchema, VideoInteractionResultSchema } from "@flamenode/contracts";

export type InteractionKind = "like" | "bookmark";
export type InteractionResult = { ok: true; active?: boolean; videoId?: string } | { ok: false; message?: string };

export async function toggleInteraction(
  videoId: string,
  kind: InteractionKind,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<InteractionResult> {
  if (!videoId || videoId.length > 128 || !VideoInteractionBodySchema.safeParse({ kind }).success) {
    throw new Error("Invalid interaction request");
  }
  const response = await fetcher(`/api/videos/${encodeURIComponent(videoId)}/interaction`, {
    method: "POST", credentials: "same-origin", cache: "no-store", signal,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ kind }),
  });
  const parsed = VideoInteractionResultSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Invalid interaction response");
  const row = parsed.data;
  if (row.ok) {
    if (!response.ok) throw new Error("Invalid success status");
    return { ok: true, active: row.active, videoId: row.videoId };
  }
  return { ok: false, message: row.message };
}
