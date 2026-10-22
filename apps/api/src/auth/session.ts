/**
 * FlameNode Phase 6: Hono read-only session resolution (MIG-0608).
 *
 * Implements read-only session resolution from Auth.js database session cookies
 * (__Secure-authjs.session-token and authjs.session-token, including chunks).
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
 * Auth.js picks the session cookie name by `useSecureCookies`
 * (`url.protocol === "https:"`, @auth/core lib/init.js), then reads every
 * cookie whose name starts with it (SessionStore chunks). A non-`__Secure-`
 * cookie on https is never read, so the same rule applies here.
 */
export const SECURE_SESSION_COOKIE_NAME = "__Secure-authjs.session-token";
export const INSECURE_SESSION_COOKIE_NAME = "authjs.session-token";

/**
 * Fail-closed bounds on the attacker-controlled session cookie chunks, so the
 * chunk sort only ever sees bounded input (ZERO_1102.md §4 rule 8).
 *
 * They cannot change which user resolves: Auth.js database sessions store
 * `crypto.randomUUID()` (36 chars; @auth/core lib/init.js generateSessionToken,
 * not overridden in CURRENT src/lib/auth) as session.sessionToken, and a value
 * that short is never chunked. Every counted chunk is non-empty, so more than
 * 64 chunks, or more than 4096 joined chars (one browser cookie's size limit),
 * is far longer than any stored token and matches no row in Auth.js either.
 */
export const MAX_SESSION_COOKIE_CHUNKS = 64;
export const MAX_SESSION_TOKEN_LENGTH = 4096;

export function sessionCookieName(secure: boolean): string {
  return secure ? SECURE_SESSION_COOKIE_NAME : INSECURE_SESSION_COOKIE_NAME;
}

// Space and tab only, like @auth/core lib/vendored/cookie.js startIndex/endIndex.
function isCookieSpace(code: number): boolean {
  return code === 0x20 || code === 0x09;
}

/**
 * Parses raw Cookie header string into key-value map, with the same rules as
 * the cookie parser Auth.js uses (@auth/core lib/vendored/cookie.js parse):
 * first occurrence wins, quotes are kept, values are URI-decoded only when
 * they contain `%` and decode cleanly.
 */
export function parseCookieHeader(header?: string | null): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  if (!header || typeof header !== "string" || header.length < 2) {
    return result;
  }

  const len = header.length;
  let index = 0;
  do {
    const eqIdx = header.indexOf("=", index);
    if (eqIdx === -1) break;
    const semiIdx = header.indexOf(";", index);
    const endIdx = semiIdx === -1 ? len : semiIdx;
    if (eqIdx > endIdx) {
      index = header.lastIndexOf(";", eqIdx - 1) + 1;
      continue;
    }

    let keyStart = index;
    while (keyStart < eqIdx && isCookieSpace(header.charCodeAt(keyStart))) keyStart++;
    let keyEnd = eqIdx;
    while (keyEnd > keyStart && isCookieSpace(header.charCodeAt(keyEnd - 1))) keyEnd--;
    const key = header.slice(keyStart, keyEnd);

    if (result[key] === undefined) {
      let valStart = eqIdx + 1;
      while (valStart < endIdx && isCookieSpace(header.charCodeAt(valStart))) valStart++;
      let valEnd = endIdx;
      while (valEnd > valStart && isCookieSpace(header.charCodeAt(valEnd - 1))) valEnd--;
      const val = header.slice(valStart, valEnd);
      let decoded = val;
      if (val.includes("%")) {
        try {
          decoded = decodeURIComponent(val);
        } catch {
          decoded = val;
        }
      }
      result[key] = decoded;
    }
    index = endIdx + 1;
  } while (index < len);

  return result;
}

/**
 * Extracts the sessionToken Auth.js would read for a request of this scheme:
 * like @auth/core SessionStore, joins every non-empty cookie whose name starts
 * with the session cookie name, ordered by the numeric suffix after the last `.`.
 * Returns null above MAX_SESSION_COOKIE_CHUNKS / MAX_SESSION_TOKEN_LENGTH.
 */
export function extractSessionToken(
  cookieHeader: string | null | undefined,
  options: { secure: boolean },
): string | null {
  if (!cookieHeader) return null;
  const base = sessionCookieName(options.secure);
  const cookies = parseCookieHeader(cookieHeader);
  const chunks: { index: number; value: string }[] = [];
  let length = 0;
  for (const name of Object.keys(cookies)) {
    const value = cookies[name];
    if (!name.startsWith(base) || !value) continue;
    length += value.length;
    if (chunks.length === MAX_SESSION_COOKIE_CHUNKS || length > MAX_SESSION_TOKEN_LENGTH) {
      return null;
    }
    // Same index as the SessionStore comparator, computed once per chunk.
    chunks.push({ index: parseInt(name.split(".").pop() || "0"), value });
  }
  if (chunks.length === 0) return null;
  if (chunks.length === 1) return chunks[0].value;
  // NaN differences compare as equal, as in SessionStore; the sort is stable.
  return chunks
    .sort((a, b) => a.index - b.index)
    .map((chunk) => chunk.value)
    .join("");
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
 * Returns SessionUser if valid, or null if expired / deleted / not found / error.
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
    return null;
  }
}

export interface SessionMiddlewareOptions {
  now?: () => number;
}

/**
 * Hono middleware resolving session for each request.
 * Sets `c.set("user", user)` and `c.set("session", user ? { user } : null)`.
 *
 * Never throws on unauthenticated requests; attaches null and proceeds to next handler.
 */
export function sessionMiddleware(options?: SessionMiddlewareOptions) {
  return async (
    c: {
      req: { url: string; header(name: string): string | undefined };
      env?: { DB?: D1DatabaseLike };
      set(key: string, value: unknown): void;
    },
    next: () => Promise<void>,
  ): Promise<void> => {
    const cookieHeader = c.req.header("cookie");
    const secure = new URL(c.req.url).protocol === "https:";
    const token = extractSessionToken(cookieHeader, { secure });
    const db = c.env?.DB;

    if (!db || !token) {
      c.set("user", null);
      c.set("session", null);
      await next();
      return;
    }

    const user = await resolveSessionUser(db, token, {
      now: options?.now ? options.now() : undefined,
    });

    c.set("user", user);
    c.set("session", user ? { user } : null);
    await next();
  };
}

/**
 * Hono guard middleware that requires an authenticated, non-banned user.
 * Returns 401 if not logged in; 403 if user is banned.
 */
export function requireAuth() {
  return async (
    c: {
      get(key: string): unknown;
      json(data: unknown, status?: number): Response;
    },
    next: () => Promise<void>,
  ): Promise<Response | void> => {
    const user = c.get("user") as SessionUser | null;
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (user.is_banned === 1) {
      return c.json({ error: "Forbidden", message: "User is banned" }, 403);
    }
    await next();
  };
}
