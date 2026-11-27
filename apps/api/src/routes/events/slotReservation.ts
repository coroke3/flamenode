/**
 * MIG-0657 U02/U03 (SA-065..068): Slot reserve / release / extend / merge Hono APIs.
 *
 * Mounted under `/api/events` in `apps/api/src/app.ts`. Each POST route uses its own
 * path-scoped write stack (origin -> session -> combined ToS/CostGuard -> db).
 * Public GET endpoints under `/api/events` never execute the write guards.
 */
import {
  isSlotOperatorOverrideRequested,
  SlotExtendBodySchema,
  SlotMergeBodySchema,
  SlotReleaseBodySchema,
  SlotReserveBodySchema,
  type SlotMutationResult,
} from "@flamenode/contracts";
import { evaluateCostGuardCore, WRITE_FEATURE_KEYS, type WriteFeatureKey } from "@flamenode/domain/admin";
import { actorSnapshotFromRow, type ActorSnapshotRow } from "@flamenode/server-core/audit/logger";
import { mapAuditSettings, type AuditSettingsRow } from "@flamenode/server-core/audit/settings";
import {
  extendSlotGroupCore,
  mergeSlotGroupsCore,
  releaseSlotCore,
  reserveSlotCore,
  type SlotMutationContext,
  type SlotMutationOutcome,
} from "@flamenode/server-core/slots/reservation";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { sessionMiddleware } from "../../auth/session.ts";
import type { AppEnv } from "../../env.ts";
import { dbMiddleware } from "../../middleware/db.ts";
import { MAX_SINGLE_ROW_LIMIT } from "../../lib/limits.ts";
import { evaluateAdminWriteGuard, originGuardMiddleware, writeGuardDenyResponse } from "../../middleware/writeOrigin.ts";
import { TERMS_REACCEPT_REQUIRED_CTE_SQL } from "../personal/context.ts";
import {
  auditPreloaded,
  BODY_TOO_LARGE_MESSAGE,
  MAX_ADMIN_JSON_BODY_BYTES,
  readAdminJsonBody,
} from "../admin/body.ts";

const GENERIC_FAILURE_MESSAGE =
  "枠の状態が変更されたか、安全な保存を完了できませんでした。画面を更新してもう一度お試しください。";

/**
 * SEC #716: actor/mode and audit scalars are bounded inside SQLite.
 * Feature-list JSON is validated and reduced to one per-feature state value
 * in SQLite, never returned in the D1 row. No persisted value is truncated;
 * invalid values are handled only at the stage that consumes them.
 */
const SLOT_GATE_ACTOR_TEXT = [
  ['u."discord_id"', 512],
  ['u."name"', 1024],
  ['u."active_x_user_id"', 512],
  ['u."image"', 2048],
  ['x."x_name"', 1024],
  ['x."icon_url"', 2048],
] as const;
const SLOT_GATE_NUMERIC_FIELDS = [
  'u."is_tos_accepted"',
  'settings."cost_guard_exception_until"',
  'settings."audit_normal_retention_days"',
  'settings."audit_restorable_retention_days"',
  'settings."audit_long_retention_days"',
  'settings."audit_max_payload_bytes"',
  'settings."audit_compact_after_days"',
] as const;
const SLOT_GATE_ALLOWED_FEATURE_SQL = WRITE_FEATURE_KEYS.map((key) => `'${key}'`).join(", ");

function invalidGateTextSql(column: string, maxBytes: number): string {
  return `(${column} IS NOT NULL AND
    (typeof(${column}) <> 'text' OR length(CAST(${column} AS BLOB)) > ${maxBytes}))`;
}
function boundedGateTextSql(column: string, maxBytes: number): string {
  return `CASE WHEN ${invalidGateTextSql(column, maxBytes)} THEN NULL ELSE ${column} END`;
}
function invalidGateNumberSql(column: string): string {
  return `typeof(${column}) NOT IN ('integer', 'real', 'null')`;
}
function boundedGateNumberSql(column: string): string {
  return `CASE WHEN ${invalidGateNumberSql(column)} THEN NULL ELSE ${column} END`;
}

/**
 * Return -1 for malformed/non-feature JSON, 0 for a valid list without this
 * feature, or 1 when it contains this feature. The 101-row cap proves the
 * same <=100 string-array contract as parseWriteFeatureList; duplicates,
 * escaped strings and legal whitespace retain JSON.parse semantics.
 */
function featureListStateSql(column: string, feature: WriteFeatureKey): string {
  return `CASE
    WHEN ${column} IS NULL OR ${column} = '' THEN 0
    WHEN typeof(${column}) <> 'text' THEN -1
    WHEN json_valid(${column}) <> 1 THEN -1
    WHEN json_type(${column}) <> 'array' THEN -1
    ELSE (
      SELECT CASE
        WHEN COUNT(*) > 100 THEN -1
        WHEN SUM(CASE WHEN item.type <> 'text'
                           OR item.value NOT IN (${SLOT_GATE_ALLOWED_FEATURE_SQL})
                      THEN 1 ELSE 0 END) > 0 THEN -1
        WHEN SUM(CASE WHEN item.type = 'text' AND item.value = '${feature}'
                      THEN 1 ELSE 0 END) > 0 THEN 1
        ELSE 0
      END
      FROM (SELECT type, value FROM json_each(${column}) LIMIT 101) AS item
    )
  END`;
}
const SLOT_GATE_INVALID_ACTOR_SQL = SLOT_GATE_ACTOR_TEXT
  .map(([column, maxBytes]) => invalidGateTextSql(column, maxBytes))
  .join(' OR ');
const SLOT_GATE_INVALID_AUDIT_SQL = SLOT_GATE_NUMERIC_FIELDS
  .filter((column) => column.startsWith('settings."audit_'))
  .map(invalidGateNumberSql)
  .join(' OR ');

/**
 * S3 #725: route-local one-statement ToS + CostGuard + audit actor gate.
 * Origin and Auth.js session are still checked FIRST by existing middleware.
 * published_at=0 is a valid latest major in the existing write guard.
 */
const SLOT_WRITE_GATE_SQL = `${TERMS_REACCEPT_REQUIRED_CTE_SQL}
 SELECT 1 AS slot_combined_write_gate,
   CASE WHEN ${invalidGateNumberSql('u."is_tos_accepted"')} THEN 1 ELSE 0 END AS invalid_identity_snapshot,
   CASE WHEN ${SLOT_GATE_INVALID_ACTOR_SQL} THEN 1 ELSE 0 END AS invalid_actor_snapshot,
   CASE WHEN ${invalidGateNumberSql('settings."cost_guard_exception_until')}
        THEN 1 ELSE 0 END AS invalid_exception_until,
   ${featureListStateSql('settings."cost_guard_exception_features_json', feature)} AS exception_feature_state,
   CASE WHEN ${invalidGateTextSql('settings."operation_mode"', 128)} THEN 1 ELSE 0 END AS invalid_operation_mode,
   ${featureListStateSql('settings."disabled_features_json', feature)} AS disabled_feature_state,
   CASE WHEN ${SLOT_GATE_INVALID_AUDIT_SQL} THEN 1 ELSE 0 END AS invalid_audit_settings,
   ${boundedGateNumberSql('u."is_tos_accepted"')} AS is_tos_accepted,
   CASE WHEN u."is_tos_accepted" = 1
         AND (SELECT "published_at" FROM required_major) IS NOT NULL
         AND NOT (
           EXISTS (
             SELECT 1 FROM "terms_versions" accepted_terms
             WHERE accepted_terms."id" = u."accepted_terms_version_id"
               AND accepted_terms."published_at" IS NOT NULL
               AND (accepted_terms."id" = (SELECT "id" FROM required_major)
                 OR accepted_terms."published_at" > (SELECT "published_at" FROM required_major))
           )
           OR EXISTS (
             SELECT 1 FROM "user_tos_consents" consent
             INNER JOIN "terms_versions" consent_terms ON consent_terms."id" = consent."terms_version_id"
             WHERE consent."user_id" = u."id"
               AND consent_terms."published_at" IS NOT NULL
               AND (consent_terms."id" = (SELECT "id" FROM required_major)
                 OR consent_terms."published_at" > (SELECT "published_at" FROM required_major))
           )
         ) THEN 1 ELSE 0 END AS terms_reaccept_required,
   ${boundedGateTextSql('u."discord_id"', 512)} AS discord_id, ${boundedGateTextSql('u."name"', 1024)} AS discord_name,
   ${boundedGateTextSql('u."active_x_user_id"', 512)} AS active_x_user_id, ${boundedGateTextSql('u."image"', 2048)} AS user_image,
   ${boundedGateTextSql('x."x_name"', 1024)} AS x_name, ${boundedGateTextSql('x."icon_url"', 2048)} AS x_icon_url,
   settings."id" AS settings_id, ${boundedGateTextSql('settings."operation_mode"', 128)} AS operation_mode,
   ${boundedGateNumberSql('settings."cost_guard_exception_until"')} AS cost_guard_exception_until,
   ${boundedGateNumberSql('settings."audit_normal_retention_days"')} AS audit_normal_retention_days,
   ${boundedGateNumberSql('settings."audit_restorable_retention_days"')} AS audit_restorable_retention_days,
   ${boundedGateNumberSql('settings."audit_long_retention_days"')} AS audit_long_retention_days,
   ${boundedGateNumberSql('settings."audit_max_payload_bytes"')} AS audit_max_payload_bytes,
   ${boundedGateNumberSql('settings."audit_compact_after_days"')} AS audit_compact_after_days
 FROM "user" u
 LEFT JOIN "x_users" x ON x."id" = u."active_x_user_id"
 LEFT JOIN "system_settings" settings ON settings."id" = 'default'
 WHERE u."id" = ?
 LIMIT ${MAX_SINGLE_ROW_LIMIT}`;

type SlotWriteGateRow = ActorSnapshotRow & AuditSettingsRow & {
  slot_combined_write_gate: number;
  invalid_identity_snapshot: number;
  invalid_actor_snapshot: number;
  invalid_exception_until: number;
  exception_feature_state: number;
  invalid_operation_mode: number;
  disabled_feature_state: number;
  invalid_audit_settings: number;
  is_tos_accepted: number | null;
  terms_reaccept_required: number | null;
  settings_id: string | null;
  operation_mode: string | null;
  cost_guard_exception_until: number | null;
};

function slotCombinedWriteGuard(feature: WriteFeatureKey): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    const sessionUnavailable = c.get("sessionState") === "unavailable";
    let db: D1Database | undefined;
    if (!sessionUnavailable && user) {
      try {
        db = c.env.DB;
      } catch {
        return writeGuardDenyResponse(c, "db_unavailable", 503);
      }
    }
    // A mutable holder retains the callback-loaded row across the awaited guard.
    const gate: { row: SlotWriteGateRow | null } = { row: null };
    const identity = await evaluateAdminWriteGuard({
      user,
      hasDb: db !== undefined,
      originOk: true, // checked by originGuardMiddleware before session lookup
      sessionUnavailable,
      requiredRole: null,
      loadTosState: user && db ? async () => {
        gate.row = await db.prepare(SLOT_WRITE_GATE_SQL).bind(user.id).first<SlotWriteGateRow>();
        return gate.row ? {
          is_tos_accepted: gate.row.is_tos_accepted === 1 ? 1 : 0,
          terms_reaccept_required: gate.row.terms_reaccept_required === 1 ? 1 : 0,
        } : null;
      } : undefined,
    });
    if (!identity.ok) return writeGuardDenyResponse(c, identity.reason, identity.status);
    const row = gate.row;
    if (row?.invalid_identity_snapshot === 1) {
      return writeGuardDenyResponse(c, "db_unavailable", 503);
    }
    if (!row || row.settings_id !== "default") {
      return writeGuardDenyResponse(c, "maintenance_mode", 503);
    }
    try {
      // Preserve evaluateCostGuardCore's order: validate the exception first;
      // a live matching exception bypasses mode and disabled features. The
      // SQL projection returns only the selected feature's state.
      if (row.invalid_exception_until === 1) {
        return writeGuardDenyResponse(c, "db_unavailable", 503);
      }
      const exceptionFeaturesJson = row.exception_feature_state < 0
        ? "!"
        : row.exception_feature_state === 1 ? JSON.stringify([feature]) : "[]";
      const disabledFeaturesJson = row.disabled_feature_state < 0
        ? "!"
        : row.disabled_feature_state === 1 ? JSON.stringify([feature]) : "[]";
      const cost = evaluateCostGuardCore({
        feature,
        operationMode: row.invalid_operation_mode === 1 ? null : row.operation_mode,
        disabledFeaturesJson,
        exceptionUntil: row.cost_guard_exception_until,
        exceptionFeaturesJson,
        now: Math.floor(Date.now() / 1000),
      });
      if (cost.blocked) {
        return writeGuardDenyResponse(c,
          cost.reason === "mode" ? "maintenance_mode" : "cost_guard_blocked", 503);
      }
      // Actor/audit values are consumed only after CostGuard admits the request.
      if (row.invalid_actor_snapshot === 1 || row.invalid_audit_settings === 1) {
        return writeGuardDenyResponse(c, "db_unavailable", 503);
      }
      c.set("auditSettings", mapAuditSettings(row));
      c.set("actorSnapshotJsonById", {
        [user!.id]: JSON.stringify(actorSnapshotFromRow(row)),
      });
    } catch {
      return writeGuardDenyResponse(c, "cost_guard_blocked", 503);
    }
    await next();
  };
}


function slotWriteStack(
  session: MiddlewareHandler<AppEnv> | undefined,
  feature: WriteFeatureKey,
): MiddlewareHandler<AppEnv> {
  const originOptions = (c: Context<AppEnv>) => ({
    loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
    allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
  });
  const stack: MiddlewareHandler<AppEnv>[] = [
    (c, next) => originGuardMiddleware(originOptions(c))(c, next),
    session ?? (sessionMiddleware() as unknown as MiddlewareHandler<AppEnv>),
    slotCombinedWriteGuard(feature),
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

function fail(
  c: Context<AppEnv>,
  status: 400 | 413 | 503,
  message: string,
) {
  const body: SlotMutationResult = { ok: false, message };
  return c.json(body, status);
}

// Provider exceptions are untrusted. Diagnostics must never change the HTTP outcome.
function slotMutationUnavailable(
  c: Context<AppEnv>,
  operation: "reserve" | "release" | "extend" | "merge",
) {
  try {
    console.error(`[slot-reservation] ${operation} failed`);
  } catch {
    // A diagnostic sink failure must not mask the fixed HTTP 503.
  }
  return fail(c, 503, GENERIC_FAILURE_MESSAGE);
}

function respond(c: Context<AppEnv>, outcome: SlotMutationOutcome) {
  const body: SlotMutationResult = outcome.body;
  return c.json(body, outcome.status);
}

function mutationContext(c: Context<AppEnv>): SlotMutationContext {
  const user = c.get("user")!;
  return {
    authUserId: user.id,
    activeXId: user.active_x_user_id ?? null,
    userRole: user.role ?? null,
    siteUrl: c.env.NEXT_PUBLIC_SITE_URL,
    preloaded: auditPreloaded(c),
  };
}

async function readOptionalJsonBody(
  request: Request,
): Promise<{ kind: "ok"; value: Record<string, unknown> } | { kind: "invalid" } | { kind: "too_large" }> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > MAX_ADMIN_JSON_BODY_BYTES) {
      return { kind: "too_large" };
    }
  }
  if (!request.body) return { kind: "ok", value: {} };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ADMIN_JSON_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { kind: "too_large" };
    }
    chunks.push(value);
  }
  if (total === 0) return { kind: "ok", value: {} };

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { kind: "ok", value: parsed as Record<string, unknown> }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

export function createSlotReservationRoutes(
  options: { session?: MiddlewareHandler<AppEnv> } = {},
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post(
    "/:eventId/slots/:slotId/reserve",
    slotWriteStack(options.session, "reserve_slot"),
    async (c) => {
      const eventId = (c.req.param("eventId") ?? "").trim();
      const slotId = (c.req.param("slotId") ?? "").trim();
      if (!eventId || !slotId) return fail(c, 400, "入力エラー");

      const input = await readAdminJsonBody(c.req.raw);
      if (input.kind === "too_large") return fail(c, 413, BODY_TOO_LARGE_MESSAGE);
      if (input.kind !== "ok") return fail(c, 400, "入力エラー");

      const parsed = SlotReserveBodySchema.safeParse(input.value);
      if (!parsed.success) {
        return fail(c, 400, parsed.error.issues[0]?.message ?? "入力エラー");
      }

      try {
        return respond(
          c,
          await reserveSlotCore(c.env.DB, c.get("db"), mutationContext(c), {
            eventId,
            slotId,
            display_name: parsed.data.display_name,
            consecutive_count: parsed.data.consecutive_count,
            operator_override: isSlotOperatorOverrideRequested(parsed.data.operator_override),
          }),
        );
      } catch {
        return slotMutationUnavailable(c, "reserve");
      }
    },
  );

  routes.post(
    "/:eventId/slots/:slotId/release",
    slotWriteStack(options.session, "release_slot"),
    async (c) => {
      const eventId = (c.req.param("eventId") ?? "").trim();
      const slotId = (c.req.param("slotId") ?? "").trim();
      if (!slotId) return fail(c, 400, "slot_id が必要です。");
      if (!eventId) return fail(c, 400, "入力エラー");

      const input = await readOptionalJsonBody(c.req.raw);
      if (input.kind === "too_large") return fail(c, 413, BODY_TOO_LARGE_MESSAGE);
      if (input.kind !== "ok") return fail(c, 400, "入力エラー");

      const parsed = SlotReleaseBodySchema.safeParse(input.value);
      if (!parsed.success) {
        return fail(c, 400, parsed.error.issues[0]?.message ?? "入力エラー");
      }

      try {
        return respond(
          c,
          await releaseSlotCore(c.env.DB, c.get("db"), mutationContext(c), { eventId, slotId }),
        );
      } catch {
        return slotMutationUnavailable(c, "release");
      }
    },
  );

  routes.post(
    "/:eventId/slots/:slotId/extend",
    slotWriteStack(options.session, "extend_slot_group"),
    async (c) => {
      const eventId = (c.req.param("eventId") ?? "").trim();
      const slotId = (c.req.param("slotId") ?? "").trim();
      if (!eventId || !slotId) return fail(c, 400, "入力エラー");

      const input = await readAdminJsonBody(c.req.raw);
      if (input.kind === "too_large") return fail(c, 413, BODY_TOO_LARGE_MESSAGE);
      if (input.kind !== "ok") return fail(c, 400, "入力エラー");

      const parsed = SlotExtendBodySchema.safeParse(input.value);
      if (!parsed.success) {
        return fail(c, 400, parsed.error.issues[0]?.message ?? "入力エラー");
      }

      try {
        return respond(
          c,
          await extendSlotGroupCore(c.env.DB, c.get("db"), mutationContext(c), {
            eventId,
            slotId,
            direction: parsed.data.direction,
            operator_override: isSlotOperatorOverrideRequested(parsed.data.operator_override),
          }),
        );
      } catch {
        return slotMutationUnavailable(c, "extend");
      }
    },
  );

  routes.post(
    "/:eventId/slot-groups/merge",
    slotWriteStack(options.session, "merge_slot_groups"),
    async (c) => {
      const eventId = (c.req.param("eventId") ?? "").trim();
      if (!eventId) return fail(c, 400, "入力エラー");

      const input = await readAdminJsonBody(c.req.raw);
      if (input.kind === "too_large") return fail(c, 413, BODY_TOO_LARGE_MESSAGE);
      if (input.kind !== "ok") return fail(c, 400, "入力エラー");

      const parsed = SlotMergeBodySchema.safeParse(input.value);
      if (!parsed.success) {
        return fail(c, 400, parsed.error.issues[0]?.message ?? "入力エラー");
      }

      try {
        return respond(
          c,
          await mergeSlotGroupsCore(c.env.DB, c.get("db"), mutationContext(c), {
            eventId,
            gap_slot_id: parsed.data.gap_slot_id,
            display_name: parsed.data.display_name,
            operator_override: isSlotOperatorOverrideRequested(parsed.data.operator_override),
          }),
        );
      } catch {
        return slotMutationUnavailable(c, "merge");
      }
    },
  );

  return routes;
}

export const slotReservationRoutes = createSlotReservationRoutes();
