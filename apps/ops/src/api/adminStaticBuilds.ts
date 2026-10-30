/** MIG-0735 provisional adapter. POST paths are owned by MIG-0643 and not mounted on main yet. */
import {
  AdminStaticBuildsResponseSchema,
  AdminYoutubeSyncResponseSchema,
  AdminYoutubePlaylistsResponseSchema,
  AdminYoutubeQuotaResponseSchema,
} from "@flamenode/contracts";
import type {
  AdminStaticBuildsResponse,
  AdminYoutubeSyncResponse,
  AdminYoutubePlaylistsResponse,
  AdminYoutubeQuotaResponse,
} from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

type Parser<T> = { parse(input: unknown): T };
type WritePayload = Record<string, string>;
export type AdminMutationResult =
  | { status: "ok"; data: Record<string, unknown> }
  | { status: "anonymous" | "forbidden" | "unavailable" };

export async function getAdminOps<T>(
  suffix: string, parser: Parser<T>,
  fetchFn: OpsFetch = (path, init) => fetch(path, init),
  signal?: AbortSignal,
): Promise<OpsResult<T>> {
  const result = await getJson<unknown>(fetchFn, "/api/admin-read/ops/" + suffix, signal);
  if (result.status !== "ok") return result;
  try {
    return { status: "ok", data: parser.parse(result.data) };
  } catch {
    return { status: "unavailable" };
  }
}

export const readStaticBuilds = (fetchFn?: OpsFetch, signal?: AbortSignal) =>
  getAdminOps<AdminStaticBuildsResponse>("static-builds", AdminStaticBuildsResponseSchema, fetchFn, signal);
export const readYoutubeSync = (query: string, fetchFn?: OpsFetch, signal?: AbortSignal) =>
  getAdminOps<AdminYoutubeSyncResponse>("youtube-sync" + query, AdminYoutubeSyncResponseSchema, fetchFn, signal);
export const readYoutubePlaylists = (query: string, fetchFn?: OpsFetch, signal?: AbortSignal) =>
  getAdminOps<AdminYoutubePlaylistsResponse>("youtube-playlists" + query, AdminYoutubePlaylistsResponseSchema, fetchFn, signal);
export const readYoutubeQuota = (fetchFn?: OpsFetch, signal?: AbortSignal) =>
  getAdminOps<AdminYoutubeQuotaResponse>("youtube-quota", AdminYoutubeQuotaResponseSchema, fetchFn, signal);

/** Fail closed on malformed, denied, and unknown responses. Never surface API exception text. */
export async function postAdminOp(
  path: string, payload: WritePayload,
  fetchFn: OpsFetch = (url, init) => fetch(url, init),
): Promise<AdminMutationResult> {
  try {
    const response = await fetchFn("/api/admin/" + path, {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.status === 401) return { status: "anonymous" };
    if (response.status === 403) return { status: "forbidden" };
    if (response.status < 200 || response.status >= 300) return { status: "unavailable" };
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) return { status: "unavailable" };
    const record = data as Record<string, unknown>;
    if (record.ok === false) return { status: "unavailable" };
    // Mutation outcomes include SA-069/050 query-field responses, which have no ok flag.
    if (record.ok !== undefined && record.ok !== true) return { status: "unavailable" };
    return { status: "ok", data: record };
  } catch {
    return { status: "unavailable" };
  }
}

/** Whitelist CURRENT redirect query keys; this also prevents untrusted arbitrary destinations. */
export function mutationResultQuery(data: Record<string, unknown>): string {
  const keys = [
    "backfill_kind", "backfill_cursor", "backfill_scanned", "backfill_enqueued",
    "backfill_done", "backfill_error", "backfill_state_persisted", "visibility_repair",
  ];
  const query = new URLSearchParams();
  for (const key of keys) {
    if (typeof data[key] === "string") query.set(key, data[key] as string);
  }
  return query.toString();
}
