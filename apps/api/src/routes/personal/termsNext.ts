/**
 * MIG-0641 U01b: exact CURRENT sanitizeNextPath semantics for SA-075.
 * This module is only a pure boundary helper until the guarded Hono route
 * (origin, session, banned, CostGuard, atomic audit) is implemented.
 */
const MAX_NEXT_PATH_LEN = 512;

export function sanitizeTermsNextPath(next: string | null | undefined): string {
  const fallback = "/dashboard";
  if (!next) return fallback;
  const trimmed = next.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    trimmed.includes("://") ||
    trimmed.length > MAX_NEXT_PATH_LEN ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) return fallback;
  return trimmed;
}
