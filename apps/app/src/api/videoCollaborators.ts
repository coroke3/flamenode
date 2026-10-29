import { EditPermissionsResponseSchema, type EditPermissionsResponse } from "@flamenode/contracts";

/** MIG-0715 U01: read-only boundary; writes wait for the MIG-0650 API. */
export type EditPermissionsReadResult =
  | { status: "ok"; data: EditPermissionsResponse }
  | { status: "not_found" }
  | { status: "anonymous" }
  | { status: "banned" }
  | { status: "unavailable" };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function getEditPermissions({
  videoId,
  privilegeModes,
  signal,
  fetchFn = (input, init) => fetch(input, init),
}: {
  videoId: string;
  privilegeModes: readonly string[];
  signal?: AbortSignal;
  fetchFn?: FetchLike;
}): Promise<EditPermissionsReadResult> {
  const params = new URLSearchParams();
  // Preserve repeated/unknown values: only Hono can decide explicit-mode fallback.
  for (const mode of privilegeModes) params.append("privileged", mode);
  const query = params.toString();
  const path = "/api/personal/edit/" + encodeURIComponent(videoId) + "/permissions" + (query ? "?" + query : "");

  let response: Response;
  try {
    response = await fetchFn(path, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
  } catch {
    return { status: "unavailable" };
  }
  if (response.status === 401) return { status: "anonymous" };
  if (response.status === 403) return { status: "banned" };
  if (response.status === 404) return { status: "not_found" };
  if (response.status !== 200) return { status: "unavailable" };

  try {
    const parsed = EditPermissionsResponseSchema.safeParse(await response.json());
    return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
