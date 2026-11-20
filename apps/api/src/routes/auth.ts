/**
 * MIG-0802 U01 synthetic Hono/Auth.js test router.
 * DO NOT mount in app.ts, Worker routes, or production gateways.
 *
 * Deliberately limited HTTP surface. GET /session can slide expiry,
 * GET /csrf issues a CSRF cookie, and POST /signout uses Auth.js native CSRF
 * verification before revoking the D1 session. No login/OAuth callback routes.
 */
import { Hono } from "hono";
import {
  buildUnmountedAuthConfig,
  invokeUnmountedAuth,
  type UnmountedAuthInputs,
} from "../auth/authjs.ts";

const AUTH_ROUTE_UNAVAILABLE_CODES = new Set([
  "AUTH_DATABASE_UNAVAILABLE",
  "AUTH_SECRET_MISSING",
  "AUTH_DISCORD_CONFIG_MISSING",
  "AUTH_ORIGIN_INVALID",
  "AUTH_ORIGIN_MISMATCH",
]);

function isAuthConfigUnavailable(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  while (queue.length > 0 && seen.size < 8) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const candidate = current as { message?: unknown; cause?: unknown; err?: unknown };
    if (typeof candidate.message === "string" && AUTH_ROUTE_UNAVAILABLE_CODES.has(candidate.message)) {
      return true;
    }
    if (candidate.cause !== undefined) queue.push(candidate.cause);
    if (candidate.err !== undefined) queue.push(candidate.err);
  }
  return false;
}

/** Match CURRENT authRouteError.ts: fail closed as private no-store 503 without leaking config details. */
async function handleUnmountedAuthRequest(
  request: Request,
  input: UnmountedAuthInputs,
): Promise<Response> {
  try {
    return await invokeUnmountedAuth(request, buildUnmountedAuthConfig(input));
  } catch (error) {
    if (isAuthConfigUnavailable(error)) {
      return new Response(JSON.stringify({ error: "auth_temporarily_unavailable" }), {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }
    throw error;
  }
}

export function createUnmountedAuthRoutes(input: UnmountedAuthInputs) {
  const router = new Hono();
  for (const action of ["session", "csrf"] as const) {
    router.get(`/api/auth/${action}`, (c) =>
      handleUnmountedAuthRequest(c.req.raw, input),
    );
  }
  // U02b: Auth.js enforces CSRF cookie+POST token. Keep GET /signout,
  // signin and callback unavailable until the full reviewed cutover.
  router.post("/api/auth/signout", (c) =>
    handleUnmountedAuthRequest(c.req.raw, input),
  );
  return router;
}
