// MIG-0734 U03: cancel body via AdminNotificationCancelBodySchema (SA-046); retry/force-resend/retry-failed have no body schema on main (SA-045/047/048 take no body).
// Reads use D-17-2 getJson, writes use D-17-3 send (see adminCostGuard.ts).
import {
  AdminNotificationCancelBodySchema, AdminNotificationsResponseSchema, type AdminNotificationsResponse,
} from "@flamenode/contracts";
import { toWriteResult, type AdminOpsBody, type AdminWriteResult } from "./adminCostGuard.js";
import { getJson, type OpsFetch, type OpsResult } from "./read.js";
import { send } from "./write.js";

/** Keep CURRENT's 100 UTF-16-unit limit without emitting an orphan surrogate. */
export function truncateNotificationSearch(value: string): string {
  const clipped = value.trim().slice(0, 100);
  return /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped;
}

export type NotificationFilters = { status: string; cat: string; type: string; event: string; q: string };

/** Query for GET /api/admin-read/ops/notifications (status=failed is expanded to the terminal set by the API). */
export function notificationQuery(filters: NotificationFilters): string {
  const params = new URLSearchParams();
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.cat && filters.cat !== "all") params.set("cat", filters.cat);
  if (filters.type.trim()) params.set("type", filters.type.trim());
  if (filters.event.trim()) params.set("event", filters.event.trim());
  const q = truncateNotificationSearch(filters.q);
  if (q) params.set("q", q);
  return params.toString();
}

/** Page URL in CURRENT filterHref order (status, type, event, q, cat). */
export function notificationFilterHref(filters: NotificationFilters): string {
  const params = new URLSearchParams();
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.type) params.set("type", filters.type);
  if (filters.event) params.set("event", filters.event);
  const q = truncateNotificationSearch(filters.q);
  if (q) params.set("q", q);
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

/** A write-side 403 whose optional body failed is not proof of role loss.
 * The privileged page must unmount and revalidate the read before displaying
 * existing private notification payloads or allowing another mutation.
 */
export type NotificationWriteResult = AdminWriteResult & {
  forbidden?: boolean;
  verifyAccess?: boolean;
};

const FORBIDDEN_BODY_LIMIT_MS = 250;

async function postNotificationBody(
  fetchFn: OpsFetch, path: string, raw?: object,
): Promise<NotificationWriteResult> {
  let status: number | null = null;
  const trackedFetch: OpsFetch = async (url, init) => {
    const response = await fetchFn(url, init);
    status = response.status;
    if (status !== 403) return response;
    // send() needs only status, ok and json(). Wrap the *optional* 403 body,
    // not the shared transport, so non-auth guard responses retain D-17-3
    // semantics and a stalled 403 cannot keep private controls indefinitely.
    return {
      status: response.status,
      ok: response.ok,
      async json() {
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            response.json(),
            new Promise<never>((_, reject) => {
              deadline = setTimeout(() => reject(new Error("notification_403_body_deadline")), FORBIDDEN_BODY_LIMIT_MS);
            }),
          ]);
        } finally {
          if (deadline !== undefined) clearTimeout(deadline);
        }
      },
    } as Response;
  };
  const result = await send<AdminOpsBody>(trackedFetch, "POST", path, raw);
  if (status === 403) {
    // Distinguish an authoritative identity-denial body from ordinary
    // maintenance/origin/Cost Guard 403 errors. Never infer a redirect from
    // raw provider strings or from HTTP status alone.
    if (result.status !== "ok") {
      return { ok: false, message: "権限を再確認しています。", verifyAccess: true };
    }
    if (!result.data.ok && (result.data.reason === "forbidden" || result.data.reason === "banned")) {
      return {
        ok: false,
        message: typeof result.data.message === "string" ? result.data.message : "この操作を実行する権限がありません。",
        forbidden: true,
      };
    }
  }
  const converted = toWriteResult(result) as NotificationWriteResult;
  // The shared Cost Guard mapper may later classify reasons from HTTP bodies;
  // notification revocation still requires an actual authoritative 403.
  if (status !== 403 && converted.forbidden) {
    const { forbidden: _ignored, ...remaining } = converted;
    return remaining;
  }
  return converted;
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
  const postId = (id: string, action: "retry" | "cancel" | "force-resend", reason?: string): Promise<NotificationWriteResult> => {
    const target = path(id, action);
    if (target === null) return Promise.resolve({ ok: false, message: "idが不正です。" });
    if (action === "cancel") {
      const checked = AdminNotificationCancelBodySchema.safeParse({ reason: reason ?? "" });
      if (!checked.success) return Promise.resolve({ ok: false, message: "入力内容が不正です。" });
      return postNotificationBody(fetchFn, target, checked.data);
    }
    return postNotificationBody(fetchFn, target);
  };
  return {
    list: (filters: NotificationFilters, signal?: AbortSignal) => fetchAdminNotifications(fetchFn, filters, signal),
    retry: (id: string) => postId(id, "retry"),
    cancel: (id: string, reason: string) => postId(id, "cancel", reason),
    forceResend: (id: string) => postId(id, "force-resend"),
    retryFailed: () => postNotificationBody(fetchFn, "/api/admin/notifications/retry-failed"),
  };
}
export type AdminNotificationsApi = ReturnType<typeof createAdminNotificationsApi>;
