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
import {
  evaluateActiveXWriteAccess,
  evaluateWriteIdentity,
  type WriteFeatureKey,
} from "@flamenode/domain/admin";
import type { Context, Next } from "hono";
import type { D1DatabaseLike, SessionUser } from "../auth/session.ts";
import { actorSnapshotFromRow, type ActorSnapshotRow } from "@flamenode/server-core/audit/logger";
import { MAX_SINGLE_ROW_LIMIT } from "../lib/limits.ts";
import { evaluateCostGuardWithSettings } from "./costGuard.ts";

export type WriteGuardDenyReason =
  | "origin_verification_unavailable"
  | "invalid_origin"
  | "unauthenticated"
  | "database_unavailable"
  | "db_unavailable"
  | "banned"
  | "tos_required"
  | "tos_reaccept_required"
  | "forbidden"
  | "active_x_required"
  | "active_x_rejected"
  | "active_x_not_approved";

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
  active_x_required: "X ID を選択してから操作してください。",
  active_x_rejected:
    "選択中の X ID は却下されています。別の X ID を選択してください。",
  active_x_not_approved: "承認済みの X ID が必要です。",
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

export type WriteRequiredRole = "admin" | null;

/** Bounds for the approved linked X ID list folded into the user read. */
export const MAX_APPROVED_X_IDS = 100;
/** X IDs are <= 15 chars; 100 quoted ids + separators fit well under this. */
export const MAX_APPROVED_X_IDS_JSON_BYTES = 8192;

/** CURRENT WriteGuardOptions.requireActiveXId / requireApprovedActiveXId. */
export type WriteActiveXOptions = {
  requireActiveXId?: boolean;
  requireApprovedActiveXId?: boolean;
};

export type ActiveXRow = {
  activeXId: string | null;
  approvalStatus: string | null;
  approvedXIds: string[];
};

/**
 * CURRENT evaluateActiveXWriteAccess (domain) on the values the guard read.
 * Denials are HTTP 403 (CURRENT writeGuardHttpStatus default) and are applied
 * AFTER CostGuard to keep CURRENT order (identity -> CostGuard -> active X).
 */
export function evaluateActiveXAccess(
  options: WriteActiveXOptions,
  row: ActiveXRow,
) {
  return evaluateActiveXWriteAccess({
    requireActiveXId: options.requireActiveXId === true,
    requireApprovedActiveXId: options.requireApprovedActiveXId === true,
    activeXId: row.activeXId,
    approvalStatus: row.approvalStatus,
    approvedXIds: row.approvedXIds,
  });
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
  /**
   * CURRENT WriteGuardOptions.requiredRole: "admin" (default here) or none
   * (null = any authenticated user; banned / TOS checks still apply).
   */
  requiredRole?: WriteRequiredRole;
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
  const requiredRole: WriteRequiredRole =
    options.requiredRole === undefined ? "admin" : options.requiredRole;
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
    requiredRole === "admin" ? "admin" : undefined,
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
  activeX: WriteActiveXOptions | undefined = undefined,
): Promise<{
  is_tos_accepted: number;
  terms_reaccept_required: number;
  actor_snapshot_json: string;
  active_x: ActiveXRow | null;
} | null> {
  const needActive = Boolean(
    activeX?.requireActiveXId || activeX?.requireApprovedActiveXId,
  );
  // Folded into the same user read (no extra D1 query): approval_status of
  // the active X (users.active_x_user_id LEFT JOIN x_users) and, for
  // requireApprovedActiveXId, the approved linked X IDs as a JSON array
  // (CURRENT getApprovedXIds = x_user_account_links INNER JOIN x_users
  // WHERE approval_status = 'approved', distinct).
  const activeXColumns = !needActive
    ? ""
    : `,
         x."approval_status" AS x_approval_status${
           activeX?.requireApprovedActiveXId
             ? `,
         (SELECT json_group_array(approved."x_user_id") FROM (
            SELECT DISTINCT l."x_user_id" AS x_user_id
              FROM "x_user_account_links" l
              INNER JOIN "x_users" ax ON ax."id" = l."x_user_id"
             WHERE l."auth_user_id" = u."id" AND ax."approval_status" = 'approved'
             LIMIT ${MAX_APPROVED_X_IDS}
         ) approved) AS approved_x_ids_json`
             : ""
         }`;
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
         END AS terms_reaccept_required,
         u."discord_id" AS discord_id, u."name" AS discord_name,
         u."active_x_user_id" AS active_x_user_id, u."image" AS user_image,
         x."x_name" AS x_name, x."icon_url" AS x_icon_url${activeXColumns}
       FROM "user" u
       LEFT JOIN "x_users" x ON x."id" = u."active_x_user_id"
       WHERE u."id" = ?
       LIMIT ${MAX_SINGLE_ROW_LIMIT}`,
    )
    .bind(userId)
    .first<
      {
        is_tos_accepted: number | null;
        terms_reaccept_required: number | null;
        x_approval_status?: string | null;
        approved_x_ids_json?: string | null;
      } & ActorSnapshotRow
    >();

  if (!row) return null;
  let approvedXIds: string[] = [];
  if (row.approved_x_ids_json) {
    // Fail closed (caller maps a throw to 503 db_unavailable) before parsing
    // anything larger than the bounded list can be.
    if (row.approved_x_ids_json.length > MAX_APPROVED_X_IDS_JSON_BYTES) {
      throw new Error("approved_x_ids_too_large");
    }
    const parsed: unknown = JSON.parse(row.approved_x_ids_json);
    approvedXIds = Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  }
  return {
    active_x: needActive
      ? {
          activeXId: row.active_x_user_id ?? null,
          approvalStatus: row.x_approval_status ?? null,
          approvedXIds,
        }
      : null,
    is_tos_accepted: row.is_tos_accepted === 1 ? 1 : 0,
    terms_reaccept_required: row.terms_reaccept_required === 1 ? 1 : 0,
    // Same user row the audit actor snapshot needs: saves a second D1 read
    // (ZERO_1102 S3: at most 3 pre-reads).
    actor_snapshot_json: JSON.stringify(actorSnapshotFromRow(row)),
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
  /** Default "admin" (CURRENT requireAdminWrite). null = any authenticated user. */
  requiredRole?: WriteRequiredRole;
  /**
   * CURRENT requireActiveXId / requireApprovedActiveXId. Decided from the same
   * user read (no extra D1 query). Requires the CostGuard `feature`: the guard
   * evaluates CostGuard then active X itself (CURRENT order), so the check
   * cannot be skipped by forgetting costGuardMiddleware.
   */
  activeX?: WriteActiveXOptions & { feature: WriteFeatureKey };
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Apply a write-side middleware (origin / writeGuard / CostGuard) only to
 * mutating methods, so future admin GET reads mounted under the same router
 * are not blocked by write-only checks (they mount their own read guard).
 */
export function onlyMutating<M extends (c: Context, next: Next) => Promise<Response | void>>(
  middleware: M,
): (c: Context, next: Next) => Promise<Response | void> {
  return (c, next) =>
    SAFE_METHODS.has(c.req.method.toUpperCase()) ? next() : middleware(c, next);
}

/** Pure origin verification (no D1): CURRENT requireSameOriginWrite. */
function checkOrigin(
  c: Context,
  options: WriteGuardMiddlewareOptions,
): { originUnavailable: boolean; originOk: boolean } {
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
  const originOk =
    !originUnavailable &&
    configuredOrigin !== null &&
    requestHasSameOrigin(c.req.header("Origin") ?? null, configuredOrigin);
  return { originUnavailable, originOk };
}

/**
 * Origin-only middleware to mount BEFORE session resolution so a cross-origin
 * request never costs a D1 read (CURRENT checks origin first). Same 503/403
 * bodies as writeGuardMiddleware; writeGuardMiddleware repeats the (pure)
 * check so it stays safe when mounted alone.
 */
export function originGuardMiddleware(options: WriteGuardMiddlewareOptions) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const { originUnavailable, originOk } = checkOrigin(c, options);
    if (originUnavailable) {
      return writeGuardDenyResponse(c, "origin_verification_unavailable", 503);
    }
    if (!originOk) return writeGuardDenyResponse(c, "invalid_origin", 403);
    await next();
  };
}

/**
 * Hono middleware factory. Run after sessionMiddleware. Reads the "user"
 * variable, the D1 binding ("DB"), and the site URL per request.
 */
export function writeGuardMiddleware(options: WriteGuardMiddlewareOptions) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const { originUnavailable, originOk } = checkOrigin(c, options);

    const user = c.get("user") as SessionUser | null;
    const db = (c.env as { DB?: D1DatabaseLike }).DB;

    let actorSnapshotJson: string | undefined;
    let activeXRow: ActiveXRow | null = null;
    const outcome = await evaluateAdminWriteGuard({
      user,
      hasDb: db !== undefined,
      originOk,
      originUnavailable,
      sessionUnavailable: c.get("sessionState") === "unavailable",
      requiredRole: options.requiredRole,
      loadTosState:
        user && db
          ? async () => {
              const state = await loadTosState(db, user.id, options.activeX);
              actorSnapshotJson = state?.actor_snapshot_json;
              activeXRow = state?.active_x ?? null;
              return state;
            }
          : undefined,
    });
    if (!outcome.ok) {
      return writeGuardDenyResponse(c, outcome.reason, outcome.status);
    }
    // Active X (fail closed, independent of whether costGuardMiddleware is
    // mounted): CURRENT order identity -> CostGuard -> active X is evaluated
    // here, so an activeX route can never skip the check.
    const activeXState = activeXRow as ActiveXRow | null;
    if (options.activeX) {
      const feature = options.activeX.feature;
      if (!feature || !activeXState || !db) {
        return writeGuardDenyResponse(c, "cost_guard_blocked", 503);
      }
      const cost = await evaluateCostGuardWithSettings(
        db as unknown as D1Database,
        feature,
      );
      if (cost.denied) return writeGuardDenyResponse(c, cost.denied, 503);
      if (cost.auditSettings) c.set("auditSettings", cost.auditSettings);
      // costGuardMiddleware on the same route skips its (second) read.
      c.set("costGuardEvaluated", true);
      const activeXDeny = evaluateActiveXAccess(options.activeX, activeXState);
      if (activeXDeny) return writeGuardDenyResponse(c, activeXDeny, 403);
      c.set("activeX", {
        activeXId: activeXState.activeXId,
        approvedXIds: activeXState.approvedXIds,
      });
    }
    // Consumed by mutateWithAudit as the audit actor snapshot (no extra read).
    if (user && actorSnapshotJson !== undefined) {
      c.set("actorSnapshotJsonById", { [user.id]: actorSnapshotJson });
    }
    await next();
  };
}
