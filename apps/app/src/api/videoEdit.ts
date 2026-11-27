import {
  EditFormOptionsResponseSchema,
  EditPageResponseSchema,
  type EditAccess,
  type EditFormOptionsResponse,
  type EditPageResponse,
} from "@flamenode/contracts";
import type { ApiResult } from "./personal.js";

type PrivilegeMode = EditAccess["privilegeMode"];
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type VideoEditResult<T> = ApiResult<T> | { status: "not_found" };

export interface VideoEditApi {
  getPage(videoId: string, mode: PrivilegeMode, signal: AbortSignal): Promise<VideoEditResult<EditPageResponse>>;
  getFormOptions(videoId: string, mode: PrivilegeMode, signal: AbortSignal): Promise<VideoEditResult<EditFormOptionsResponse>>;
}

const UNAVAILABLE = { status: "unavailable" } as const;

async function read<T>(
  fetchFn: FetchLike,
  request: { videoId: string; mode: PrivilegeMode; suffix: "" | "/form-options"; signal: AbortSignal },
  parse: (value: unknown) => { success: true; data: T } | { success: false },
): Promise<VideoEditResult<T>> {
  const { videoId, mode, suffix, signal } = request;
  // encodeURIComponent leaves dot segments intact, so the browser would resolve those outside the video route.
  if (signal.aborted || !videoId || videoId === "." || videoId === "..") return UNAVAILABLE;
  try {
    const query = mode === "normal" ? "" : `?privileged=${mode}`;
    const response = await fetchFn(`/api/personal/edit/${encodeURIComponent(videoId)}${suffix}${query}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
    if (signal.aborted) return UNAVAILABLE;
    if (response.status === 401) return { status: "anonymous" };
    if (response.status === 403) return { status: "banned" };
    if (response.status !== 200 && response.status !== 404) return UNAVAILABLE;
    const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (mime !== "application/json") return UNAVAILABLE;

    const raw: unknown = await response.json();
    if (signal.aborted) return UNAVAILABLE;
    if (response.status === 404) {
      return typeof raw === "object" && raw !== null && "error" in raw &&
        raw.error === "not_found" && Object.keys(raw).length === 1
        ? { status: "not_found" }
        : UNAVAILABLE;
    }
    const result = parse(raw);
    return result.success ? { status: "ok", data: result.data } : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

export function createVideoEditApi(fetchFn: FetchLike = (input, init) => fetch(input, init)): VideoEditApi {
  return {
    getPage: (videoId, mode, signal) =>
      read(fetchFn, { videoId, mode, suffix: "", signal }, EditPageResponseSchema.safeParse),
    getFormOptions: (videoId, mode, signal) =>
      read(fetchFn, { videoId, mode, suffix: "/form-options", signal }, EditFormOptionsResponseSchema.safeParse),
  };
}
