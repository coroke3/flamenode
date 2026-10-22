/**
 * MIG-0602 U01: write origin guard + admin permission middleware.
 *
 * Mirrors the CURRENT write guard for the Hono API surface:
 *   - origin: src/lib/auth/writeOriginGuard.ts + src/lib/auth/origin.ts
 *   - admin:  src/lib/auth/writeGuard.ts (evaluateWriteIdentity, requiredRole "admin")
 *   - status mapping: src/lib/admin/spreadsheet/guard.ts writeGuardHttpStatus
 *
 * Evaluation order (early deny, same as CURRENT writeGuard):
 *   1. Origin verification (env load failure -> 503 origin_verification_unavailable;
 *      Origin header mismatch -> 403 invalid_origin)
 *   2. Authentication (no resolved session user -> 401 unauthenticated)
 *   3. Identity: banned -> tos_required -> tos_reaccept_required -> forbidden
 *      (evaluateWriteIdentity from @flamenode/domain/admin, requiredRole "admin")
 *
 * TOS state (is_tos_accepted / terms_reaccept_required) is not carried by the
 * MIG-0608 SessionUser; it is read from D1 in the same authoritative way as
 * CURRENT's getCurrentUser (users row + latest published major terms),
 * fail-closed on error or missing row. CostGuard (operation_mode /
 * disabled_features) is not part of U01 and stays with the mutation units.
 *
 * The middleware expects sessionMiddleware (MIG-0608) to have run first,
 * setting the "user" request variable.
 */
import { evaluateWriteIdentity } from "@flamenode/domain/admin";
import type { Context, Next } from "hono";
import type { D1DatabaseLike, SessionUser } from "../auth/session.ts";

export type WriteGuardDenyReason =
  | "origin_verification_unavailable"
  | "invalid_origin"
  | "unauthenticated"
  | "database_unavailable"
  | "db_unavailable"
  | "banned"
  | "tos_required"
  | "tos_reaccept_required"
  | "forbidden";

export type WriteGuardOutcome =
  | { ok: true; user: SessionUser }
  | { ok: false; status: 401 | 403 | 503; reason: WriteGuardDenyReason };

/**
 * Same Japanese messages as CURRENT src/lib/auth/writeGuard.ts MESSAGES (deny()).
 * Origin reasons have no CURRENT message (Next enforces origin for Server
 * Actions; requireSameOriginWrite returns only an error code), so they carry none.
 */
export const WRITE_GUARD_MESSAGES: Readonly<Record<string, string>> = {
  unauthenticated: "ログインが必要です。",
  db_unavailable: "DB に接続できません。",
  banned: "現在、このアカウントは利用停止中です。",
  tos_required: "利用規約への同意が必要です。",
  tos_reaccept_required: "利用規約の最新版に再同意してください。",
  maintenance_mode:
    "現在、書き込みを一時停止しています (コストガード)。しばらく時間をおいてからお試しください。",
  cost_guard_blocked: "現在、この機能の書き込みは一時的に無効化されています。",
  forbidden: "この操作を実行する権限がありません。",
};

/** Deny response: JSON body + "Cache-Control: private, no-store" (C-2). */
export function writeGuardDenyResponse(
  c: Context,
  reason: string,
  status: 401 | 403 | 503,
): Response {
  c.header("Content-Type", "application/json");
  c.header("Cache-Control", "private, no-store");
  return c.body(writeGuardDenyBody(reason), status);
}

/** JSON deny body:{ok:false, reason, message?} (message as CURRENT deny()). */
export function writeGuardDenyBody(reason: string): string {
  const message = WRITE_GUARD_MESSAGES[reason];
  return JSON.stringify(
    message === undefined
      ? { ok: false, reason }
      : { ok: false, reason, message },
  );
}

export type OriginChecker = (originHeader: string | null) => boolean;

/**
 * Pure, framework-neutral guard core. Kept separate from the Hono adapter so
 * the deny matrix is unit-testable without an app or D1.
 */
export async function evaluateAdminWriteGuard(options: {
  user: SessionUser | null;
  hasDb: boolean;
  originOk: boolean;
  /** CURRENT: loadEnv 失敗 (origin_verification_unavailable) */
  originUnavailable?: boolean;
  /** C-1: session could not be resolved (D1 error or missing binding with a token). */
  sessionUnavailable?: boolean;
  loadTosState?: () => Promise<{ is_tos_accepted: number; terms_reaccept_required: number } | null>;
}): Promise<WriteGuardOutcome> {
  if (options.originUnavailable) {
    return { ok: false, status: 503, reason: "origin_verification_unavailable" };
  }
  if (!options.originOk) {
    return { ok: false, status: 403, reason: "invalid_origin" };
  }
  if (options.sessionUnavailable) {
    // CURRENT: CurrentUserUnavailableError -> 503 with error.code.
    return { ok: false, status: 503, reason: "database_unavailable" };
  }
  if (!options.user) {
    return { ok: false, status: 401, reason: "unauthenticated" };
  }
  if (!options.hasDb) {
    return { ok: false, status: 503, reason: "db_unavailable" };
  }
  let tos: { is_tos_accepted: number; terms_reaccept_required: number } | null;
  try {
    tos = options.loadTosState ? await options.loadTosState() : null;
  } catch {
    return { ok: false, status: 503, reason: "db_unavailable" };
  }
  if (!tos) {
    // CURRENT getCurrentUser: a session whose user row is gone is unauthenticated.
    return { ok: false, status: 401, reason: "unauthenticated" };
  }
  const identityDeny = evaluateWriteIdentity(
    {
      role: options.user.role,
      is_banned: options.user.is_banned,
      is_tos_accepted: tos.is_tos_accepted,
      terms_reaccept_required: tos.terms_reaccept_required,
    },
    "admin",
  );
  if (identityDeny) {
    return {
      ok: false,
      status: 403,
      reason: identityDeny,
    };
  }
  return { ok: true, user: options.user };
}

/**
 * Reads the TOS state CURRENT derives for a user:
 *   - is_tos_accepted from the user row
 *   - terms_reaccept_required = 1 only when the latest published major terms
 *     exist, is_tos_accepted = 1, and neither the accepted-terms mirror nor
 *     any user_tos_consents row covers that major (or a newer major).
 *     No published major terms -> 0 (mirrors termsReacceptRequiredValue).
 * Returns null when the user row is missing (deleted while session lives).
 */
async function loadTosState(
  db: D1DatabaseLike,
  userId: string,
): Promise<{ is_tos_accepted: number; terms_reaccept_required: number } | null> {
  const row = await db
    .prepare(
      `SELECT
         u."is_tos_accepted" AS is_tos_accepted,
         CASE
           WHEN u."is_tos_accepted" = 1
            AND (
              SELECT "published_at" FROM "terms_versions"
              WHERE "severity" = 'major' AND "published_at" IS NOT NULL
              ORDER BY "published_at" DESC, "updated_at" DESC LIMIT 1
            ) IS NOT NULL
            AND NOT (
              EXISTS (
                SELECT 1 FROM "terms_versions" accepted_terms
                WHERE accepted_terms."id" = u."accepted_terms_version_id"
                  AND accepted_terms."published_at" IS NOT NULL
                  AND (
                    accepted_terms."id" = (
                      SELECT "id" FROM "terms_versions"
                      WHERE "severity" = 'major' AND "published_at" IS NOT NULL
                      ORDER BY "published_at" DESC, "updated_at" DESC LIMIT 1
                    )
                    OR accepted_terms."published_at" > (
                      SELECT "published_at" FROM "terms_versions"
                      WHERE "severity" = 'major' AND "published_at" IS NOT NULL
                      ORDER BY "published_at" DESC, "updated_at" DESC LIMIT 1
                    )
                  )
              )
              OR EXISTS (
                SELECT 1 FROM "user_tos_consents" consent
                INNER JOIN "terms_versions" consent_terms
                  ON consent_terms."id" = consent."terms_version_id"
                WHERE consent."user_id" = u."id"
                  AND consent_terms."published_at" IS NOT NULL
                  AND (
                    consent_terms."id" = (
                      SELECT "id" FROM "terms_versions"
                      WHERE "severity" = 'major' AND "published_at" IS NOT NULL
                      ORDER BY "published_at" DESC, "updated_at" DESC LIMIT 1
                    )
                    OR consent_terms."published_at" > (
                      SELECT "published_at" FROM "terms_versions"
                      WHERE "severity" = 'major' AND "published_at" IS NOT NULL
                      ORDER BY "published_at" DESC, "updated_at" DESC LIMIT 1
                    )
                  )
              )
            )
           THEN 1 ELSE 0
         END AS terms_reaccept_required
       FROM "user" u
       WHERE u."id" = ?
       LIMIT 1`,
    )
    .bind(userId)
    .first<{ is_tos_accepted: number | null; terms_reaccept_required: number | null }>();

  if (!row) return null;
  return {
    is_tos_accepted: row.is_tos_accepted === 1 ? 1 : 0,
    terms_reaccept_required: row.terms_reaccept_required === 1 ? 1 : 0,
  };
}

/**
 * Same rules as src/lib/auth/origin.ts configuredHttpOrigin (no Next imports
 * there either; mirrored here for the Hono boundary).
 */
function configuredHttpOrigin(
  value: string | null | undefined,
  options: { allowLoopback?: boolean } = {},
): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error("SITE_URL_MISSING");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("SITE_URL_INVALID_ORIGIN");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error("SITE_URL_INVALID_ORIGIN");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    !options.allowLoopback &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]")
  ) {
    throw new Error("SITE_URL_LOCALHOST_FORBIDDEN");
  }
  return url.origin;
}

function requestHasSameOrigin(
  originHeader: string | null,
  configuredOrigin: string,
): boolean {
  if (!originHeader) return false;
  try {
    return (
      configuredHttpOrigin(originHeader, { allowLoopback: true }) ===
      configuredOrigin
    );
  } catch {
    return false;
  }
}

export type WriteGuardMiddlewareOptions = {
  /**
   * Loads the configured application origin (CURRENT: env.NEXT_PUBLIC_SITE_URL).
   * Throwing (or returning null) means origin verification is unavailable
   * (CURRENT: 503 origin_verification_unavailable).
   */
  loadSiteUrl: () => string | null;
  /**
   * Hono boundary: true only when env.FLAMENODE_LOCAL_PREVIEW === "1".
   * Never derived from NODE_ENV (CURRENT also allows NODE_ENV !== "production";
   * the Hono boundary is intentionally stricter).
   */
  allowLocalPreview: () => boolean;
};

/**
 * Hono middleware factory. Run after sessionMiddleware. Reads the "user"
 * variable, the D1 binding ("DB"), and the site URL per request.
 */
export function writeGuardMiddleware(options: WriteGuardMiddlewareOptions) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    let configuredOrigin: string | null = null;
    let originUnavailable = false;
    try {
      // CURRENT: getEnvAsync() throws when NEXT_PUBLIC_SITE_URL is missing,
      // which requireSameOriginWrite surfaces as 503 origin_verification_unavailable.
      configuredOrigin = configuredHttpOrigin(options.loadSiteUrl(), {
        allowLoopback: options.allowLocalPreview(),
      });
    } catch {
      originUnavailable = true;
    }

    const user = c.get("user") as SessionUser | null;
    const db = (c.env as { DB?: D1DatabaseLike }).DB;
    const originOk =
      !originUnavailable &&
      configuredOrigin !== null &&
      requestHasSameOrigin(c.req.header("Origin") ?? null, configuredOrigin);

    const outcome = await evaluateAdminWriteGuard({
      user,
      hasDb: db !== undefined,
      originOk,
      originUnavailable,
      sessionUnavailable: c.get("sessionState") === "unavailable",
      loadTosState:
        user && db
          ? () => loadTosState(db, user.id)
          : undefined,
    });
    if (!outcome.ok) {
      return writeGuardDenyResponse(c, outcome.reason, outcome.status);
    }
    await next();
  };
}
