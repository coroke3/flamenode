import { sanitizeNextPath } from "@/lib/utils/next";

const AUTH_COMPLETE_PATH = "/auth/complete";
const BLOCKED_PREFIXES = [
  "/api/auth",
  "/auth/complete",
] as const;

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
