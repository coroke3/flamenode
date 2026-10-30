/**
 * MIG-0519 U01: provisional SA-075 JSON transport until MIG-0641 merges its Zod contract.
 * This endpoint is NOT mounted in the current Hono API yet. Do not cut over /rules.
 */
import { sanitizeNextPath } from "../../../../src/lib/utils/next.ts";

export type TermsAcceptResponse =
  | { ok: true; next: string }
  | { ok: false; next?: string; message?: string; reason?: string };

export async function acceptLatestTerms(
  next: string,
  fetcher: typeof fetch = fetch,
): Promise<TermsAcceptResponse> {
  const safeNext = sanitizeNextPath(next);
  const response = await fetcher("/api/personal/terms/accept", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ next: safeNext }),
  });

  // A non-2xx response may intentionally carry CURRENT's /entry or /rules redirect
  // as JSON. Parse it before looking at the HTTP status, but reject malformed replies.
  const body: unknown = await response.json();
  // MIG-0641's route factory authenticates *before* the handler. Middleware
  // failures are {error: code}, not the handler's {ok, next} schema.
  // CURRENT redirects anonymous users to /entry and unavailable sessions to
  // /rules?error=database_unavailable. Keep those same-origin destinations.
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const middlewareError = (body as { error?: unknown }).error;
    if (response.status === 401 && middlewareError === "unauthenticated") {
      return { ok: false, next: `/entry?next=${encodeURIComponent(safeNext)}` };
    }
    if (response.status === 503 && middlewareError === "database_unavailable") {
      return { ok: false, next: `/rules?next=${encodeURIComponent(safeNext)}&error=database_unavailable` };
    }
  }
  if (typeof body !== "object" || body === null || Array.isArray(body) ||
      typeof (body as { ok?: unknown }).ok !== "boolean") {
    throw new Error("Invalid terms response");
  }
  const result = body as Record<string, unknown>;
  if (result.next !== undefined && typeof result.next !== "string") throw new Error("Invalid terms next");
  if (result.message !== undefined && typeof result.message !== "string") throw new Error("Invalid terms message");
  if (result.reason !== undefined && typeof result.reason !== "string") throw new Error("Invalid terms reason");
  if (result.ok === true) {
    if (!response.ok || typeof result.next !== "string") throw new Error("Invalid terms success");
    return { ok: true, next: result.next };
  }
  // A failing response must carry an actionable redirect or an error message.
  if (typeof result.next !== "string" && typeof result.message !== "string") {
    throw new Error("Invalid terms error");
  }
  return { ok: false, next: result.next as string | undefined, message: result.message as string | undefined,
    reason: result.reason as string | undefined };
}
