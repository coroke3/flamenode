import {
  createTraceId,
  logFlowTrace,
} from "../observability/flowTrace.ts";

const AUTH_ROUTE_UNAVAILABLE_CODES = new Set([
  "AUTH_DATABASE_UNAVAILABLE",
  "AUTH_SECRET_MISSING",
  "AUTH_DISCORD_CONFIG_MISSING",
  "AUTH_URL_MISSING",
  "AUTH_URL_INVALID_ORIGIN",
  "AUTH_URL_LOCALHOST_FORBIDDEN",
  "NEXT_PUBLIC_SITE_URL_MISSING",
  "NEXT_PUBLIC_SITE_URL_INVALID_ORIGIN",
  "NEXT_PUBLIC_SITE_URL_LOCALHOST_FORBIDDEN",
  "AUTH_ORIGIN_MISMATCH",
]);

const CLOUDFLARE_BINDINGS_ERROR_NAME =
  "CloudflareBindingsUnavailableError";
const CLOUDFLARE_BINDINGS_ERROR_PREFIX =
  "CLOUDFLARE_BINDINGS_UNAVAILABLE:";
const AUTH_UNAVAILABLE_BODY = JSON.stringify({
  error: "auth_temporarily_unavailable",
});

type ErrorContainer = {
  cause?: unknown;
  err?: unknown;
  message?: unknown;
  name?: unknown;
};

function isErrorContainer(value: unknown): value is ErrorContainer {
  return typeof value === "object" && value !== null;
}

function isKnownUnavailableError(value: unknown): boolean {
  if (!isErrorContainer(value)) return false;

  if (
    value.name === CLOUDFLARE_BINDINGS_ERROR_NAME &&
    typeof value.message === "string" &&
    value.message.startsWith(CLOUDFLARE_BINDINGS_ERROR_PREFIX)
  ) {
    return true;
  }

  return (
    typeof value.message === "string" &&
    AUTH_ROUTE_UNAVAILABLE_CODES.has(value.message)
  );
}

/**
 * Auth.js may wrap a lazy-config failure in `cause` or `cause.err`.
 * Only the bounded, known configuration failures are converted to a 503.
 */
export function isAuthRouteTemporarilyUnavailable(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();

  while (pending.length > 0 && seen.size < 8) {
    const current = pending.shift();
    if (current == null || seen.has(current)) continue;
    seen.add(current);

    if (isKnownUnavailableError(current)) return true;
    if (!isErrorContainer(current)) continue;

    if (current.cause !== undefined) pending.push(current.cause);
    if (current.err !== undefined) pending.push(current.err);
  }

  return false;
}

export function authTemporarilyUnavailableResponse(): Response {
  return new Response(AUTH_UNAVAILABLE_BODY, {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function logAuthRouteEntry(request: Request): void {
  const pathname = new URL(request.url).pathname;
  if (
    pathname.includes("/api/auth/callback") ||
    pathname.endsWith("callback/discord")
  ) {
    logFlowTrace({
      flow: "discord_auth",
      phase: "oauth_callback_started",
      trace_id: createTraceId(),
      result: "started",
    });
  }
  if (pathname.includes("/api/auth/signout") && request.method === "POST") {
    logFlowTrace({
      flow: "discord_auth",
      phase: "signout_started",
      trace_id: createTraceId(),
      result: "started",
    });
  }
}

export async function handleAuthRouteRequest<TRequest extends Request>(
  handler: (request: TRequest) => Response | Promise<Response>,
  request: TRequest,
): Promise<Response> {
  logAuthRouteEntry(request);
  try {
    return await handler(request);
  } catch (error) {
    if (!isAuthRouteTemporarilyUnavailable(error)) throw error;
    return authTemporarilyUnavailableResponse();
  }
}
