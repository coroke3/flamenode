import {
  EventPlaylistSettingsResultSchema,
  EventPlaylistSyncResultSchema,
  ManagePlaylistResponseSchema,
  type ManagePlaylistResponse,
} from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

/** MIG-0725 U01: provisional endpoints until MIG-0655 is integrated. */
export const playlistPagePath = (eventId: string): string =>
  "/manage/events/" + encodeURIComponent(eventId) + "/youtube-playlist";

const playlistApiPath = (eventId: string): string =>
  "/api/manage/events/" + encodeURIComponent(eventId) + "/youtube-playlist";

export async function readManagePlaylist(
  fetchFn: OpsFetch,
  eventId: string,
  signal?: AbortSignal,
): Promise<OpsResult<ManagePlaylistResponse>> {
  const result = await getJson<unknown>(fetchFn, playlistApiPath(eventId), signal);
  if (result.status !== "ok") return result;
  const parsed = ManagePlaylistResponseSchema.safeParse(result.data);
  return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
}

export type PlaylistMutationResult =
  | { status: "success" }
  | { status: "error"; message: string }
  | { status: "anonymous" | "forbidden" | "notFound" | "unavailable" };

async function sendPlaylistWrite(
  fetchFn: OpsFetch,
  eventId: string,
  method: "PUT" | "POST",
  suffix: "" | "/sync",
  body: Record<string, string>,
  signal?: AbortSignal,
): Promise<PlaylistMutationResult> {
  try {
    const response = await fetchFn(playlistApiPath(eventId) + suffix, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (signal?.aborted) return { status: "unavailable" };
    if (response.status === 401) return { status: "anonymous" };
    if (response.status === 403) return { status: "forbidden" };
    if (response.status === 404) return { status: "notFound" };
    if (response.status !== 200) return { status: "unavailable" };
    const payload: unknown = await response.json();
    if (signal?.aborted) return { status: "unavailable" };
    const parsed = method === "PUT"
      ? EventPlaylistSettingsResultSchema.safeParse(payload)
      : EventPlaylistSyncResultSchema.safeParse(payload);
    if (!parsed.success) return { status: "unavailable" };
    if (!parsed.data.ok) {
      return { status: "error", message: parsed.data.message.slice(0, 500) };
    }
    return { status: "success" };
  } catch {
    return { status: "unavailable" };
  }
}

export function playlistSettingsBody(form: FormData): Record<string, string> {
  return {
    playlist_id: String(form.get("playlist_id") ?? ""),
    sync_mode: String(form.get("sync_mode") ?? "off"),
    sync_interval_minutes: String(form.get("sync_interval_minutes") ?? "720"),
  };
}

export const saveManagePlaylist = (
  fetchFn: OpsFetch, eventId: string, form: FormData, signal?: AbortSignal,
): Promise<PlaylistMutationResult> =>
  sendPlaylistWrite(fetchFn, eventId, "PUT", "", playlistSettingsBody(form), signal);

export const queueManagePlaylist = (
  fetchFn: OpsFetch, eventId: string, signal?: AbortSignal,
): Promise<PlaylistMutationResult> =>
  sendPlaylistWrite(fetchFn, eventId, "POST", "/sync", {}, signal);

/** Never accept a redirect URL from the API; only map its text to CURRENT query keys. */
export function playlistResultHref(
  eventId: string, action: "saved" | "queued", result: PlaylistMutationResult,
): string {
  const query = new URLSearchParams();
  if (result.status === "success") query.set(action, "1");
  else if (result.status === "error") query.set("error", result.message);
  else query.set("error", "操作に失敗しました。再読み込みしてお試しください。");
  return playlistPagePath(eventId) + "?" + query.toString();
}
