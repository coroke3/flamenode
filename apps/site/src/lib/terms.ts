/**
 * MIG-0519 U03: SA-075 JSON transport on the merged MIG-0641 contract
 * (POST /api/personal/terms/accept, @flamenode/contracts AcceptLatestTermsResponseSchema).
 */
import { AcceptLatestTermsResponseSchema } from "@flamenode/contracts";
import { sanitizeNextPath } from "../../../../src/lib/utils/next.ts";

export type TermsAcceptResponse =
  | { ok: true; next: string }
  | { ok: false; next?: string; message?: string };

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
  // requireAuth currently uses {error:"Unauthorized"} for missing sessions.
  // CURRENT redirects anonymous users to /entry and unavailable sessions to
  // /rules?error=database_unavailable. Keep those same-origin destinations.
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const middlewareError = (body as { error?: unknown }).error;
    if (response.status === 401 && (middlewareError === "Unauthorized" || middlewareError === "unauthenticated")) {
      return { ok: false, next: `/entry?next=${encodeURIComponent(safeNext)}` };
    }
    if (response.status === 503 && middlewareError === "database_unavailable") {
      return { ok: false, next: `/rules?next=${encodeURIComponent(safeNext)}&error=database_unavailable` };
    }
  }
  const parsed = AcceptLatestTermsResponseSchema.safeParse(body);
  if (parsed.success) {
    const { ok, next: serverNext, message } = parsed.data;
    if (ok) {
      if (!response.ok) throw new Error("Invalid terms success");
      return { ok: true, next: serverNext };
    }
    return { ok: false, next: serverNext, message };
  }
  // The merged schema requires `next`; a failure carrying only an actionable
  // message (CURRENT shows it and stays on the form) is still accepted.
  const result = body as Record<string, unknown> | null;
  const isObject = typeof result === "object" && result !== null && !Array.isArray(result);
  if (isObject && result.ok === false && typeof result.message === "string" && result.next === undefined) {
    return { ok: false, message: result.message };
  }
  if (isObject && result.next !== undefined && typeof result.next !== "string") {
    throw new Error("Invalid terms next");
  }
  throw new Error("Invalid terms response");
}
