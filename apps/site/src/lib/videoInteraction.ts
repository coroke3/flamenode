/** MIG-0513: provisional SA-087 client until MIG-0640 merges. No Server Actions. */
export type InteractionKind = "like" | "bookmark";
export type InteractionResult = { ok: true; active?: boolean; videoId?: string } | { ok: false; message?: string };

export async function toggleInteraction(
  videoId: string,
  kind: InteractionKind,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<InteractionResult> {
  if (!videoId || videoId.length > 128 || !["like", "bookmark"].includes(kind)) {
    throw new Error("Invalid interaction request");
  }
  const response = await fetcher(`/api/videos/${encodeURIComponent(videoId)}/interaction`, {
    method: "POST", credentials: "same-origin", cache: "no-store", signal,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ kind }),
  });
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof (body as { ok?: unknown }).ok !== "boolean") {
    throw new Error("Invalid interaction response");
  }
  const row = body as Record<string, unknown>;
  if (row.active !== undefined && typeof row.active !== "boolean") throw new Error("Invalid active flag");
  if (row.message !== undefined && typeof row.message !== "string") throw new Error("Invalid interaction message");
  if (row.videoId !== undefined && typeof row.videoId !== "string") throw new Error("Invalid video id");
  if (row.ok === true) {
    if (!response.ok) throw new Error("Invalid success status");
    return { ok: true, active: row.active as boolean | undefined, videoId: row.videoId as string | undefined };
  }
  return { ok: false, message: row.message as string | undefined };
}
