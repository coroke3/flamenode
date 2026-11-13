/**
 * MIG-0802 U03a: Next-independent /auth/complete resolution contract.
 * Non-production synthetic PoC only; not imported into apps/api/src/app.ts.
 *
 * This intentionally mirrors CURRENT resolveAuthCompleteSession retry timings,
 * distinguishing missing from failed session reads without leaking exceptions.
 */
import { sanitizePostAuthReturnTo } from "./returnTo.ts";

export const AUTH_COMPLETE_RETRY_DELAYS_MS = [80, 160, 320] as const;

export type CompleteSession = {
  user?: { id?: string | null; is_banned?: number | null } | null;
};

export type CompleteResolution<T extends CompleteSession> =
  | { kind: "authenticated"; session: T; attempts: number }
  | { kind: "missing" | "unavailable"; attempts: number };

export type CompleteWait = (milliseconds: number) => Promise<void>;

const defaultWait: CompleteWait = (ms) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Auth.js session lookup uses only a validated configured origin, never Host. */
export async function resolveUnmountedAuthCompleteSession<T extends CompleteSession>(
  loadSession: () => Promise<T | null>,
  wait: CompleteWait = defaultWait,
): Promise<CompleteResolution<T>> {
  let sawError = false;
  const maxAttempts = AUTH_COMPLETE_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const session = await loadSession();
      if (session?.user?.id) {
        return { kind: "authenticated", session, attempts: attempt + 1 };
      }
    } catch {
      sawError = true;
    }
    const delay = AUTH_COMPLETE_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) await wait(delay);
  }
  return { kind: sawError ? "unavailable" : "missing", attempts: maxAttempts };
}

/**
 * Preserve CURRENT's destination decisions:
 * - read error => retryable error landing
 * - missing login => /entry
 * - banned user => AccessDenied
 * - valid session => safe relative next, never an absolute or auth-loop URL.
 * No redirect target is taken from Host, callbackUrl or an OAuth provider.
 */
export function unmountedAuthCompleteDestination(
  result: CompleteResolution<CompleteSession>,
  next: string | null | undefined,
): string {
  // Narrow the authenticated variant explicitly before accessing its session.
  // The non-authenticated variant combines two kind literals in one union arm.
  if (result.kind === "authenticated") {
    if (result.session.user?.is_banned === 1) return "/entry?error=AccessDenied";
    return sanitizePostAuthReturnTo(next, "/dashboard");
  }
  return result.kind === "unavailable"
    ? "/entry?error=auth_temporarily_unavailable"
    : "/entry";
}
