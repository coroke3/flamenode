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
/**
 * Names with the session prefix, counting empty and repeated ones, which Auth.js
 * skips but which still cost a slice each. Browsers keep about 180 cookies per
 * site and Auth.js clears unused chunks, so a real request carries a handful.
 */
export const MAX_SESSION_COOKIE_NAMES = 2 * MAX_SESSION_COOKIE_CHUNKS;

export function sessionCookieName(secure: boolean): string {
  return secure ? SECURE_SESSION_COOKIE_NAME : INSECURE_SESSION_COOKIE_NAME;
}

// Space and tab only, like @auth/core lib/vendored/cookie.js startIndex/endIndex.
function isCookieSpace(code: number): boolean {
  return code === 0x20 || code === 0x09;
}

// The same space and tab trimming as native regex scans, for the session cookie:
// a crafted 128 KB run of spaces then costs no JS loop per char, even on a cold
// isolate (ZERO_1102.md S4). Both scans are linear: LAST_NON_COOKIE_SPACE only
// gets past its first char at a non-space, so each run of spaces is read once.
const COOKIE_SPACES = /[ \t]*/y;
const LAST_NON_COOKIE_SPACE = /[^ \t][ \t]*$/;

// The index of the first char at or after `index` that is not a space or tab.
function skipCookieSpaces(header: string, index: number): number {
  COOKIE_SPACES.lastIndex = index;
  COOKIE_SPACES.test(header);
  return COOKIE_SPACES.lastIndex;
}

function trimCookieSpacesEnd(text: string): string {
  if (!isCookieSpace(text.charCodeAt(text.length - 1))) return text;
  const last = LAST_NON_COOKIE_SPACE.exec(text);
  return last ? text.slice(0, last.index + 1) : "";
}

// The value between `=` and the segment end, trimmed, and URI-decoded only when it
// contains `%` and decodes cleanly. Quotes are kept, as in Auth.js parse.
function readCookieValue(header: string, eqIdx: number, endIdx: number): string {
  const val = trimCookieSpacesEnd(header.slice(skipCookieSpaces(header, eqIdx + 1), endIdx));
  if (!val.includes("%")) return val;
  try {
    return decodeURIComponent(val);
  } catch {
    return val;
  }
}

/**
 * Parses raw Cookie header string into key-value map, with the same walk as the
 * cookie parser Auth.js uses (@auth/core lib/vendored/cookie.js parse): first
 * occurrence wins, and a segment without `=` is skipped by jumping to the
 * segment that holds the next `=`. No request path uses it: it is the full-walk
 * reference the tests compare readPrefixedCookies against.
 */
export function parseCookieHeader(header?: string | null): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  if (!header || typeof header !== "string" || header.length < 2) return result;

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
    if (result[key] === undefined) result[key] = readCookieValue(header, eqIdx, endIdx);
    index = endIdx + 1;
  } while (index < len);
  return result;
}

/**
 * Reads the cookies whose name starts with `prefix`, giving the same pairs as
 * parseCookieHeader. Rather than walking every `;` segment, it jumps between
 * `indexOf(prefix)` matches, so other cookies cost only native scans, even on a
 * cold isolate (ZERO_1102.md S4). Each scan starts at or after the segment the
 * previous one ended in, so the cost stays linear in the header length, also
 * for runs of prefixed segments without `=`. `onNew` sees each first occurrence
 * and stops the read by returning false. The read also stops, returning false,
 * at the (maxMatches + 1)th name with the prefix, counting empty and repeated ones.
 */
function readPrefixedCookies(
  header: string,
  prefix: string,
  onNew: (key: string, value: string) => boolean,
  maxMatches: number,
): boolean {
  if (header.length < 2) return true;
  const seen: Record<string, true> = Object.create(null);
  let matches = 0;

  const len = header.length;
  let from = 0;
  while (from < len) {
    const m = header.indexOf(prefix, from);
    if (m === -1) return true;
    const semiIdx = header.indexOf(";", m);
    const endIdx = semiIdx === -1 ? len : semiIdx;
    // Segments start after a `;`, so the match is a name only when nothing but
    // space or tab precedes it in its segment.
    const prev = m === 0 ? 0x3b : header.charCodeAt(m - 1);
    const isName =
      prev === 0x3b ||
      (isCookieSpace(prev) && skipCookieSpaces(header, header.lastIndexOf(";", m - 1) + 1) === m);
    if (isName) {
      // The prefix has no `=`, so the segment's first `=` is at or after the match.
      const eqIdx = header.indexOf("=", m);
      if (eqIdx === -1) return true;
      if (eqIdx > endIdx) {
        // No `=` in this segment: resume at the segment holding that `=`, as Auth.js does.
        from = header.lastIndexOf(";", eqIdx - 1) + 1;
        continue;
      }

      if (++matches > maxMatches) return false;
      const key = trimCookieSpacesEnd(header.slice(m, eqIdx));
      if (seen[key] === undefined) {
        seen[key] = true;
        if (!onNew(key, readCookieValue(header, eqIdx, endIdx))) return false;
      }
    }
    from = endIdx + 1;
  }
  return true;
}

/**
 * Extracts the sessionToken Auth.js would read for a request of this scheme:
 * like @auth/core SessionStore, joins every non-empty cookie whose name starts
 * with the session cookie name, ordered by the numeric suffix after the last `.`.
 * Returns null above MAX_SESSION_COOKIE_CHUNKS / MAX_SESSION_TOKEN_LENGTH, or
 * above MAX_SESSION_COOKIE_NAMES names with the prefix. The caps stop the read
 * early, and other cookies cost only indexOf scans (see readPrefixedCookies).
 */
export function extractSessionToken(
  cookieHeader: string | null | undefined,
  options: { secure: boolean },
): string | null {
  if (!cookieHeader) return null;
  const base = sessionCookieName(options.secure);
  const chunks: { index: number; value: string }[] = [];
  let length = 0;
  const complete = readPrefixedCookies(
    cookieHeader,
    base,
    (name, value) => {
      if (!value) return true;
      length += value.length;
      if (chunks.length === MAX_SESSION_COOKIE_CHUNKS || length > MAX_SESSION_TOKEN_LENGTH) return false;
      // Same index as the SessionStore comparator, computed once per chunk.
      chunks.push({ index: parseInt(name.split(".").pop() || "0"), value });
      return true;
    },
    MAX_SESSION_COOKIE_NAMES,
  );
  if (!complete || chunks.length === 0) return null;
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

