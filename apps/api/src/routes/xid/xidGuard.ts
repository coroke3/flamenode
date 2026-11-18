/**
 * MIG-0636 shared one-read write guard for SA-098 and SA-102..105.
 * Combines user TOS, CostGuard settings, and actor snapshot into the route's
 * single preflight SELECT so real Auth.js sessions stay within S3 (<= 3 D1
 * pre-reads + 1 batch) without weakening strict actor-X audit validation.
 */
import type { Context, MiddlewareHandler } from "hono";
import { evaluateCostGuardCore } from "@flamenode/domain/admin";
import { actorSnapshotFromRow } from "@flamenode/server-core/audit/logger";
import { mapAuditSettings, type AuditSettingsRow } from "@flamenode/server-core/audit/settings";
import { sessionMiddleware, type SessionUser } from "../../auth/session.ts";
import type { AppEnv } from "../../env.ts";
import { dbMiddleware } from "../../middleware/db.ts";
import {
  evaluateAdminWriteGuard,
  originGuardMiddleware,
  writeGuardDenyResponse,
} from "../../middleware/writeOrigin.ts";
import {
  TERMS_REACCEPT_REQUIRED_CASE_SQL,
  TERMS_REACCEPT_REQUIRED_CTE_SQL,
} from "../personal/context.ts";

export { TERMS_REACCEPT_REQUIRED_CTE_SQL };

export type XIdCostGuardSettings = AuditSettingsRow & {
  operation_mode: string | null;
  disabled_features_json: string | null;
  cost_guard_exception_until: number | null;
  cost_guard_exception_features_json: string | null;
};

export type XIdGuardRowFields = {
  _auth_user_id: string;
  _is_tos_accepted: number | null;
  _terms_reaccept_required: number | null;
  _actor_discord_id: string | null;
  _actor_discord_name: string | null;
  _actor_active_x_user_id: string | null;
  _actor_user_image: string | null;
  _actor_x_name: string | null;
  _actor_x_icon_url: string | null;
  _cg_settings_id: string | null;
  _cg_operation_mode: string | null;
  _cg_disabled_features_json: string | null;
  _cg_cost_guard_exception_until: number | null;
  _cg_cost_guard_exception_features_json: string | null;
  _cg_audit_normal_retention_days: number | null;
  _cg_audit_restorable_retention_days: number | null;
  _cg_audit_long_retention_days: number | null;
  _cg_audit_max_payload_bytes: number | null;
  _cg_audit_compact_after_days: number | null;
};

export const XID_GUARD_COLUMNS_SQL = `
  u.id AS _auth_user_id,
  u.is_tos_accepted AS _is_tos_accepted,
  ${TERMS_REACCEPT_REQUIRED_CASE_SQL} AS _terms_reaccept_required,
  u.discord_id AS _actor_discord_id,
  u.name AS _actor_discord_name,
  u.active_x_user_id AS _actor_active_x_user_id,
  u.image AS _actor_user_image,
  active_x.x_name AS _actor_x_name,
  active_x.icon_url AS _actor_x_icon_url,
  settings.id AS _cg_settings_id,
  settings.operation_mode AS _cg_operation_mode,
  settings.disabled_features_json AS _cg_disabled_features_json,
  settings.cost_guard_exception_until AS _cg_cost_guard_exception_until,
  settings.cost_guard_exception_features_json AS _cg_cost_guard_exception_features_json,
  settings.audit_normal_retention_days AS _cg_audit_normal_retention_days,
  settings.audit_restorable_retention_days AS _cg_audit_restorable_retention_days,
  settings.audit_long_retention_days AS _cg_audit_long_retention_days,
  settings.audit_max_payload_bytes AS _cg_audit_max_payload_bytes,
  settings.audit_compact_after_days AS _cg_audit_compact_after_days
`;

export const XID_GUARD_JOINS_SQL = `
  LEFT JOIN x_users active_x ON active_x.id = u.active_x_user_id
  LEFT JOIN system_settings settings ON settings.id = 'default'
`;

export function stripXIdGuardFields<T extends XIdGuardRowFields>(
  row: T,
): {
  guard: XIdGuardRowFields;
  rest: Omit<T, keyof XIdGuardRowFields>;
} {
  const {
    _auth_user_id,
    _is_tos_accepted,
    _terms_reaccept_required,
    _actor_discord_id,
    _actor_discord_name,
    _actor_active_x_user_id,
    _actor_user_image,
    _actor_x_name,
    _actor_x_icon_url,
    _cg_settings_id,
    _cg_operation_mode,
    _cg_disabled_features_json,
    _cg_cost_guard_exception_until,
    _cg_cost_guard_exception_features_json,
    _cg_audit_normal_retention_days,
    _cg_audit_restorable_retention_days,
    _cg_audit_long_retention_days,
    _cg_audit_max_payload_bytes,
    _cg_audit_compact_after_days,
    ...rest
  } = row;
  return {
    guard: {
      _auth_user_id,
      _is_tos_accepted,
      _terms_reaccept_required,
      _actor_discord_id,
      _actor_discord_name,
      _actor_active_x_user_id,
      _actor_user_image,
      _actor_x_name,
      _actor_x_icon_url,
      _cg_settings_id,
      _cg_operation_mode,
      _cg_disabled_features_json,
      _cg_cost_guard_exception_until,
      _cg_cost_guard_exception_features_json,
      _cg_audit_normal_retention_days,
      _cg_audit_restorable_retention_days,
      _cg_audit_long_retention_days,
      _cg_audit_max_payload_bytes,
      _cg_audit_compact_after_days,
    },
    rest,
  };
}

export async function evaluateXIdGuardRow(
  c: Context<AppEnv>,
  sessionUser: SessionUser,
  guard: XIdGuardRowFields | null,
): Promise<Response | null> {
  const tos = guard
    ? {
        is_tos_accepted: guard._is_tos_accepted === 1 ? 1 : 0,
        terms_reaccept_required: guard._terms_reaccept_required === 1 ? 1 : 0,
      }
    : null;

  const outcome = await evaluateAdminWriteGuard({
    user: sessionUser,
    hasDb: true,
    originOk: true, // originGuardMiddleware ran before session.
    requiredRole: null,
    loadTosState: async () => tos,
  });
  if (!outcome.ok) {
    return writeGuardDenyResponse(c, outcome.reason, outcome.status);
  }
  if (!guard) {
    return writeGuardDenyResponse(c, "unauthenticated", 401);
  }
  if (guard._cg_settings_id == null) {
    return writeGuardDenyResponse(c, "maintenance_mode", 503);
  }

  const settings: XIdCostGuardSettings = {
    operation_mode: guard._cg_operation_mode ?? null,
    disabled_features_json: guard._cg_disabled_features_json ?? null,
    cost_guard_exception_until: guard._cg_cost_guard_exception_until ?? null,
    cost_guard_exception_features_json: guard._cg_cost_guard_exception_features_json ?? null,
    audit_normal_retention_days: guard._cg_audit_normal_retention_days!,
    audit_restorable_retention_days: guard._cg_audit_restorable_retention_days!,
    audit_long_retention_days: guard._cg_audit_long_retention_days!,
    audit_max_payload_bytes: guard._cg_audit_max_payload_bytes!,
    audit_compact_after_days: guard._cg_audit_compact_after_days!,
  };

  const cost = evaluateCostGuardCore({
    feature: "xid_links",
    operationMode: settings.operation_mode,
    disabledFeaturesJson: settings.disabled_features_json,
    exceptionUntil: settings.cost_guard_exception_until,
    exceptionFeaturesJson: settings.cost_guard_exception_features_json,
    now: Math.floor(Date.now() / 1000),
  });
  if (cost.blocked) {
    return writeGuardDenyResponse(
      c,
      cost.reason === "mode" ? "maintenance_mode" : "cost_guard_blocked",
      503,
    );
  }

  c.set("auditSettings", mapAuditSettings(settings));
  c.set("actorSnapshotJsonById", {
    [sessionUser.id]: JSON.stringify(
      actorSnapshotFromRow({
        discord_id: guard._actor_discord_id ?? null,
        discord_name: guard._actor_discord_name ?? null,
        active_x_user_id: guard._actor_active_x_user_id ?? null,
        user_image: guard._actor_user_image ?? null,
        x_name: guard._actor_x_name ?? null,
        x_icon_url: guard._actor_x_icon_url ?? null,
      }),
    ),
  });
  return null;
}

export function resolveXIdDb(c: Context<AppEnv>): D1Database | Response {
  try {
    const db = c.env?.DB;
    if (!db) return writeGuardDenyResponse(c, "db_unavailable", 503);
    return db;
  } catch {
    return writeGuardDenyResponse(c, "db_unavailable", 503);
  }
}

/**
 * Origin -> session -> authenticated check -> drizzle handle (0 extra D1 reads).
 * Individual SA-102..105 handlers then execute 1 combined TOS/CostGuard/X preflight
 * SELECT before calling mutateWithAudit.
 */
export function xidSessionStack(
  session?: MiddlewareHandler<AppEnv>,
): MiddlewareHandler<AppEnv> {
  const originOptions = (c: Context<AppEnv>) => ({
    loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
    // Never derived from NODE_ENV: only the explicit preview flag.
    allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
  });
  const authCheck: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.get("sessionState") === "unavailable") {
      return writeGuardDenyResponse(c, "database_unavailable", 503);
    }
    if (!c.get("user")) {
      return writeGuardDenyResponse(c, "unauthenticated", 401);
    }
    await next();
  };
  const stack: MiddlewareHandler<AppEnv>[] = [
    (c, next) => originGuardMiddleware(originOptions(c))(c, next),
    session ?? (sessionMiddleware() as unknown as MiddlewareHandler<AppEnv>),
    authCheck,
    dbMiddleware,
  ];
  return async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    const run = async (index: number): Promise<Response | void> => {
      if (index === stack.length) return next();
      let inner: Response | void = undefined;
      const own = await stack[index]!(c, async () => {
        inner = await run(index + 1);
      });
      return own ?? inner;
    };
    return run(0);
  };
}
