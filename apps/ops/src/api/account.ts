/** MIG-0707 U02 (RH-001): read-only summary used as a navigation hint, never server authorization. */
export type Summary = {
  loggedIn: true;
  role: "admin" | "user" | "moderator";
  canAccessAdmin: boolean;
  canAccessManage: boolean;
  degraded?: true;
  degradedReason?: "pending_requests_unavailable" | "management_access_unavailable";
};
export type SummaryResult =
  | { status: "ok"; summary: Summary }
  | { status: "anonymous" }
  | { status: "unavailable" };
export type NavigationResult = "allow" | "anonymous" | "deny" | "unavailable";
export interface OpsApi {
  getSummary(signal?: AbortSignal): Promise<SummaryResult>;
  checkManageNavigation(signal?: AbortSignal): Promise<NavigationResult>;
}
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 5_000;
function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function parseAccountSummary(value: unknown): SummaryResult {
  if (!isRecord(value)) return { status: "unavailable" };
  if (value.loggedIn === false) {
    return value.unavailable === true ? { status: "unavailable" } : { status: "anonymous" };
  }
  if (value.loggedIn !== true ||
      (value.role !== "admin" && value.role !== "user" && value.role !== "moderator") ||
      typeof value.canAccessAdmin !== "boolean" ||
      typeof value.canAccessManage !== "boolean") {
    return { status: "unavailable" };
  }
  // Unknown degradedReason is deliberately not trusted; guard fails closed.
  return { status: "ok", summary: {
    loggedIn: true,
    role: value.role,
    canAccessAdmin: value.canAccessAdmin,
    canAccessManage: value.canAccessManage,
    ...(value.degraded === true ? { degraded: true as const } : {}),
    ...(value.degradedReason === "pending_requests_unavailable" ||
        value.degradedReason === "management_access_unavailable"
      ? { degradedReason: value.degradedReason } : {}),
  } };
}
export function createOpsApi(fetchFn: FetchLike = (input, init) => fetch(input, init)): OpsApi {
  async function get(path: string, signal?: AbortSignal): Promise<Response> {
    return fetchFn(path, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: requestSignal(signal),
    });
  }
  return {
    async getSummary(signal) {
      try {
        const response = await get("/api/account/summary", signal);
        if (response.status !== 200) return { status: "unavailable" };
        return parseAccountSummary(await response.json());
      } catch {
        return { status: "unavailable" };
      }
    },
    async checkManageNavigation(signal) {
      try {
        const response = await get("/api/manage/navigation", signal);
        if (response.status === 401) return "anonymous";
        if (response.status === 403) {
          const body: unknown = await response.json();
          return isRecord(body) && body.reason === "manage_access_required" ? "deny" : "unavailable";
        }
        if (response.status !== 200) return "unavailable";
        const body: unknown = await response.json();
        if (!isRecord(body) || !isRecord(body.access)) return "unavailable";
        return body.access.canAccessAdmin === true || body.access.canAccessManage === true
          ? "allow" : "unavailable";
      } catch {
        return "unavailable";
      }
    },
  };
}
