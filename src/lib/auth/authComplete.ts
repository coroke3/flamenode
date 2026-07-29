import { sanitizeNextPath } from "#utils/next";

const AUTH_COMPLETE_PATH = "/auth/complete";
const BLOCKED_PREFIXES = [
  "/api/auth",
  "/auth/complete",
] as const;

/** callback直後にsession読取が一時的にnull/失敗となる場合だけを吸収する。 */
export const AUTH_COMPLETE_SESSION_RETRY_DELAYS_MS = [
  80,
  160,
  320,
] as const;

type AuthCompleteSessionLike = {
  user?: {
    id?: string | null;
  } | null;
};

export type AuthCompleteSessionResolution<TSession> =
  | {
      kind: "authenticated";
      session: TSession;
      attempts: number;
    }
  | {
      kind: "missing" | "unavailable";
      attempts: number;
    };

function waitForRetry(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OAuth callbackはsession作成後に別requestの /auth/complete へ遷移する。
 * 直後の一時的なnull/例外を画面エラーへ変換せず、読取だけを短時間再試行する。
 */
export async function resolveAuthCompleteSession<
  TSession extends AuthCompleteSessionLike,
>(
  loadSession: () => Promise<TSession | null>,
  wait: (ms: number) => Promise<void> = waitForRetry,
): Promise<AuthCompleteSessionResolution<TSession>> {
  let sawError = false;
  const maxAttempts = AUTH_COMPLETE_SESSION_RETRY_DELAYS_MS.length + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const session = await loadSession();
      if (session?.user?.id) {
        return {
          kind: "authenticated",
          session,
          attempts: attempt + 1,
        };
      }
    } catch {
      sawError = true;
    }

    const retryDelay = AUTH_COMPLETE_SESSION_RETRY_DELAYS_MS[attempt];
    if (retryDelay != null) await wait(retryDelay);
  }

  return {
    kind: sawError ? "unavailable" : "missing",
    attempts: maxAttempts,
  };
}

/**
 * OAuth callback直後の軽量ランディングへ誘導する。
 * `next` は同一サイト相対パスだけを許可し、循環・callback自身を拒否する。
 */
export function buildAuthCompleteHref(next?: string | null): string {
  const safeNext = sanitizeAuthCompleteNext(next);
  return `${AUTH_COMPLETE_PATH}?next=${encodeURIComponent(safeNext)}`;
}

export function sanitizeAuthCompleteNext(
  next?: string | null,
  fallback = "/onboarding",
): string {
  const candidate = sanitizeNextPath(next, fallback);
  const pathOnly = candidate.split(/[?#]/, 1)[0] || "/";
  if (
    pathOnly === AUTH_COMPLETE_PATH ||
    pathOnly.startsWith(`${AUTH_COMPLETE_PATH}/`)
  ) {
    return fallback;
  }
  for (const prefix of BLOCKED_PREFIXES) {
    if (pathOnly === prefix || pathOnly.startsWith(`${prefix}/`)) {
      return fallback;
    }
  }
  return candidate;
}

export function entryLoginRedirectTo(next?: string | null): string {
  const safeNext = sanitizeNextPath(next, "/entry");
  return buildAuthCompleteHref(safeNext);
}
