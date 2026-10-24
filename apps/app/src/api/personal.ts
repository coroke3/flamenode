/**
 * Read client for the Personal SPA (MIG-0701). Calls only the MIG-0611 read endpoints
 * (GET /api/personal/*, `Cache-Control: private, no-store`); never writes (mutations are MIG-0702).
 *
 * Status mapping (apps/api requireAuth + personalRoutes.onError):
 *   200 -> ok(body)   401 -> anonymous   403 -> banned   anything else / network / bad JSON -> unavailable
 * "unavailable" must never be shown as logout or as a role change (UX-AUTH-005).
 */
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
  getSession(signal?: AbortSignal): Promise<SessionResult>;
  getDashboard(signal?: AbortSignal): Promise<ApiResult<DashboardResponse>>;
  getLibrary(query: LibraryQuery, signal?: AbortSignal): Promise<ApiResult<LibraryResponse>>;
  getSettings(query: SettingsQuery, signal?: AbortSignal): Promise<ApiResult<SettingsResponse>>;
  getOnboarding(signal?: AbortSignal): Promise<ApiResult<OnboardingResponse>>;
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
    async getSession(signal) {
      const r = await read<PersonalSessionResponse>(fetchFn, url("session"), signal);
      return r.status === "ok" ? { status: "ok", user: r.data.user } : r;
    },
    getDashboard: (signal) => read(fetchFn, url("dashboard"), signal),
    getLibrary: (q, signal) => read(fetchFn, url("library", { tab: q.tab, page: q.page }), signal),
    getSettings: (q, signal) =>
      read(fetchFn, url("settings", { tab: q.tab, x: q.x, onboarding: q.onboarding }), signal),
    getOnboarding: (signal) => read(fetchFn, url("onboarding"), signal),
  };
}
