// MIG-0734 U03: cancel body via AdminNotificationCancelBodySchema (SA-046); retry/force-resend/retry-failed have no body schema on main (SA-045/047/048 take no body).
// Reads use D-17-2 getJson, writes use D-17-3 send (see adminCostGuard.ts).
import {
  AdminNotificationCancelBodySchema, AdminNotificationsResponseSchema, type AdminNotificationsResponse,
} from "@flamenode/contracts";
import { postAdminBody, type AdminWriteResult } from "./adminCostGuard.js";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";

export type NotificationFilters = { status: string; cat: string; type: string; event: string; q: string };

/** Query for GET /api/admin-read/ops/notifications (status=failed is expanded to the terminal set by the API). */
export function notificationQuery(filters: NotificationFilters): string {
  const params = new URLSearchParams();
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.cat && filters.cat !== "all") params.set("cat", filters.cat);
  if (filters.type.trim()) params.set("type", filters.type.trim());
  if (filters.event.trim()) params.set("event", filters.event.trim());
  if (filters.q.trim()) params.set("q", filters.q.trim().slice(0, 100));
  return params.toString();
}

/** Page URL in CURRENT filterHref order (status, type, event, q, cat). */
export function notificationFilterHref(filters: NotificationFilters): string {
  const params = new URLSearchParams();
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.type) params.set("type", filters.type);
  if (filters.event) params.set("event", filters.event);
  if (filters.q) params.set("q", filters.q);
  if (filters.cat !== "all") params.set("cat", filters.cat);
  const query = params.toString();
  return query ? "/admin/notifications?" + query : "/admin/notifications";
}

export async function fetchAdminNotifications(
  fetchFn: OpsFetch, filters: NotificationFilters, signal?: AbortSignal,
): Promise<OpsResult<AdminNotificationsResponse>> {
  const query = notificationQuery(filters);
  const result = await getJson<unknown>(
    fetchFn, "/api/admin-read/ops/notifications" + (query ? "?" + query : ""), signal,
  );
  if (result.status !== "ok") return result;
  const parsed = AdminNotificationsResponseSchema.safeParse(result.data);
  return parsed.success ? { status: "ok", data: parsed.data } : { status: "unavailable" };
}

export function createAdminNotificationsApi(fetchFn: OpsFetch = (url, init) => fetch(url, init)) {
  const path = (id: string, action: "retry" | "cancel" | "force-resend"): string | null => {
    // Never silently retarget a privileged action: Hono trims IDs, so a row ID
    // with surrounding whitespace could mutate a different notification.
    if (typeof id !== "string") return null;
    const normalized = id.trim();
    // encodeURIComponent leaves "." and ".." unchanged; URL normalization would
    // reroute a privileged POST outside /notifications/:id/:action.
    if (id !== normalized || !normalized || normalized.length > 128 ||
        normalized === "." || normalized === "..") return null;
    try {
      return "/api/admin/notifications/" + encodeURIComponent(normalized) + "/" + action;
    } catch {
      // A lone UTF-16 surrogate is not a valid URI component.
      return null;
    }
  };
  const postId = (id: string, action: "retry" | "cancel" | "force-resend", reason?: string): Promise<AdminWriteResult> => {
    const target = path(id, action);
    if (target === null) return Promise.resolve({ ok: false, message: "idが不正です。" });
    return action === "cancel"
      ? postAdminBody(fetchFn, target, AdminNotificationCancelBodySchema, { reason: reason ?? "" })
      : postAdminBody(fetchFn, target, null);
  };
  return {
    list: (filters: NotificationFilters, signal?: AbortSignal) => fetchAdminNotifications(fetchFn, filters, signal),
    retry: (id: string) => postId(id, "retry"),
    cancel: (id: string, reason: string) => postId(id, "cancel", reason),
    forceResend: (id: string) => postId(id, "force-resend"),
    retryFailed: () => postAdminBody(fetchFn, "/api/admin/notifications/retry-failed", null),
  };
}
export type AdminNotificationsApi = ReturnType<typeof createAdminNotificationsApi>;
