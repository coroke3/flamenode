/**
 * Personal SPA read client (MIG-0701) with separate typed X ID mutation adapters.
 * GET /api/personal/* remains private/no-store; mutations are explicit Hono calls.
 *
 * Status mapping (apps/api requireAuth + personalRoutes.onError):
 *   200 -> ok(body)   401 -> anonymous   403 -> banned   anything else / network / bad JSON -> unavailable
 * MIG-0716 slotted only: canonical 404 -> not_found; other reads retain the mapping above.
 * "unavailable" must never be shown as logout or as a role change (UX-AUTH-005).
 */
import {
  EntryIndexResponseSchema, SlottedEntryResponseSchema, UnslottedEntryResponseSchema,
  type EntryIndexResponse, type SlottedEntryResponse, type UnslottedEntryResponse,
} from "@flamenode/contracts";
import { createXidRequestsApi, type XidRequestsApi } from "./xidRequests.js";
import { createXidProfileApi, type XidProfileApi } from "./xidProfile.js";
import type {
  DashboardResponse,
  LibraryResponse,
  OnboardingResponse,
  PersonalSessionResponse,
  PersonalUser,
  SettingsResponse,
} from "@flamenode/contracts";

export type ApiResult<T> =
  | { status: "ok"; data: T }
  | { status: "anonymous" }
  | { status: "banned" }
  | { status: "unavailable" };

export type SessionResult =
  | { status: "ok"; user: PersonalUser }
  | { status: "anonymous" }
  | { status: "banned" }
  | { status: "unavailable" };

export type SessionState = { status: "loading" } | SessionResult;

/** Raw query values from the page URL; the API parses/clamps them exactly like CURRENT. */
export interface LibraryQuery {
  tab?: string | null;
  page?: string | null;
}
export interface SettingsQuery {
  tab?: string | null;
  x?: string | null;
  onboarding?: string | null;
}

export interface PersonalApi {
  /** Optional for migration-only read fixtures; production always supplies this adapter. */
  xidRequests?: XidRequestsApi;
  /** Optional for legacy read-only fixtures; production supplies Hono X ID writes. */
  xidProfile?: XidProfileApi;
  getSession(signal?: AbortSignal): Promise<SessionResult>;
  getDashboard(signal?: AbortSignal): Promise<ApiResult<DashboardResponse>>;
  getLibrary(query: LibraryQuery, signal?: AbortSignal): Promise<ApiResult<LibraryResponse>>;
  getSettings(query: SettingsQuery, signal?: AbortSignal): Promise<ApiResult<SettingsResponse>>;
  getOnboarding(signal?: AbortSignal): Promise<ApiResult<OnboardingResponse>>;
  getEntryIndex(signal?: AbortSignal, offset?: number): Promise<ApiResult<EntryIndexResponse>>;
  /** Initial responses only; continuation and trusted host ownership belong to MIG-0716 U01b. */
  getSlottedEntry(slot: string, signal?: AbortSignal): Promise<ApiResult<SlottedEntryResponse> | { status: "not_found" }>;
  getUnslottedEntry(eventQuery: string, signal?: AbortSignal): Promise<ApiResult<UnslottedEntryResponse>>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function url(path: string, params: Record<string, string | null | undefined> = {}): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") qs.set(key, value);
  }
  const query = qs.toString();
  return query ? `/api/personal/${path}?${query}` : `/api/personal/${path}`;
}

async function read<T>(fetchFn: FetchLike, target: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetchFn(target, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
  } catch {
    return { status: "unavailable" };
  }
  if (res.status === 401) return { status: "anonymous" };
  if (res.status === 403) return { status: "banned" };
  if (res.status !== 200) return { status: "unavailable" };
  try {
    return { status: "ok", data: (await res.json()) as T };
  } catch {
    return { status: "unavailable" };
  }
}

export function createPersonalApi(fetchFn: FetchLike = (input, init) => fetch(input, init)): PersonalApi {
  return {
    xidRequests: createXidRequestsApi(fetchFn),
    xidProfile: createXidProfileApi(fetchFn),
    async getSession(signal) {
      const r = await read<PersonalSessionResponse>(fetchFn, url("session"), signal);
      return r.status === "ok" ? { status: "ok", user: r.data.user } : r;
    },
    getDashboard: (signal) => read(fetchFn, url("dashboard"), signal),
    getLibrary: (q, signal) => read(fetchFn, url("library", { tab: q.tab, page: q.page }), signal),
    getSettings: (q, signal) =>
      read(fetchFn, url("settings", { tab: q.tab, x: q.x, onboarding: q.onboarding }), signal),
    getOnboarding: (signal) => read(fetchFn, url("onboarding"), signal),
    async getSlottedEntry(slot, signal) {
      let response: Response;
      try {
        response = await fetchFn(url("entry/slotted", { slot }), {
          method: "GET", credentials: "same-origin", cache: "no-store",
          headers: { accept: "application/json" }, signal,
        });
      } catch {
        return { status: "unavailable" };
      }
      if (response.status === 401) return { status: "anonymous" };
      if (response.status === 403) return { status: "banned" };
      if (response.status !== 200 && response.status !== 404) return { status: "unavailable" };
      try {
        const body: unknown = await response.json();
        if (response.status === 404) {
          return body !== null && typeof body === "object" && "error" in body && body.error === "not_found"
            ? { status: "not_found" } : { status: "unavailable" };
        }
        const parsed = SlottedEntryResponseSchema.safeParse(body);
        return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
      } catch {
        return { status: "unavailable" };
      }
    },
    async getUnslottedEntry(eventQuery, signal) {
      const result = await read<unknown>(fetchFn, url("entry/unslotted", { event_q: eventQuery }), signal);
      if (result.status !== "ok") return result;
      const parsed = UnslottedEntryResponseSchema.safeParse(result.data);
      return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
    },
    async getEntryIndex(signal, offset) {
      const result = await read<unknown>(fetchFn, url("entry", { offset: offset == null ? undefined : String(offset) }), signal);
      if (result.status !== "ok") return result;
      // Do not let a malformed or partial read look like a valid entry state.
      const parsed = EntryIndexResponseSchema.safeParse(result.data);
      return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
    },
  };
}
