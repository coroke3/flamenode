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

/**
 * Auth.js can catch adapter errors internally and answer GET /session as 200
 * null, indistinguishable from a genuinely missing session. Record failures
 * at the adapter operation boundary, before Auth.js handles them.
 *
 * The adapter/config is created anew for every HTTP request. This detector
 * does not share state between requests, log error content or add a D1 read.
 * Only the three adapter operations used by this intentionally limited router
 * are wrapped; OAuth sign-in/callback remain unmounted until MIG-0805.
 */
function monitorSessionAdapterFailures(
  config: ReturnType<typeof buildUnmountedAuthConfig>,
  markFailure: () => void,
): void {
  const adapter = config.adapter;
  if (!adapter) return;

  if (adapter.getSessionAndUser) {
    const original = adapter.getSessionAndUser;
    adapter.getSessionAndUser = async (token) => {
      try {
        return await original(token);
      } catch (error) {
        markFailure();
        throw error;
      }
    };
  }

  if (adapter.updateSession) {
    const original = adapter.updateSession;
    adapter.updateSession = async (session) => {
      try {
        return await original(session);
      } catch (error) {
        markFailure();
        throw error;
      }
    };
  }

  if (adapter.deleteSession) {
    const original = adapter.deleteSession;
    adapter.deleteSession = async (token) => {
      try {
        return await original(token);
      } catch (error) {
        markFailure();
        throw error;
      }
    };
  }
}

function databaseSessionUnavailableResponse(): Response {
  return new Response(JSON.stringify({ error: "auth_temporarily_unavailable" }), {
    status: 503,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

/** Match CURRENT authRouteError.ts: fail closed without leaking config details. */
async function handleUnmountedAuthRequest(
  request: Request,
  input: UnmountedAuthInputs,
): Promise<Response> {
  let databaseFailed = false;
  try {
    const config = buildUnmountedAuthConfig(input);
    monitorSessionAdapterFailures(config, () => { databaseFailed = true; });
    const response = await invokeUnmountedAuth(request, config);
    // Auth.js may have converted AdapterError into a successful 200/null.
    // Never return its Set-Cookie or cacheable response on a D1 outage.
    return databaseFailed ? databaseSessionUnavailableResponse() : response;
  } catch (error) {
    if (databaseFailed) return databaseSessionUnavailableResponse();
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
