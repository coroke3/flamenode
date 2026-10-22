// Port of CURRENT src/lib/utils/next.ts + sanitizeAuthCompleteNext (src/lib/auth/authComplete.ts).
const MAX_NEXT_PATH_LEN = 512;
const BLOCKED_PREFIXES = ["/api/auth", "/auth/complete", "/onboarding", "/rules"] as const;

export function isSafeRelativePath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.includes("\\") || path.includes("://")) return false;
  if (path.length > MAX_NEXT_PATH_LEN) return false;
  return !/[\u0000-\u001f\u007f]/.test(path);
}

export function sanitizeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next) return fallback;
  const trimmed = next.trim();
  return isSafeRelativePath(trimmed) ? trimmed : fallback;
}

/** CURRENT sanitizeOnboardingNext: also rejects auth/onboarding/rules loops. */
export function sanitizeOnboardingNext(next?: string | null, fallback = "/dashboard"): string {
  const candidate = sanitizeNextPath(next, fallback);
  const pathOnly = candidate.split(/[?#]/, 1)[0] || "/";
  for (const prefix of BLOCKED_PREFIXES) {
    if (pathOnly === prefix || pathOnly.startsWith(`${prefix}/`)) return fallback;
  }
  return candidate;
}

export function onboardingHref(next?: string): string {
  return `/onboarding?next=${encodeURIComponent(sanitizeOnboardingNext(next))}`;
}

export function entryLoginHref(next?: string): string {
  return `/entry?next=${encodeURIComponent(sanitizeNextPath(next, "/dashboard"))}`;
}

/** CURRENT dashboard/youtube-playlists/page.tsx: admin -> admin SPA, everyone else -> /dashboard. */
export function youtubePlaylistsTarget(role: "user" | "admin" | "moderator"): string {
  return role === "admin" ? "/admin/youtube-sync/playlists" : "/dashboard";
}
