import { SetActiveXBodySchema, XIdWriteResultSchema, type XIdWriteResult } from "@flamenode/contracts";
import { redirectForGuardReason } from "./guardRedirect.ts";

/** MIG-0636 SA-098: use the same HTTP result contract as the Hono route. */
export type ActiveXSwitchResult = XIdWriteResult;

const FAILURE_MESSAGE = "X ID の切り替えに失敗しました。";

function decodeResult(value: unknown): ActiveXSwitchResult | null {
  const result = XIdWriteResultSchema.safeParse(value);
  return result.success ? result.data : null;
}

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search;
}

/**
 * Browser-only adapter for SA-098. Server authorizes X-ID ownership/approval;
 * AccountMenu owns optimistic state, cancellation, rollback and change events.
 *
 * Failed HTTP status with a valid {ok:false} body must keep its CURRENT message.
 * Missing/non-JSON responses fail closed; a 401 always redirects to login.
 */
export async function switchActiveX(
  xUserId: string,
  fetchImpl: typeof fetch = fetch,
  navigate: (path: string) => void = (path) => window.location.assign(path),
): Promise<ActiveXSwitchResult> {
  const body = SetActiveXBodySchema.safeParse({ x_user_id: xUserId });
  if (!body.success) return { ok: false, message: FAILURE_MESSAGE };
  let response: Response;
  try {
    response = await fetchImpl("/api/xid/active", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body.data),
    });
  } catch {
    return { ok: false, message: FAILURE_MESSAGE };
  }

  let payload: ActiveXSwitchResult | null = null;
  try {
    payload = decodeResult(await response.json());
  } catch {
    // A 401 can have no JSON body. Preserve the login guard instead of swallowing it.
  }

  const reason = response.status === 401 ? "unauthenticated" : payload?.reason;
  // Success and a guard denial are mutually exclusive. A malformed response
  // must never navigate to onboarding AND dispatch ACTIVE_X_CHANGED_EVENT.
  // Only an actual error response may carry a redirect reason.
  if (response.ok && payload?.ok && reason) {
    return { ok: false, message: FAILURE_MESSAGE };
  }
  if (reason) redirectForGuardReason(navigate, reason, currentPath());

  if (!payload) {
    return { ok: false, message: FAILURE_MESSAGE, ...(reason ? { reason } : {}) };
  }
  if (!response.ok || !payload.ok) {
    return { ok: false, message: payload.message ?? FAILURE_MESSAGE, ...(reason ? { reason } : {}) };
  }
  return payload;
}
