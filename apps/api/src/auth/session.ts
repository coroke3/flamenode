/**
 * FlameNode Phase 6: Hono read-only session resolution (MIG-0608).
 *
 * Implements read-only session resolution from Auth.js database session cookies
 * (__Secure-authjs.session-token and authjs.session-token).
 *
 * INVARIANTS:
 * - Read-only: never issues, renews, or deletes cookies (managed by Next until Phase 8).
 * - Safe logging: never prints or includes sessionToken in log messages, errors, or traces.
 * - Bound execution: queries D1 at most once via indexed primary key lookup on session.sessionToken.
 * - Framework-neutral session resolver with typed Hono middleware adapter.
 */

export interface SessionUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: "user" | "admin" | "moderator";
  is_banned: number;
  active_x_user_id: string | null;
}

export interface AuthSession {
  user: SessionUser;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): {
    first<T = Record<string, unknown>>(): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  };
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

/**
 * Auth.js reads exactly one session cookie name, chosen by `useSecureCookies`
 * (`url.protocol === "https:"`, @auth/core lib/init.js). Accepting any other
 * name would let Hono resolve a user that Next does not (e.g. a tossed
 * non-`__Secure-` cookie on https), so the same rule applies here.
 */
export const SECURE_SESSION_COOKIE_NAME = "__Secure-authjs.session-token";
export const INSECURE_SESSION_COOKIE_NAME = "authjs.session-token";

export function sessionCookieName(secure: boolean): string {
  return secure ? SECURE_SESSION_COOKIE_NAME : INSECURE_SESSION_COOKIE_NAME;
}

/**
 * Parses raw Cookie header string into key-value map.
 * Safely decodes URI components while handling malformed values gracefully.
 */
export function parseCookieHeader(header?: string | null): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  if (!header || typeof header !== "string") {
    return result;
  }

  const pairs = header.split(";");
  for (const rawPair of pairs) {
    const pair = rawPair.trim();
    if (!pair) continue;
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;

    const key = pair.slice(0, eqIdx).trim();
    let val = pair.slice(eqIdx + 1).trim();
    if (!key) continue;

    // Strip wrapping quotes if present
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
      val = val.slice(1, -1);
    }

    // First occurrence wins, like the cookie parser Auth.js uses
    // (@auth/core lib/vendored/cookie.js), so both read the same token.
    if (Object.hasOwn(result, key)) continue;
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }

  return result;
}

/**
 * Extracts the sessionToken Auth.js would read for a request of this scheme.
 */
export function extractSessionToken(
  cookieHeader: string | null | undefined,
  options: { secure: boolean },
): string | null {
  if (!cookieHeader) return null;
  const token = parseCookieHeader(cookieHeader)[sessionCookieName(options.secure)];
  return token ? token : null;
}

export interface ResolveSessionOptions {
  now?: number;
}

/**
 * Resolves session user from D1 database in a single query.
 *
 * Checks:
 * 1. session row exists in D1 "session" table matching sessionToken.
 * 2. session has not expired (session.expires > now).
 * 3. associated "user" row exists.
 *
 * Returns SessionUser if valid, or null if expired / deleted / not found.
 * Throws SessionUnavailableError when D1 fails (tri-state: none / unavailable / user).
 * Banned users are returned with is_banned: 1 (consistent with CURRENT session contract).
 */
export async function resolveSessionUser(
  db: D1DatabaseLike,
  sessionToken: string | null,
  options?: ResolveSessionOptions,
): Promise<SessionUser | null> {
  if (!sessionToken || typeof sessionToken !== "string") {
    return null;
  }

  const now = options?.now ?? Date.now();

  try {
    const row = await db
      .prepare(
        `SELECT 
          s."expires" AS session_expires,
          u."id" AS user_id,
          u."name" AS user_name,
          u."email" AS user_email,
          u."image" AS user_image,
          u."role" AS user_role,
          u."is_banned" AS user_is_banned,
          u."active_x_user_id" AS user_active_x_user_id
        FROM "session" s
        INNER JOIN "user" u ON s."userId" = u."id"
        WHERE s."sessionToken" = ?
        LIMIT 1`,
      )
      .bind(sessionToken)
      .first<{
        session_expires: number | string;
        user_id: string;
        user_name: string | null;
        user_email: string | null;
        user_image: string | null;
        user_role: string | null;
        user_is_banned: number | null;
        user_active_x_user_id: string | null;
      }>();

    if (!row) {
      return null;
    }

    // Expiration check: expires is stored as epoch ms integer
    const expiresMs = Number(row.session_expires);
    if (isNaN(expiresMs) || expiresMs <= now) {
      return null;
    }

    const role =
      row.user_role === "admin" || row.user_role === "moderator"
        ? row.user_role
        : "user";

    return {
      id: row.user_id,
      name: row.user_name ?? null,
      email: row.user_email ?? null,
      image: row.user_image ?? null,
      role,
      is_banned: row.user_is_banned === 1 ? 1 : 0,
      active_x_user_id: row.user_active_x_user_id ?? null,
    };
  } catch {
    // D1/adapter errors may include bound session tokens in their message/stack.
    // Emit a fixed code only; do not serialize the underlying exception.
    console.error("[auth:session] D1_LOOKUP_FAILED");
    // CURRENT currentUser.ts: a failed lookup is CurrentUserUnavailableError
    // ("database_unavailable"), never "no session". Callers map it to 503.
    throw new SessionUnavailableError();
  }
}

/** Reason code CURRENT CurrentUserUnavailableError uses for D1 failures. */
export const SESSION_UNAVAILABLE_CODE = "database_unavailable";

/** Thrown when the session cannot be resolved (D1 error). Carries no cause. */
export class SessionUnavailableError extends Error {
  readonly code = SESSION_UNAVAILABLE_CODE;
  constructor() {
    super(SESSION_UNAVAILABLE_CODE);
    this.name = "SessionUnavailableError";
  }
}

export type SessionState = "none" | "unavailable" | "user";

/** Authenticated/auth-adjacent responses must never be shared-cached. */
export const PRIVATE_NO_STORE = "private, no-store";

export interface SessionMiddlewareOptions {
  now?: () => number;
}

type SessionContext = {
  req: { url: string; header(name: string): string | undefined };
  env?: { DB?: D1DatabaseLike };
  set(key: string, value: unknown): void;
  header?(name: string, value: string): void;
};

/**
 * Hono middleware resolving session for each request (tri-state).
 * Sets "user", "session" and "sessionState" ("none" | "unavailable" | "user").
 *
 * - no cookie token -> state "none" (user null), proceeds
 * - token but D1 binding missing or D1 lookup failed -> state "unavailable"
 *   (CURRENT CurrentUserUnavailableError "database_unavailable"); guards map
 *   it to 503, never to "unauthenticated"
 * - a request carrying a session token gets "Cache-Control: private, no-store"
 *   (Next force-dynamic parity); requests without a token are untouched.
 */
export function sessionMiddleware(options?: SessionMiddlewareOptions) {
  return async (c: SessionContext, next: () => Promise<void>): Promise<void> => {
    const cookieHeader = c.req.header("cookie");
    const secure = new URL(c.req.url).protocol === "https:";
    const token = extractSessionToken(cookieHeader, { secure });
    const db = c.env?.DB;

    if (!token) {
      c.set("user", null);
      c.set("session", null);
      c.set("sessionState", "none" satisfies SessionState);
      await next();
      return;
    }
    c.header?.("Cache-Control", PRIVATE_NO_STORE);

    if (!db) {
      console.error("[auth:session] D1_BINDING_MISSING");
      c.set("user", null);
      c.set("session", null);
      c.set("sessionState", "unavailable" satisfies SessionState);
      await next();
      return;
    }

    let user: SessionUser | null;
    try {
      user = await resolveSessionUser(db, token, {
        now: options?.now ? options.now() : undefined,
      });
    } catch (error) {
      if (!(error instanceof SessionUnavailableError)) throw error;
      c.set("user", null);
      c.set("session", null);
      c.set("sessionState", "unavailable" satisfies SessionState);
      await next();
      return;
    }

    c.set("user", user);
    c.set("session", user ? { user } : null);
    c.set("sessionState", (user ? "user" : "none") satisfies SessionState);
    await next();
  };
}

/**
 * Hono guard middleware that requires an authenticated, non-banned user.
 * 503 database_unavailable if the session could not be resolved; 401 if not
 * logged in; 403 if user is banned. Deny responses are private, no-store.
 */
export function requireAuth() {
  return async (
    c: {
      get(key: string): unknown;
      json(data: unknown, status?: number): Response;
      header?(name: string, value: string): void;
    },
    next: () => Promise<void>,
  ): Promise<Response | void> => {
    if (c.get("sessionState") === "unavailable") {
      c.header?.("Cache-Control", PRIVATE_NO_STORE);
      return c.json({ error: SESSION_UNAVAILABLE_CODE }, 503);
    }
    const user = c.get("user") as SessionUser | null;
    if (!user) {
      c.header?.("Cache-Control", PRIVATE_NO_STORE);
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (user.is_banned === 1) {
      c.header?.("Cache-Control", PRIVATE_NO_STORE);
      return c.json({ error: "Forbidden", message: "User is banned" }, 403);
    }
    await next();
  };
}

