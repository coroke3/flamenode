/**
 * MIG-0636 U02 / SA-098: choose an approved, linked X identity.
 * CURRENT contract: src/lib/actions/xid.ts#setActiveXId.
 * No Next cache invalidation is required by the Hono API; browser clients
 * invalidate their session display after a successful response.
 */
import { SetActiveXBodySchema } from "@flamenode/contracts";
import { normalizeXId } from "@flamenode/domain/xid";
import { evaluateCostGuardCore } from "@flamenode/domain/admin";
import { mapAuditSettings, type AuditSettingsRow } from "@flamenode/server-core/audit/settings";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { sql } from "@flamenode/server-core/sql";
import { Hono } from "hono";
import { actorSnapshotFromRow } from "@flamenode/server-core/audit/logger";
import { evaluateAdminWriteGuard, writeGuardDenyResponse } from "../../middleware/writeOrigin.ts";
import { dbMiddleware } from "../../middleware/db.ts";
import {
  TERMS_REACCEPT_REQUIRED_CTE_SQL,
  TERMS_REACCEPT_REQUIRED_CASE_SQL,
} from "../personal/context.ts";

import type { AppEnv } from "../../env.ts";
import { auditPreloaded } from "../admin/body.ts";
import { limitXIdActionBody } from "../../middleware/bodyLimit.ts";

const USER_NOT_FOUND = "ユーザーが見つかりません。";
const LINK_NOT_FOUND = "この X ID は現在のアカウントに紐づいていません。";
const NOT_APPROVED = "承認済みの X ID だけをアクティブにできます。";
const MUTATION_FAILED = "アクティブ X ID の変更に失敗しました。再読み込みしてお試しください。";

type RawUserRow = Record<string, string | number | null> & {
  id: string;
  active_x_user_id: string | null;
  linked_approval_status?: string | null;
  resolved_x_user_id?: string | null;
  derived_terms_reaccept_required?: number | null;
  actor_x_name?: string | null;
  actor_x_icon_url?: string | null;
  cg_settings_id?: string | null;
  cg_operation_mode?: string | null;
  cg_disabled_features_json?: string | null;
  cg_cost_guard_exception_until?: number | null;
  cg_cost_guard_exception_features_json?: string | null;
  cg_audit_normal_retention_days?: number | null;
  cg_audit_restorable_retention_days?: number | null;
  cg_audit_long_retention_days?: number | null;
  cg_audit_max_payload_bytes?: number | null;
  cg_audit_compact_after_days?: number | null;
};

type XidCostGuardSettings = AuditSettingsRow & {
  operation_mode: string | null;
  disabled_features_json: string | null;
  cost_guard_exception_until: number | null;
  cost_guard_exception_features_json: string | null;
};

/**
 * One read for CURRENT user snapshot and the selected linked-X approval.
 * An X alias resolves to the same canonical linked row as CURRENT
 * getLinkedXUserForAuthUser. Do not treat X ownership as authorization
 * without requiring the exact authenticated user link.
 */
async function loadSelectedIdentity(
  db: D1Database,
  authUserId: string,
  requestedXId: string,
): Promise<{
  user: Record<string, unknown>;
  linkedApproval: string | null;
  canonicalXId: string | null;
  tos: { is_tos_accepted: number; terms_reaccept_required: number };
  actorSnapshotJson: string;
  costGuardSettings: XidCostGuardSettings | null;
} | null> {
  // Identical fail-closed alias/direct collision policy to
  // @flamenode/domain/xid#decideCanonicalXUserResolution, in one D1 read.
  const row = await db.prepare(`
    ${TERMS_REACCEPT_REQUIRED_CTE_SQL},
    direct_matches AS (
      SELECT lower(trim(ltrim(trim(id), '@'))) AS normalized_id,
             approval_status
      FROM x_users
      WHERE lower(trim(ltrim(trim(id), '@'))) = ?
    ),
    alias_matches AS (
      SELECT lower(trim(ltrim(trim(target.id), '@'))) AS target_id,
             target.approval_status AS target_status
      FROM x_user_aliases a
      LEFT JOIN x_users target
        ON lower(trim(ltrim(trim(target.id), '@'))) =
           lower(trim(ltrim(trim(a.x_user_id), '@')))
      WHERE lower(trim(ltrim(trim(a.alias_x_id), '@'))) = ?
    ),
    facts AS (
      SELECT
        (SELECT COUNT(*) FROM direct_matches) AS direct_count,
        (SELECT normalized_id FROM direct_matches LIMIT 1) AS direct_id,
        (SELECT approval_status FROM direct_matches LIMIT 1) AS direct_status,
        (SELECT COUNT(*) FROM alias_matches) AS alias_count,
        (SELECT COUNT(DISTINCT target_id) FROM alias_matches) AS alias_target_count,
        (SELECT COUNT(*) FROM alias_matches WHERE target_id IS NULL OR
          (target_status IS NULL OR target_status NOT IN ('pending','approved','imported'))) AS invalid_alias_count,
        (SELECT target_id FROM alias_matches LIMIT 1) AS alias_target_id
    ),
    resolved AS (
      SELECT CASE
        WHEN direct_count > 1 THEN NULL
        WHEN alias_count > 0 THEN CASE
          WHEN invalid_alias_count > 0 OR alias_target_count <> 1
            OR (direct_count = 1 AND direct_status IN ('pending','approved','imported')
                AND direct_id <> alias_target_id)
          THEN NULL ELSE alias_target_id END
        WHEN direct_count = 1 AND direct_status IN ('pending','approved','imported')
        THEN direct_id ELSE NULL
      END AS canonical_id
      FROM facts
    )
    SELECT u.*,
      ${TERMS_REACCEPT_REQUIRED_CASE_SQL} AS derived_terms_reaccept_required,
      active_x.x_name AS actor_x_name,
      active_x.icon_url AS actor_x_icon_url,
      settings.id AS cg_settings_id,
      settings.operation_mode AS cg_operation_mode,
      settings.disabled_features_json AS cg_disabled_features_json,
      settings.cost_guard_exception_until AS cg_cost_guard_exception_until,
      settings.cost_guard_exception_features_json AS cg_cost_guard_exception_features_json,
      settings.audit_normal_retention_days AS cg_audit_normal_retention_days,
      settings.audit_restorable_retention_days AS cg_audit_restorable_retention_days,
      settings.audit_long_retention_days AS cg_audit_long_retention_days,
      settings.audit_max_payload_bytes AS cg_audit_max_payload_bytes,
      settings.audit_compact_after_days AS cg_audit_compact_after_days,
      (SELECT canonical_id FROM resolved) AS resolved_x_user_id,
      (SELECT x.approval_status FROM x_user_account_links l
       INNER JOIN x_users x ON x.id = l.x_user_id
       CROSS JOIN resolved r
       WHERE l.auth_user_id = u.id
         AND lower(trim(ltrim(trim(l.x_user_id), '@'))) = r.canonical_id
       LIMIT 1) AS linked_approval_status
    FROM "user" u
    LEFT JOIN x_users active_x ON active_x.id = u.active_x_user_id
    LEFT JOIN system_settings settings ON settings.id = 'default'
    WHERE u.id = ? LIMIT 1
  `).bind(requestedXId, requestedXId, authUserId).first<RawUserRow>();

  if (!row) return null;
  const {
    linked_approval_status, resolved_x_user_id, derived_terms_reaccept_required,
    actor_x_name, actor_x_icon_url,
    cg_settings_id, cg_operation_mode, cg_disabled_features_json,
    cg_cost_guard_exception_until, cg_cost_guard_exception_features_json,
    cg_audit_normal_retention_days, cg_audit_restorable_retention_days,
    cg_audit_long_retention_days, cg_audit_max_payload_bytes, cg_audit_compact_after_days,
    ...user
  } = row;
  // Drizzle timestamp_ms columns are Date objects in CURRENT select().
  if (typeof user.emailVerified === "number") {
    (user as Record<string, unknown>).emailVerified = new Date(user.emailVerified);
  }
  return {
    user,
    // Missing settings is maintenance mode; never manufacture normal settings.
    // This is the SAME D1 read as the user/link/TOS snapshot, not a fourth
    // session + identity + CostGuard + strict audit preflight.
    costGuardSettings: cg_settings_id == null ? null : {
      operation_mode: cg_operation_mode ?? null,
      disabled_features_json: cg_disabled_features_json ?? null,
      cost_guard_exception_until: cg_cost_guard_exception_until ?? null,
      cost_guard_exception_features_json: cg_cost_guard_exception_features_json ?? null,
      audit_normal_retention_days: cg_audit_normal_retention_days!,
      audit_restorable_retention_days: cg_audit_restorable_retention_days!,
      audit_long_retention_days: cg_audit_long_retention_days!,
      audit_max_payload_bytes: cg_audit_max_payload_bytes!,
      audit_compact_after_days: cg_audit_compact_after_days!,
    },
    linkedApproval: linked_approval_status ?? null,
    canonicalXId: resolved_x_user_id ?? null,
    tos: {
      is_tos_accepted: user.is_tos_accepted === 1 ? 1 : 0,
      terms_reaccept_required: derived_terms_reaccept_required === 1 ? 1 : 0,
    },
    actorSnapshotJson: JSON.stringify(actorSnapshotFromRow({
      discord_id: typeof user.discord_id === "string" ? user.discord_id : null,
      discord_name: typeof user.name === "string" ? user.name : null,
      active_x_user_id: typeof user.active_x_user_id === "string" ? user.active_x_user_id : null,
      user_image: typeof user.image === "string" ? user.image : null,
      x_name: actor_x_name ?? null,
      x_icon_url: actor_x_icon_url ?? null,
    })),
  };
}

/**
 * SA-098 one-read guard: trusted origin and resolved session were verified
 * by the parent router, and the single SELECT supplies the user/TOS snapshot,
 * canonical linked X authorization and exact audit actor snapshot. Together
 * with CostGuard and strict audit actor-X validation this stays at 3 D1
 * pre-reads (MIG-0636 S3) without weakening the audit.
 */
export const activeXRoutes = new Hono<AppEnv>();
activeXRoutes.post("/", limitXIdActionBody("SA-098"), async (c, next) => {
  const sessionUser = c.get("user");
  if (c.get("sessionState") === "unavailable") {
    return writeGuardDenyResponse(c, "database_unavailable", 503);
  }
  if (!sessionUser) return writeGuardDenyResponse(c, "unauthenticated", 401);
  // A Worker D1 binding getter can synchronously throw provider-specific
  // exceptions. Resolve once and reuse the same validated binding for both
  // the identity and CostGuard reads; never leak the exception to Hono.
  let db: D1Database | undefined;
  try {
    db = c.env?.DB;
  } catch {
    return writeGuardDenyResponse(c, "db_unavailable", 503);
  }
  if (!db) return writeGuardDenyResponse(c, "db_unavailable", 503);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ ok: false, message: "入力内容を確認してください。" }, 400);
  }
  const parsed = SetActiveXBodySchema.safeParse(raw);
  const xUserId = parsed.success ? normalizeXId(parsed.data.x_user_id) : "";
  if (!xUserId) return c.json({ ok: false, message: "X ID が指定されていません。" }, 400);

  let selected: Awaited<ReturnType<typeof loadSelectedIdentity>>;
  try {
    selected = await loadSelectedIdentity(db, sessionUser.id, xUserId);
  } catch {
    return writeGuardDenyResponse(c, "db_unavailable", 503);
  }

  const outcome = await evaluateAdminWriteGuard({
    user: sessionUser,
    hasDb: true,
    originOk: true, // Parent originGuardMiddleware ran before session.
    requiredRole: null,
    loadTosState: async () => selected?.tos ?? null,
  });
  if (!outcome.ok) return writeGuardDenyResponse(c, outcome.reason, outcome.status);
  if (!selected) return c.json({ ok: false, message: USER_NOT_FOUND }, 404);

  // CostGuard uses the settings returned in the identity SELECT. Retain the
  // same domain core and audit retention mapping as costGuardMiddleware;
  // strict actor-X pair validation still runs in mutateWithAudit.
  if (!selected.costGuardSettings) {
    return writeGuardDenyResponse(c, "maintenance_mode", 503);
  }
  const cost = evaluateCostGuardCore({
    feature: "xid_links",
    operationMode: selected.costGuardSettings.operation_mode,
    disabledFeaturesJson: selected.costGuardSettings.disabled_features_json,
    exceptionUntil: selected.costGuardSettings.cost_guard_exception_until,
    exceptionFeaturesJson: selected.costGuardSettings.cost_guard_exception_features_json,
    now: Math.floor(Date.now() / 1000),
  });
  if (cost.blocked) {
    return writeGuardDenyResponse(c,
      cost.reason === "mode" ? "maintenance_mode" : "cost_guard_blocked", 503);
  }
  c.set("auditSettings", mapAuditSettings(selected.costGuardSettings));
  if (!selected.canonicalXId || !selected.linkedApproval) {
    return c.json({ ok: false, message: LINK_NOT_FOUND }, 403);
  }
  if (selected.linkedApproval !== "approved") {
    return c.json({ ok: false, message: NOT_APPROVED }, 403);
  }

  c.set("actorSnapshotJsonById", { [sessionUser.id]: selected.actorSnapshotJson });
  c.set("xidSelected", { before: selected.user, canonicalXId: selected.canonicalXId });
  await next();
}, dbMiddleware, async (c) => {
  const userId = c.get("user")!.id;
  const { before, canonicalXId } = c.get("xidSelected");
  if (normalizeXId(before.active_x_user_id as string | null) === canonicalXId) {
    return c.json({ ok: true, message: "すでにこの X ID がアクティブです。" });
  }

  const after = { ...before, active_x_user_id: canonicalXId };
  try {
    await mutateWithAudit(c.get("db"), {
      mutationStatements: [
        c.get("db").run(sql`UPDATE "user" SET active_x_user_id = ${canonicalXId}
          WHERE id = ${userId} AND (${expectedRowCondition({ expectedCurrent: before })})`),
      ],
      expectedMutationChanges: [1],
      preloaded: auditPreloaded(c),
      audits: [{
        table_name: "user",
        target_id: userId,
        operation: "UPDATE",
        before: { ...before },
        after: { ...after },
        actor_user_id: userId,
        actor_x_user_id: canonicalXId,
        retention_class: "normal",
      }],
    });
  } catch {
    return c.json({ ok: false, message: MUTATION_FAILED }, 500);
  }
  return c.json({ ok: true, message: "アクティブ X ID を切り替えました。" });
});
