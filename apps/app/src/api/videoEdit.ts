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
type EditReadScope = { videoId: string; mode: PrivilegeMode; signal: AbortSignal };
type OptionsPage = Extract<EditFormOptionsResponse, { kind: "ready" }>;
type TraversedFormOptions = OptionsPage & { truncated: false; nextOffset: null; customAnswersTruncated: false };
type CustomAnswer = OptionsPage["customAnswers"][string];

export type VideoEditResult<T> = ApiResult<T> | { status: "not_found" };

export interface VideoEditApi {
  getPage(videoId: string, mode: PrivilegeMode, signal: AbortSignal): Promise<VideoEditResult<EditPageResponse>>;
  getFormOptions(videoId: string, mode: PrivilegeMode, signal: AbortSignal): Promise<VideoEditResult<TraversedFormOptions>>;
}

const UNAVAILABLE = { status: "unavailable" } as const;
// Mirrors the edit endpoint's offset clamp and accepting-row page size in entry/rows.ts.
const MAX_FORM_OPTIONS_OFFSET = 900;
const FORM_OPTIONS_PAGE_ROWS = 100;

async function read<T>(
  fetchFn: FetchLike,
  request: EditReadScope & { formOptionsOffset?: number },
  parse: (value: unknown) => { success: true; data: T } | { success: false },
): Promise<VideoEditResult<T>> {
  const { videoId, mode, formOptionsOffset, signal } = request;
  // encodeURIComponent leaves dot segments intact, so the browser would resolve those outside the video route.
  if (signal.aborted || !videoId || videoId === "." || videoId === "..") return UNAVAILABLE;
  try {
    const query = new URLSearchParams();
    if (mode !== "normal") query.set("privileged", mode);
    // Omitting offset on the first options request is the canonical offset 0.
    if (formOptionsOffset !== undefined && formOptionsOffset > 0) query.set("offset", String(formOptionsOffset));
    const suffix = formOptionsOffset === undefined ? "" : "/form-options";
    const search = query.size > 0 ? `?${query}` : "";
    const response = await fetchFn(`/api/personal/edit/${encodeURIComponent(videoId)}${suffix}${search}`, {
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

function sameAnswer(previous: CustomAnswer, next: CustomAnswer): boolean {
  if (typeof previous === "string" || typeof next === "string") return previous === next;
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}

// Keep cursor validation and accumulation together so only a complete traversal can publish options.
async function readFormOptions(fetchFn: FetchLike, scope: EditReadScope): Promise<VideoEditResult<TraversedFormOptions>> {
  const eventOptions = new Map<string, OptionsPage["eventOptions"][number]>();
  const customAnswers = new Map<string, CustomAnswer>();
  let firstPage: OptionsPage | undefined;
  let offset = 0;

  while (!scope.signal.aborted) {
    const result = await read(fetchFn, { ...scope, formOptionsOffset: offset }, EditFormOptionsResponseSchema.safeParse);
    if (scope.signal.aborted) return UNAVAILABLE;
    if (result.status !== "ok") return result;
    const page = result.data;
    if (page.kind !== "ready" || page.customAnswersTruncated) return UNAVAILABLE;

    firstPage ??= page;
    for (const event of page.eventOptions) {
      if (eventOptions.has(event.id)) return UNAVAILABLE;
      eventOptions.set(event.id, event);
    }
    for (const [key, answer] of Object.entries(page.customAnswers)) {
      const previous = customAnswers.get(key);
      if (previous !== undefined && !sameAnswer(previous, answer)) return UNAVAILABLE;
      customAnswers.set(key, answer);
    }

    const { nextOffset, truncated } = page;
    if (!truncated && nextOffset === null) {
      return {
        status: "ok",
        data: {
          ...firstPage,
          eventOptions: [...eventOptions.values()],
          customAnswers: Object.fromEntries(customAnswers),
          customAnswersTruncated: false,
          truncated: false,
          nextOffset: null,
        },
      };
    }
    if (!truncated || nextOffset === null || !Number.isSafeInteger(nextOffset) ||
        nextOffset <= offset || nextOffset > MAX_FORM_OPTIONS_OFFSET ||
        nextOffset - offset > FORM_OPTIONS_PAGE_ROWS) return UNAVAILABLE;
    offset = nextOffset;
  }
  return UNAVAILABLE;
}

export function createVideoEditApi(fetchFn: FetchLike = (input, init) => fetch(input, init)): VideoEditApi {
  return {
    getPage: (videoId, mode, signal) =>
      read(fetchFn, { videoId, mode, signal }, EditPageResponseSchema.safeParse),
    getFormOptions: (videoId, mode, signal) => readFormOptions(fetchFn, { videoId, mode, signal }),
  };
}
