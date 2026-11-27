/**
 * MIG-0728 U01/U03: Admin event-group reads (admin-read) and SA-025..030
 * mutations backed by @flamenode/contracts.
 */
import { z } from "zod";
import {
  AdminEventGroupDetailResponseSchema,
  AdminEventGroupsResponseSchema,
  EventGroupMutationBodySchema,
  type AdminEventGroupDetailResponse,
  type AdminEventGroupsResponse,
} from "@flamenode/contracts";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";
import { send, type OpsWriteResult } from "./write.js";

const defaultFetch: OpsFetch = (path, init) => fetch(path, init);
const READ_BASE = "/api/admin-read/event-groups";
const WRITE_BASE = "/api/admin/event-groups";
const EVENT_GROUP_ADD_MAX = 80;
const MAX_GROUP_ID_LENGTH = 128;
const SEARCH_ERROR = "イベント候補の取得に失敗しました。もう一度お試しください。";
const WRITE_ERROR = "保存に失敗しました。再読み込みして、もう一度お試しください。";

const EventGroupOptionSchema = z.object({
  id: z.string(),
  title: z.string(),
  start_time: z.number().nullable(),
});

const EventGroupOptionsSuccessSchema = z.object({
  ok: z.literal(true),
  options: z.array(EventGroupOptionSchema),
  nextCursor: z.string().nullable(),
});

const EventGroupWriteResultSchema = z.object({
  ok: z.boolean(),
  id: z.string().optional(),
  message: z.string().optional(),
  added: z.number().int().nonnegative().optional(),
  pendingPublicReflection: z.boolean().optional(),
  reason: z.string().optional(),
});

export type EventGroupWriteResult = {
  ok: boolean;
  id?: string;
  message?: string;
  added?: number;
  pendingPublicReflection?: boolean;
  anonymous?: boolean;
};

export type EventGroupOptionsResult =
  | { ok: true; options: z.infer<typeof EventGroupOptionSchema>[]; nextCursor: string | null }
  | { ok: false; message: string; anonymous?: boolean; aborted?: boolean };

const GROUP_VISIBILITY_FILTERS = new Set(["public", "private", "archived"]);
const GROUP_TYPE_FILTERS = new Set(["series", "genre", "related", "collection", "other"]);

function isSafePathId(id: string): boolean {
  if (!id || id.trim() !== id || id === "." || id === ".." || id.length > MAX_GROUP_ID_LENGTH) {
    return false;
  }
  try {
    encodeURIComponent(id);
    return true;
  } catch {
    return false;
  }
}

export function eventGroupPublicHref(slug: string): string {
  return `/event#event-group-${slug}`;
}

/** CURRENT normalizes unknown visibility and type filters to "any". */
export function eventGroupsQuery(values: URLSearchParams): string {
  const next = new URLSearchParams();
  const visibility = values.get("visibility") ?? "";
  const type = values.get("type") ?? "";
  next.set("visibility", GROUP_VISIBILITY_FILTERS.has(visibility) ? visibility : "any");
  next.set("type", GROUP_TYPE_FILTERS.has(type) ? type : "any");
  return next.toString();
}

export async function readAdminEventGroups(
  values: URLSearchParams,
  fetchFn: OpsFetch = defaultFetch,
  signal?: AbortSignal,
): Promise<OpsResult<AdminEventGroupsResponse>> {
  const response = await getJson<unknown>(fetchFn, `${READ_BASE}?${eventGroupsQuery(values)}`, signal);
  if (response.status !== "ok") return response;
  const parsed = AdminEventGroupsResponseSchema.safeParse(response.data);
  return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
}

export async function readAdminEventGroupDetail(
  id: string,
  fetchFn: OpsFetch = defaultFetch,
  signal?: AbortSignal,
): Promise<OpsResult<AdminEventGroupDetailResponse>> {
  if (!isSafePathId(id)) return { status: "notFound" };
  const response = await getJson<unknown>(fetchFn, `${READ_BASE}/${encodeURIComponent(id)}`, signal);
  if (response.status !== "ok") return response;
  const parsed = AdminEventGroupDetailResponseSchema.safeParse(response.data);
  return parsed.success && parsed.data.group.id === id
    ? { status: "ok", data: parsed.data }
    : { status: "unavailable" };
}

export async function searchEventGroupEventOptions(
  input: { groupId: string; query?: string | null; cursor?: string | null },
  fetchFn: OpsFetch = defaultFetch,
  signal?: AbortSignal,
): Promise<EventGroupOptionsResult> {
  const groupId = typeof input.groupId === "string" ? input.groupId.trim() : "";
  if (!isSafePathId(groupId)) return { ok: false, message: SEARCH_ERROR };
  const query = typeof input.query === "string" ? input.query.trim() : "";
  const qs = new URLSearchParams({ groupId });
  if (query) qs.set("q", query);
  if (typeof input.cursor === "string" && input.cursor) qs.set("cursor", input.cursor);
  try {
    const response = await fetchFn(`${WRITE_BASE}/event-options?${qs.toString()}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
    if (signal?.aborted) return { ok: false, message: SEARCH_ERROR, aborted: true };
    if (response.status === 401) return { ok: false, message: "ログインしてください。", anonymous: true };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, message: SEARCH_ERROR };
    }
    if (signal?.aborted) return { ok: false, message: SEARCH_ERROR, aborted: true };
    if (response.status === 200) {
      const parsed = EventGroupOptionsSuccessSchema.safeParse(payload);
      if (parsed.success) {
        return { ok: true, options: parsed.data.options, nextCursor: parsed.data.nextCursor };
      }
    }
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>;
      if (record.ok === false && typeof record.message === "string" && record.message) {
        return { ok: false, message: record.message };
      }
    }
    return { ok: false, message: SEARCH_ERROR };
  } catch {
    if (signal?.aborted) return { ok: false, message: SEARCH_ERROR, aborted: true };
    return { ok: false, message: SEARCH_ERROR };
  }
}

function toGroupWriteResult(result: OpsWriteResult<z.infer<typeof EventGroupWriteResultSchema>>): EventGroupWriteResult {
  if (result.status === "anonymous") {
    return { ok: false, message: "ログインしてください。", anonymous: true };
  }
  if (result.status !== "ok") {
    return { ok: false, message: WRITE_ERROR };
  }
  const parsed = EventGroupWriteResultSchema.safeParse(result.data);
  if (!parsed.success) return { ok: false, message: WRITE_ERROR };
  const data = parsed.data;
  if (!data.ok && data.reason === "unauthenticated") {
    return { ok: false, message: data.message ?? "ログインしてください。", anonymous: true };
  }
  return {
    ok: data.ok,
    ...(typeof data.id === "string" ? { id: data.id } : {}),
    ...(typeof data.message === "string" ? { message: data.message } : {}),
    ...(typeof data.added === "number" ? { added: data.added } : {}),
    ...(typeof data.pendingPublicReflection === "boolean"
      ? { pendingPublicReflection: data.pendingPublicReflection }
      : {}),
  };
}

export async function createEventGroup(
  raw: Record<string, unknown>,
  fetchFn: OpsFetch = defaultFetch,
): Promise<EventGroupWriteResult> {
  const parsed = EventGroupMutationBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  return toGroupWriteResult(await send(fetchFn, "POST", WRITE_BASE, parsed.data));
}

export async function updateEventGroup(
  id: string,
  raw: Record<string, unknown>,
  fetchFn: OpsFetch = defaultFetch,
): Promise<EventGroupWriteResult> {
  if (!isSafePathId(id)) return { ok: false, message: "ID が必要です。" };
  const parsed = EventGroupMutationBodySchema.safeParse({ ...raw, id });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  return toGroupWriteResult(
    await send(fetchFn, "PATCH", `${WRITE_BASE}/${encodeURIComponent(id)}`, parsed.data),
  );
}

export async function deleteEventGroup(
  id: string,
  fetchFn: OpsFetch = defaultFetch,
): Promise<EventGroupWriteResult> {
  if (!isSafePathId(id)) return { ok: false, message: "ID が必要です。" };
  return toGroupWriteResult(
    await send(fetchFn, "DELETE", `${WRITE_BASE}/${encodeURIComponent(id)}`),
  );
}

export async function addEventsToGroup(
  input: { groupId: string; eventIds: readonly string[] },
  fetchFn: OpsFetch = defaultFetch,
): Promise<EventGroupWriteResult> {
  const groupId = typeof input.groupId === "string" ? input.groupId.trim() : "";
  if (!isSafePathId(groupId)) return { ok: false, message: "グループが見つかりません。" };
  const uniqueIds = new Set<string>();
  for (const rawId of Array.isArray(input.eventIds) ? input.eventIds : []) {
    if (typeof rawId !== "string") continue;
    const trimmed = rawId.trim();
    if (!trimmed) continue;
    uniqueIds.add(trimmed);
    if (uniqueIds.size > EVENT_GROUP_ADD_MAX) {
      return {
        ok: false,
        message: `一度に追加できるイベントは${EVENT_GROUP_ADD_MAX}件までです。分けて実行してください。`,
      };
    }
  }
  const eventIds = [...uniqueIds];
  if (eventIds.length === 0) {
    return { ok: false, message: "追加するイベントを選択してください。" };
  }
  return toGroupWriteResult(
    await send(fetchFn, "POST", `${WRITE_BASE}/${encodeURIComponent(groupId)}/events`, { eventIds }),
  );
}

export async function removeEventFromGroup(
  input: { groupId: string; eventId: string },
  fetchFn: OpsFetch = defaultFetch,
): Promise<EventGroupWriteResult> {
  const groupId = typeof input.groupId === "string" ? input.groupId.trim() : "";
  const eventId = typeof input.eventId === "string" ? input.eventId.trim() : "";
  if (!isSafePathId(groupId) || !isSafePathId(eventId)) {
    return { ok: false, message: "グループとイベントを指定してください。" };
  }
  return toGroupWriteResult(
    await send(
      fetchFn,
      "DELETE",
      `${WRITE_BASE}/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}`,
    ),
  );
}

export function createAdminEventGroupsApi(fetchFn: OpsFetch = defaultFetch) {
  return {
    readList: (values: URLSearchParams, signal?: AbortSignal) =>
      readAdminEventGroups(values, fetchFn, signal),
    readDetail: (id: string, signal?: AbortSignal) =>
      readAdminEventGroupDetail(id, fetchFn, signal),
    searchEventOptions: (
      input: { groupId: string; query?: string | null; cursor?: string | null },
      signal?: AbortSignal,
    ) => searchEventGroupEventOptions(input, fetchFn, signal),
    create: (raw: Record<string, unknown>) => createEventGroup(raw, fetchFn),
    update: (id: string, raw: Record<string, unknown>) => updateEventGroup(id, raw, fetchFn),
    deleteGroup: (id: string) => deleteEventGroup(id, fetchFn),
    addEvents: (input: { groupId: string; eventIds: readonly string[] }) =>
      addEventsToGroup(input, fetchFn),
    removeEvent: (input: { groupId: string; eventId: string }) =>
      removeEventFromGroup(input, fetchFn),
  };
}

export type AdminEventGroupsApi = ReturnType<typeof createAdminEventGroupsApi>;
