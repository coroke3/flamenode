/** MIG-0802 U04: port CURRENT src/lib/utils/next.ts redirect target semantics without Next imports. */
const MAX_NEXT_PATH_LEN = 512;
const BLOCKED_AUTH_PATHS = ["/api/auth", "/auth/complete", "/onboarding", "/rules"] as const;

export function sanitizeAuthReturnTo(value: string | null | undefined, fallback="/dashboard"): string {
  if (!value) return fallback;
  const path=value.trim();
  if (!path.startsWith("/") || path.startsWith("//") ||
      path.includes("\\") || path.includes("://") ||
      path.length > MAX_NEXT_PATH_LEN || /[\u0000-\u001f\u007f]/.test(path)) return fallback;
  return path;
}

/** CURRENT authComplete redirect: prevent loops into Auth.js and onboarding. */
export function sanitizePostAuthReturnTo(value: string | null | undefined, fallback="/dashboard"): string {
  const candidate=sanitizeAuthReturnTo(value,fallback);
  const path=candidate.split(/[?#]/,1)[0]||"/";
  return BLOCKED_AUTH_PATHS.some(prefix=>path===prefix||path.startsWith(prefix+"/"))
    ? fallback : candidate;
}

export function authCompleteHref(next: string | null | undefined): string {
  return "/auth/complete?next="+encodeURIComponent(sanitizePostAuthReturnTo(next));
}

/** Equivalent to CURRENT entryLoginRedirectTo: fallback /entry when no explicit next. */
export function entryAuthRedirectHref(next: string | null | undefined): string {
  return authCompleteHref(sanitizeAuthReturnTo(next,"/entry"));
}
