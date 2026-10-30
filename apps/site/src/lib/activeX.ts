// D-16-1 provisional: replace with @flamenode/contracts at merge
import { redirectForGuardReason } from "./guardRedirect.ts";

/** SA-098: preserve the CURRENT Server Action response fields until MIG-0636 is merged. */
export interface ActiveXSwitchResult {
  ok: boolean;
  message?: string;
  reason?: string;
}

const FAILURE_MESSAGE = "X ID の切り替えに失敗しました。";

function decodeResult(value: unknown): ActiveXSwitchResult | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (typeof result.ok !== "boolean") return null;
  return {
    ok: result.ok,
    ...(typeof result.message === "string" ? { message: result.message } : {}),
    ...(typeof result.reason === "string" ? { reason: result.reason } : {}),
  };
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
  let response: Response;
  try {
    response = await fetchImpl("/api/xid/active", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ x_user_id: xUserId }),
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
  if (reason) redirectForGuardReason(navigate, reason, currentPath());

  if (!payload) {
    return { ok: false, message: FAILURE_MESSAGE, ...(reason ? { reason } : {}) };
  }
  if (!response.ok || !payload.ok) {
    return { ok: false, message: payload.message ?? FAILURE_MESSAGE, ...(reason ? { reason } : {}) };
  }
  return payload;
}
