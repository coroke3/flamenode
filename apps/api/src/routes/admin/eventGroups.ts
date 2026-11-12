/**
 * MIG-0653 U02: SA-025 event-group membership candidate search.
 *
 * Mounted on the Draft branch under createAdminRoutes after #476/#480 merged.
 * The parent supplies the session/admin read guard; the handler additionally
 * enforces CURRENT's write-side ToS/CostGuard within S2's D1 query budget.
 *
 * CURRENT: src/lib/admin/eventGroupEventOptions.ts. Keep its 80-row cursor,
 * NOT EXISTS membership filter, escaped LIKE and updated_at/id ordering.
 */
import { Hono } from "hono";
import { assertCondition, mutateWithAudit, planAtomicAuditMutationBudget } from "@flamenode/server-core/audit/mutate";
import { sql } from "@flamenode/server-core/sql";
import { buildEventGroupChangeQueueBatch } from "@flamenode/server-core/staticRebuild/hooks";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "./body.ts";
import { mapAuditSettings, type AuditSettingsRow } from "@flamenode/server-core/audit/settings";
import { writeGuardDenyResponse } from "../../middleware/writeOrigin.ts";
import type { AppEnv } from "../../env.ts";
import { adminReadGuardMiddleware } from "../../middleware/adminReadGuard.ts";
import { evaluateAdminWriteGuard } from "../../middleware/writeOrigin.ts";
import { evaluateCostGuardCore } from "@flamenode/domain/admin";
import { MAX_SINGLE_ROW_LIMIT } from "../../lib/limits.ts";
import { planD1AuditMutationBudget } from "@flamenode/server-core/audit/mutateBudget";
import { EventGroupMutationBodySchema } from "@flamenode/contracts";
import { generateId } from "@flamenode/server-core/id";
import {
  buildPublicVisibilityFenceUpsertStatement,
  preCommitPublicVisibilityFence,
  compensatePublicVisibilityFenceOnD1Failure,
} from "@flamenode/server-core/visibility/fenceTransition";
import {
  readVisibilityManifestObject,
  putVisibilityManifestWithCas,
  type VisibilityManifestBucket,
} from "@flamenode/server-core/visibility/manifestR2";

export const EVENT_GROUP_OPTION_PAGE_SIZE = 80;
/** Bound legacy identifiers without rejecting ordinary long-ID pagination. */
export const MAX_EVENT_GROUP_ID_LENGTH = 128;
const SEARCH_FAILED = "イベント候補の取得に失敗しました。もう一度お試しください。";

export type EventGroupOption = {
  id: string;
  title: string;
  start_time: number | null;
};
type OptionRow = EventGroupOption & { updated_at: number };
type Cursor = { updatedAt: number; id: string };

export function parseEventGroupOptionCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  if (raw.length > 200) throw new Error("event_group_cursor_invalid");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("event_group_cursor_invalid");
  }
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as Cursor).updatedAt !== "number" ||
    !Number.isSafeInteger((value as Cursor).updatedAt) ||
    typeof (value as Cursor).id !== "string" ||
    !(value as Cursor).id
  ) {
    throw new Error("event_group_cursor_invalid");
  }
  return value as Cursor;
}

export function escapeEventGroupLikeTerm(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

/** CURRENT's write identity + feature gate, folded into one D1 read for S2.
 * S4 session (1) + combined guard (1) + candidate page (1) = 3 D1 statements.
 * The major-terms CASE mirrors loadTosState in middleware/writeOrigin.ts.
 */
const EVENT_GROUP_ADMIN_GATE_SQL = `
WITH latest_major AS (
  SELECT "id", "published_at" FROM "terms_versions"
  WHERE "severity" = 'major' AND "published_at" IS NOT NULL
  ORDER BY "published_at" DESC, "updated_at" DESC LIMIT 1
)
SELECT
  u."is_tos_accepted" AS is_tos_accepted,
  CASE
    WHEN u."is_tos_accepted" = 1 AND major."published_at" IS NOT NULL AND NOT (
      EXISTS (
        SELECT 1 FROM "terms_versions" accepted_terms
        WHERE accepted_terms."id" = u."accepted_terms_version_id"
          AND accepted_terms."published_at" IS NOT NULL
          AND (
            accepted_terms."id" = major."id"
            OR accepted_terms."published_at" > major."published_at"
          )
      )
      OR EXISTS (
        SELECT 1 FROM "user_tos_consents" consent
        INNER JOIN "terms_versions" consent_terms
          ON consent_terms."id" = consent."terms_version_id"
        WHERE consent."user_id" = u."id"
          AND consent_terms."published_at" IS NOT NULL
          AND (
            consent_terms."id" = major."id"
            OR consent_terms."published_at" > major."published_at"
          )
      )
    ) THEN 1 ELSE 0
  END AS terms_reaccept_required,
  s."operation_mode" AS operation_mode,
  s."disabled_features_json" AS disabled_features_json,
  s."cost_guard_exception_until" AS cost_guard_exception_until,
  s."cost_guard_exception_features_json" AS cost_guard_exception_features_json
FROM "user" u
LEFT JOIN latest_major major ON 1 = 1
LEFT JOIN "system_settings" s ON s."id" = 'default'
WHERE u."id" = ?
LIMIT ${MAX_SINGLE_ROW_LIMIT}
`;
type AdminEventGroupGateRow = {
  is_tos_accepted: number | null;
  terms_reaccept_required: number | null;
  operation_mode: string | null;
  disabled_features_json: string | null;
  cost_guard_exception_until: number | null;
  cost_guard_exception_features_json: string | null;
};

export const adminEventGroupOptionsRoutes = new Hono<AppEnv>();

adminEventGroupOptionsRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  return adminReadGuardMiddleware()(c, next);
});

adminEventGroupOptionsRoutes.get("/event-options", async (c) => {
  // CURRENT SA-025 calls requireAdminWrite("admin_event_create") even for a
  // candidate read. The enclosing admin GET guard alone omits ToS/CostGuard.
  const user = c.get("user");
  if (!user) return c.json({ ok: false, message: SEARCH_FAILED }, 401);
  let db: D1Database;
  try {
    db = c.env.DB;
  } catch {
    return c.json({ ok: false, message: SEARCH_FAILED }, 503);
  }
  // CURRENT guards must run before candidate SQL, but two separate guard
  // reads plus S4 and the page would exceed ZERO_1102 S2's 3-statement cap.
  // Validate untrusted input before the D1 guard query. The actual permission,
  // ToS and CostGuard checks still precede every candidate SELECT.
  const groupId = (c.req.query("groupId") ?? "").trim();
  const query = (c.req.query("q") ?? "").trim();
  let cursor: Cursor | null;
  try {
    if (!groupId || query.length > 64) {
      throw new Error("event_group_search_invalid");
    }
    cursor = parseEventGroupOptionCursor(c.req.query("cursor") ?? null);
  } catch {
    return c.json({ ok: false, message: SEARCH_FAILED }, 400);
  }
  let gate: AdminEventGroupGateRow | null;
  try {
    gate = await db.prepare(EVENT_GROUP_ADMIN_GATE_SQL).bind(user.id).first<AdminEventGroupGateRow>();
  } catch {
    return c.json({ ok: false, message: SEARCH_FAILED }, 503);
  }
  const identity = await evaluateAdminWriteGuard({
    user,
    hasDb: Boolean(db),
    originOk: true, // HTTP GET does not require a mutating-action Origin header.
    requiredRole: "admin",
    loadTosState: async () => gate ? {
      is_tos_accepted: gate.is_tos_accepted === 1 ? 1 : 0,
      terms_reaccept_required: gate.terms_reaccept_required === 1 ? 1 : 0,
    } : null,
  });
  if (!identity.ok) {
    return c.json({ ok: false, message: SEARCH_FAILED }, identity.status);
  }
  if (!gate || evaluateCostGuardCore({
    feature: "admin_event_create",
    operationMode: gate.operation_mode,
    disabledFeaturesJson: gate.disabled_features_json,
    exceptionUntil: gate.cost_guard_exception_until,
    exceptionFeaturesJson: gate.cost_guard_exception_features_json,
    now: Math.floor(Date.now() / 1000),
  }).blocked) {
    return c.json({ ok: false, message: SEARCH_FAILED }, 503);
  }
  const conditions = [
    "NOT EXISTS (SELECT 1 FROM event_group_events m WHERE m.event_group_id = ? AND m.event_id = e.id)",
  ];
  const params: Array<string | number> = [groupId];
  if (query) {
    conditions.push("e.title LIKE ? ESCAPE '\\'");
    params.push("%" + escapeEventGroupLikeTerm(query) + "%");
  }
  if (cursor) {
    conditions.push("(e.updated_at < ? OR (e.updated_at = ? AND e.id > ?))");
    params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }
  const statement = [
    "SELECT e.id, e.title, e.start_time, e.updated_at FROM events e",
    "WHERE " + conditions.join(" AND "),
    "ORDER BY e.updated_at DESC, e.id ASC LIMIT ?",
  ].join(" ");
  try {
    const { results } = await db.prepare(statement)
      .bind(...params, EVENT_GROUP_OPTION_PAGE_SIZE + 1)
      .all<OptionRow>();
    const page = results.slice(0, EVENT_GROUP_OPTION_PAGE_SIZE);
    const last = page.at(-1);
    const hasMore = results.length > EVENT_GROUP_OPTION_PAGE_SIZE;
    const nextCursor = hasMore && last
      ? JSON.stringify({ updatedAt: last.updated_at, id: last.id })
      : null;
    return c.json({
      ok: true,
      options: page.map(({ id, title, start_time }) => ({ id, title, start_time })),
      nextCursor,
    });
  } catch {
    // No bound values, SQL details or user information leave the API on D1 failure.
    return c.json({ ok: false, message: SEARCH_FAILED }, 503);
  }
});

/**
 * MIG-0653 U03 pure pre-mutation planners; no D1, audit, queue or fence writes.
 * These must be called only after EventGroupMutationBodySchema validation.
 * The caller remains responsible for guarded atomic mutation and full audit.
 */
export type ValidEventGroupMutation = import("@flamenode/contracts").EventGroupMutationBody;
export type EventGroupCreateValues = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  group_type: ValidEventGroupMutation["group_type"];
  icon_url: string | null;
  img_url: null;
  accent_color: string | null;
  visibility_status: ValidEventGroupMutation["visibility_status"];
  sort_order: number;
  created_at: number;
  updated_at: number;
};
export type EventGroupUpdateValues = Omit<EventGroupCreateValues,
  "id" | "img_url" | "created_at">;

function optionalGroupText(raw: string | null | undefined): string | null {
  return raw?.trim() || null;
}

/** Exact CURRENT createEventGroup projection; img_url is intentionally null. */
export function planEventGroupCreateValues(
  data: ValidEventGroupMutation, id: string, now: number,
): EventGroupCreateValues {
  return {
    id,
    name: data.name,
    slug: data.slug,
    description: optionalGroupText(data.description),
    group_type: data.group_type,
    icon_url: optionalGroupText(data.icon_url),
    img_url: null,
    accent_color: optionalGroupText(data.accent_color),
    visibility_status: data.visibility_status,
    sort_order: data.sort_order ?? 0,
    created_at: now,
    updated_at: now,
  };
}

/**
 * CURRENT updateEventGroup projection: never update img_url; absent sort_order
 * preserves the stored value, and monotonic updated_at provides CAS freshness.
 */
export function planEventGroupUpdateValues(
  data: ValidEventGroupMutation,
  previous: { sort_order: number; updated_at: number },
  now: number,
): EventGroupUpdateValues {
  return {
    name: data.name,
    slug: data.slug,
    description: optionalGroupText(data.description),
    group_type: data.group_type,
    icon_url: optionalGroupText(data.icon_url),
    accent_color: optionalGroupText(data.accent_color),
    visibility_status: data.visibility_status,
    sort_order: data.sort_order ?? previous.sort_order,
    updated_at: Math.max(now, previous.updated_at + 1),
  };
}

/**
 * CURRENT SA-026/027 write preflight is separate from parsing and payload
 * projection. Keep the exact business failure messages outside the D1 layer.
 * A caller must still enforce admin write authorization, current ToS/CostGuard,
 * uniqueness and visibility fence, before constructing the atomic audit batch.
 */
export type EventGroupWritePreflight =
  | { ok: true }
  | { ok: false; message: string };

export function requireEventGroupMutationId(data: ValidEventGroupMutation): EventGroupWritePreflight {
  return data.id?.trim()
    ? { ok: true }
    : { ok: false, message: "ID が必要です。" };
}

/**
 * Detect CURRENT's optimistic concurrency mismatch before constructing a write.
 * It is NOT a replacement for the D1 UPDATE WHERE id/updated_at CAS and
 * expected-changes assertion, which must still execute atomically with audit.
 */
export function checkEventGroupUpdateCas(
  expectedUpdatedAt: number | null | undefined,
  existingUpdatedAt: number,
): EventGroupWritePreflight {
  return expectedUpdatedAt != null && expectedUpdatedAt === existingUpdatedAt
    ? { ok: true }
    : { ok: false, message: "他の操作で更新されています。再読み込みして確認してください。" };
}

/** CURRENT detects duplicate slugs using a read before the atomic mutation. */
export function checkEventGroupSlugAvailable(available: boolean): EventGroupWritePreflight {
  return available
    ? { ok: true }
    : { ok: false, message: "このスラッグは既に使われています。" };
}

/**
 * MIG-0653 U04: input-only membership normalization from CURRENT
 * addEventsToGroup/removeEventFromGroup. Authorization, D1 group existence,
 * valid-event existence, relation CAS, audit and queue remain mandatory
 * responsibilities of future fully guarded handlers.
 */
export const EVENT_GROUP_ADD_MAX = 80;

export type EventGroupMembershipInput =
  | { ok: true; groupId: string; eventIds: string[] }
  | { ok: false; message: string };

export function normalizeEventGroupMembershipAdd(input: unknown): EventGroupMembershipInput {
  const raw = input !== null && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const groupId = typeof raw.groupId === "string" ? raw.groupId.trim() : "";
  const rawIds = Array.isArray(raw.eventIds) ? raw.eventIds : [];
  // Preserve CURRENT's limit on distinct normalized IDs while avoiding
  // filter/map intermediate arrays. Stop as soon as the unique-ID cap is
  // exceeded; duplicate IDs remain compatible with CURRENT de-duplication.
  const uniqueEventIds = new Set<string>();
  for (const rawId of rawIds) {
    if (typeof rawId !== "string") continue;
    const id = rawId.trim();
    if (!id) continue;
    uniqueEventIds.add(id);
    if (uniqueEventIds.size > EVENT_GROUP_ADD_MAX) {
      return {
        ok: false,
        message: `一度に追加できるイベントは${EVENT_GROUP_ADD_MAX}件までです。分けて実行してください。`,
      };
    }
  }
  const eventIds = [...uniqueEventIds];
  if (eventIds.length > EVENT_GROUP_ADD_MAX) {
    return {
      ok: false,
      message: `一度に追加できるイベントは${EVENT_GROUP_ADD_MAX}件までです。分けて実行してください。`,
    };
  }
  if (!groupId || eventIds.length === 0) {
    return { ok: false, message: "追加するイベントを選択してください。" };
  }
  return { ok: true, groupId, eventIds };
}

export type EventGroupMembershipRemoveInput =
  | { ok: true; groupId: string; eventId: string }
  | { ok: false; message: string };

export function normalizeEventGroupMembershipRemove(input: unknown): EventGroupMembershipRemoveInput {
  const raw = input !== null && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const groupId = typeof raw.groupId === "string" ? raw.groupId.trim() : "";
  const eventId = typeof raw.eventId === "string" ? raw.eventId.trim() : "";
  if (!groupId || !eventId) {
    return { ok: false, message: "グループとイベントを指定してください。" };
  }
  return { ok: true, groupId, eventId };
}

/**
 * MIG-0653 U04: pure membership-add post-read planner.
 * CURRENT requires that *every requested distinct ID* names a real event,
 * even if it is already in this group. Missing relation IDs preserve request
 * order; failure cases do not produce any partial insert candidates.
 *
 * This is NOT an atomic write plan: caller must still build a guarded D1
 * mutation, restorable audit, queue, CAS and mutation-budget assertion.
 */
export type EventGroupMembershipAddPlan =
  | { ok: true; toAdd: string[] }
  | { ok: false; message: string };

export function planEventGroupMembershipAdd(
  requestedIds: readonly string[],
  validEventIds: readonly string[],
  existingMemberIds: readonly string[],
): EventGroupMembershipAddPlan {
  // This planner is exported and can be called independently of the CURRENT
  // input normalizer. Do not accept an empty, duplicated, or oversized request
  // merely because the caller supplied a matching number of DB lookup rows.
  if (requestedIds.length === 0 || requestedIds.length > EVENT_GROUP_ADD_MAX ||
      requestedIds.some((id) => !id || id !== id.trim()) ||
      new Set(requestedIds).size !== requestedIds.length) {
    return { ok: false, message: "存在しないイベントは追加できません。" };
  }
  const valid = new Set(validEventIds);
  // The D1 existence read can only authorize the requested unique IDs.
  // Reject duplicate/extra returned IDs rather than accepting a forged row
  // count (or letting a duplicated lookup row conceal a missing event).
  if (valid.size !== requestedIds.length ||
      validEventIds.length !== valid.size ||
      requestedIds.some((id) => !valid.has(id))) {
    return { ok: false, message: "存在しないイベントは追加できません。" };
  }
  const members = new Set(existingMemberIds);
  const toAdd = requestedIds.filter((id) => !members.has(id));
  return toAdd.length > 0
    ? { ok: true, toAdd }
    : { ok: false, message: "追加できるイベントがありません。" };
}

/**
 * MIG-0653 U04: project missing group relations into CURRENT's INSERT values.
 * This is a data-only projection, NOT authorization or an executable mutation.
 * Call only after normalizeEventGroupMembershipAdd and the database-backed
 * planEventGroupMembershipAdd existence/membership checks succeed. The route
 * must separately enforce D1 batch/query limits, atomic expected changes,
 * restorable audits, queue notifications, and admin write guards.
 */
/**
 * U04: fail closed before scheduling SA-030's atomic DELETE + restorable audit
 * if the full CURRENT audit budget (caller reads, queue statements and group
 * audit context preparation) cannot fit the D1 Free 50-query limit.
 * The eventual writer must use the same budget inputs inside the atomic batch.
 * This pure projection cannot make a write safe by itself.
 */
export type EventGroupDeleteBudgetInput = {
  callerQueryCount: number;
  queueStatementCount: number;
  auditEntryCount: number;
  distinctActorCount: number;
};

export function planEventGroupMembershipDeleteBudget(input: EventGroupDeleteBudgetInput): {
  withinLimit: boolean;
  totalQueryCount: number;
  limit: number;
} {
  // Invalid or omitted counts must not be coerced to zero by the shared
  // budgeting helper. Otherwise NaN, negative or fractional estimates could
  // undercount a write and incorrectly authorize an over-budget mutation.
  const counts = [
    input.callerQueryCount,
    input.queueStatementCount,
    input.auditEntryCount,
    input.distinctActorCount,
  ];
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
      input.auditEntryCount !== 1 || input.distinctActorCount !== 1) {
    return { withinLimit: false, totalQueryCount: Number.POSITIVE_INFINITY, limit: 50 };
  }
  // SA-030 deletes exactly one relation and emits one restorable audit entry.
  // A queue plan is supplied by the future guarded mutation caller; count all
  // its statements and changes assertions, not only its enqueue insert.
  const budget = planD1AuditMutationBudget({
    mutationStatementCount: 1 + input.queueStatementCount,
    mutationAssertionCount: 1 + input.queueStatementCount,
    auditEntryCount: input.auditEntryCount,
    distinctActorCount: input.distinctActorCount,
    callerQueryCount: input.callerQueryCount,
  });
  return {
    withinLimit: budget.withinLimit,
    totalQueryCount: budget.totalQueryCount,
    limit: budget.limit,
  };
}

export type EventGroupMembershipRelationRow = {
  event_group_id: string;
  event_id: string;
  relation_type: "member" | "primary" | "related";
  created_at: number;
  updated_at: number;
};

export function planEventGroupMembershipWriteRows(
  groupId: string,
  toAdd: readonly string[],
  now: number,
): EventGroupMembershipRelationRow[] {
  if (!groupId || !Number.isSafeInteger(now) || now < 0 ||
      toAdd.length === 0 || toAdd.length > EVENT_GROUP_ADD_MAX ||
      new Set(toAdd).size !== toAdd.length ||
      toAdd.some((id) => !id || id !== id.trim())) {
    throw new Error("event_group_membership_plan_invalid");
  }
  return toAdd.map((eventId) => ({
    event_group_id: groupId,
    event_id: eventId,
    relation_type: "member",
    created_at: now,
    updated_at: now,
  }));
}

/**
 * CURRENT SA-030 removes exactly one selected relation with a CAS condition on
 * its prior updated_at, and audits a full before snapshot. This projection
 * never issues a DELETE; the future route must assert exactly one affected
 * row inside the same atomic audited/queued D1 batch.
 */
export type EventGroupMembershipRemovePlan =
  | { ok: true; expectedUpdatedAt: number; before: EventGroupMembershipRelationRow }
  | { ok: false; message: string };

export function planEventGroupMembershipRemove(
  groupId: string,
  eventId: string,
  relation: EventGroupMembershipRelationRow | null | undefined,
): EventGroupMembershipRemovePlan {
  if (!relation ||
      relation.event_group_id !== groupId ||
      relation.event_id !== eventId ||
      !Number.isSafeInteger(relation.updated_at) || relation.updated_at < 0 ||
      !Number.isSafeInteger(relation.created_at) || relation.created_at < 0 ||
      !["member", "primary", "related"].includes(relation.relation_type)) {
    return { ok: false, message: "イベントはグループに追加されていません。" };
  }
  return {
    ok: true,
    expectedUpdatedAt: relation.updated_at,
    // Keep the restorable snapshot limited to the canonical relation columns.
    // Callers may pass a joined row containing settings/guard metadata.
    before: {
      event_group_id: relation.event_group_id,
      event_id: relation.event_id,
      relation_type: relation.relation_type,
      created_at: relation.created_at,
      updated_at: relation.updated_at,
    },
  };
}

/**
 * MIG-0653 U04 SA-030 STAGED write implementation.
 *
 * Deliberately NOT mounted by createAdminRoutes until CPU, CURRENT
 * differential, qualified independent review and human Lead gates pass.
 * Within the isolated staged route, the parent session and write identity/ToS
 * guards run before a single joined CostGuard, audit-settings and relation
 * snapshot query: S4 (1) + write identity/ToS (1) + joined snapshot (1) = 3
 * pre-reads. The isolated route is testable with the parent origin/session/
 * write/db middleware, and keeps atomic audited DELETE + rebuild queue.
 * Do not mount before the remaining acceptance gates have passed.
 */
export const stagedEventGroupWriteRoutes = new Hono<AppEnv>();
// Mirror CURRENT eventGroupMutationError: a stable, non-provider-specific failure body.
export const EVENT_GROUP_WRITE_FAILED = "保存に失敗しました。再読み込みして、もう一度お試しください。";

stagedEventGroupWriteRoutes.post("/", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const body = await readAdminJsonBody(c.req.raw);
  if (body.kind === "too_large") return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
  if (body.kind !== "ok") return c.json({ ok: false, message: "入力エラー" }, 400);
  const parsed = EventGroupMutationBodySchema.safeParse(body.value);
  if (!parsed.success) {
    return c.json({
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    }, 400);
  }

  const data = parsed.data;
  const userId = c.get("user")!.id;
  const db = c.get("db");
  const id = data.id?.trim() || generateId("egrp");
  const now = Math.floor(Date.now() / 1000);
  const createdRow = planEventGroupCreateValues(data, id, now);

  // Combine slug uniqueness, CostGuard, audit retention and the current
  // event-group fence row in one bounded read. Together with S4 and the
  // write identity/ToS check this is the S3 three-pre-read ceiling.
  type CreateSnapshot = AuditSettingsRow & {
    slug_exists: number;
    fence_token: string | null;
    fence_state: string | null;
    operation_mode: string | null;
    disabled_features_json: string | null;
    cost_guard_exception_until: number | null;
    cost_guard_exception_features_json: string | null;
  };
  let snapshot: CreateSnapshot | null;
  try {
    snapshot = await c.env.DB.prepare(`
      SELECT
        EXISTS(SELECT 1 FROM event_groups WHERE slug = ?) AS slug_exists,
        f.fence_token AS fence_token,
        f.state AS fence_state,
        s.operation_mode, s.disabled_features_json,
        s.cost_guard_exception_until, s.cost_guard_exception_features_json,
        s.audit_normal_retention_days, s.audit_restorable_retention_days,
        s.audit_long_retention_days, s.audit_max_payload_bytes,
        s.audit_compact_after_days
      FROM system_settings s
      LEFT JOIN public_visibility_fences f
        ON f.entity_type = 'event_group' AND f.entity_id = ?
      WHERE s.id = 'default'
      LIMIT ${MAX_SINGLE_ROW_LIMIT}
    `).bind(data.slug, id).first<CreateSnapshot>();
  } catch {
    return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 500);
  }
  if (!snapshot) return writeGuardDenyResponse(c, "maintenance_mode", 503);
  const cost = evaluateCostGuardCore({
    feature: "admin_event_create",
    operationMode: snapshot.operation_mode,
    disabledFeaturesJson: snapshot.disabled_features_json,
    exceptionUntil: snapshot.cost_guard_exception_until,
    exceptionFeaturesJson: snapshot.cost_guard_exception_features_json,
    now,
  });
  if (cost.blocked) {
    return writeGuardDenyResponse(c, cost.reason === "mode" ? "maintenance_mode" : "cost_guard_blocked", 503);
  }
  c.set("auditSettings", mapAuditSettings(snapshot));
  if (snapshot.slug_exists === 1) {
    return c.json({ ok: false, message: "このスラッグは既に使われています。" }, 400);
  }

  let fenceToken: string | null = null;
  const fenceStatements = [];
  const fenceExpected: number[] = [];
  if (data.visibility_status === "public") {
    fenceToken = snapshot.fence_state === "blocked" || snapshot.fence_state === "release_pending"
      ? snapshot.fence_token
      : null;
    fenceToken ||= generateId("vf");
    fenceStatements.push(buildPublicVisibilityFenceUpsertStatement(db, {
      entityType: "event_group",
      entityId: id,
      fenceToken,
      state: "release_pending",
      actorUserId: userId,
      reason: "event_group_create",
      now,
    }));
    fenceExpected.push(1);
  }

  const queue = await buildEventGroupChangeQueueBatch(db, {
    reason: "event_group_create",
    requestedByUserId: userId,
  });
  const insert = db.run(sql`
    INSERT INTO event_groups (
      id, name, slug, description, group_type, icon_url, img_url,
      accent_color, visibility_status, sort_order, created_at, updated_at
    ) VALUES (
      ${createdRow.id}, ${createdRow.name}, ${createdRow.slug},
      ${createdRow.description}, ${createdRow.group_type}, ${createdRow.icon_url},
      ${createdRow.img_url}, ${createdRow.accent_color},
      ${createdRow.visibility_status}, ${createdRow.sort_order},
      ${createdRow.created_at}, ${createdRow.updated_at}
    )
  `);
  const mutationStatements = [insert, ...fenceStatements, ...queue.statements];
  const expectedMutationChanges = [1, ...fenceExpected, ...queue.expectedChanges];
  const audits = [{
    table_name: "event_groups" as const,
    target_id: id,
    operation: "CREATE" as const,
    after: { ...createdRow },
    actor_user_id: userId,
    retention_class: "restorable" as const,
  }];
  const budget = planD1AuditMutationBudget({
    mutationStatementCount: mutationStatements.length,
    mutationAssertionCount: expectedMutationChanges.length,
    auditEntryCount: audits.length,
    distinctActorCount: 1,
    callerQueryCount: 3,
  });
  if (!budget.withinLimit) {
    return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 503);
  }

  // Private-only mutations never need an R2 binding. A throwing getter
  // on a public-boundary mutation fails closed before any D1/R2 write.
  let bucket: VisibilityManifestBucket | undefined;
  if (fenceToken) {
    try {
      bucket = c.env.BUCKET as unknown as VisibilityManifestBucket | undefined;
    } catch {
      return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 503);
    }
    if (!bucket) return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 503);
  }
  const fenceHost = bucket ? {
    manifest: {
      read: () => readVisibilityManifestObject(bucket),
      write: (manifest: Parameters<typeof putVisibilityManifestWithCas>[1], options?: {
        ifMatchEtag?: string | null;
        mutateOnConflict?: (latest: Parameters<typeof putVisibilityManifestWithCas>[1]) => Parameters<typeof putVisibilityManifestWithCas>[1];
      }) => putVisibilityManifestWithCas(bucket, manifest, options?.ifMatchEtag, options?.mutateOnConflict),
    },
  } : null;
  let fencePreCommitted = false;
  try {
    if (fenceToken && fenceHost) {
      await preCommitPublicVisibilityFence({
        entityType: "event_group",
        entityId: id,
        fenceToken,
        reason: "event_group_create",
      }, fenceHost);
      fencePreCommitted = true;
    }
    await mutateWithAudit(db, {
      mutationStatements,
      expectedMutationChanges,
      preloaded: auditPreloaded(c),
      callerQueryCount: 3,
      audits,
    });
  } catch {
    if (fenceToken && fenceHost && fencePreCommitted) {
      await compensatePublicVisibilityFenceOnD1Failure({
        db,
        entityType: "event_group",
        entityId: id,
        fenceToken,
        flow: "event_group_visibility",
      }, fenceHost).catch(() => undefined);
    }
    console.error("[event-group] create failed");
    return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 500);
  }
  return c.json({
    ok: true,
    id,
    ...(queue.statements.length > 0 ? { pendingPublicReflection: true } : {}),
  }, 200);
});

stagedEventGroupWriteRoutes.patch("/:id", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const body = await readAdminJsonBody(c.req.raw);
  if (body.kind === "too_large") return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
  if (body.kind !== "ok") return c.json({ ok: false, message: "入力エラー" }, 400);
  const parsed = EventGroupMutationBodySchema.safeParse(body.value);
  if (!parsed.success) {
    return c.json({
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    }, 400);
  }

  const data = parsed.data;
  const id = c.req.param("id").trim();
  const bodyId = data.id?.trim();
  if (!id || id.length > MAX_EVENT_GROUP_ID_LENGTH || (bodyId && bodyId !== id)) {
    return c.json({ ok: false, message: "ID が必要です。" }, 400);
  }
  const db = c.get("db");
  const userId = c.get("user")!.id;
  const now = Math.floor(Date.now() / 1000);

  // One bounded pre-read supplies the CURRENT group snapshot, slug conflict,
  // CostGuard/audit settings and the current fence token/state.
  type UpdateSnapshot = AuditSettingsRow & {
    group_id: string | null;
    name: string | null;
    slug: string | null;
    description: string | null;
    group_type: ValidEventGroupMutation["group_type"] | null;
    icon_url: string | null;
    img_url: string | null;
    accent_color: string | null;
    visibility_status: ValidEventGroupMutation["visibility_status"] | null;
    sort_order: number | null;
    created_at: number | null;
    updated_at: number | null;
    slug_exists: number;
    fence_token: string | null;
    fence_state: string | null;
    operation_mode: string | null;
    disabled_features_json: string | null;
    cost_guard_exception_until: number | null;
    cost_guard_exception_features_json: string | null;
  };
  let snapshot: UpdateSnapshot | null;
  try {
    snapshot = await c.env.DB.prepare(`
      SELECT
        g.id AS group_id, g.name, g.slug, g.description, g.group_type,
        g.icon_url, g.img_url, g.accent_color, g.visibility_status,
        g.sort_order, g.created_at, g.updated_at,
        EXISTS(SELECT 1 FROM event_groups conflict
          WHERE conflict.slug = ? AND conflict.id <> ?) AS slug_exists,
        f.fence_token, f.state AS fence_state,
        s.operation_mode, s.disabled_features_json,
        s.cost_guard_exception_until, s.cost_guard_exception_features_json,
        s.audit_normal_retention_days, s.audit_restorable_retention_days,
        s.audit_long_retention_days, s.audit_max_payload_bytes,
        s.audit_compact_after_days
      FROM system_settings s
      LEFT JOIN event_groups g ON g.id = ?
      LEFT JOIN public_visibility_fences f
        ON f.entity_type = 'event_group' AND f.entity_id = ?
      WHERE s.id = 'default'
      LIMIT ${MAX_SINGLE_ROW_LIMIT}
    `).bind(data.slug, id, id, id).first<UpdateSnapshot>();
  } catch {
    return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 500);
  }
  if (!snapshot) return writeGuardDenyResponse(c, "maintenance_mode", 503);
  const cost = evaluateCostGuardCore({
    feature: "admin_event_create",
    operationMode: snapshot.operation_mode,
    disabledFeaturesJson: snapshot.disabled_features_json,
    exceptionUntil: snapshot.cost_guard_exception_until,
    exceptionFeaturesJson: snapshot.cost_guard_exception_features_json,
    now,
  });
  if (cost.blocked) {
    return writeGuardDenyResponse(c, cost.reason === "mode" ? "maintenance_mode" : "cost_guard_blocked", 503);
  }
  c.set("auditSettings", mapAuditSettings(snapshot));
  if (!snapshot.group_id || snapshot.updated_at == null || snapshot.visibility_status == null ||
      snapshot.sort_order == null || snapshot.created_at == null) {
    return c.json({ ok: false, message: "グループが見つかりません。" }, 404);
  }
  if (snapshot.slug_exists === 1) {
    return c.json({ ok: false, message: "このスラッグは既に使われています。" }, 400);
  }
  const cas = checkEventGroupUpdateCas(data.base_updated_at, snapshot.updated_at);
  if (!cas.ok) return c.json({ ok: false, message: cas.message }, 409);

  const previous = {
    id,
    name: snapshot.name ?? "",
    slug: snapshot.slug ?? "",
    description: snapshot.description,
    group_type: snapshot.group_type ?? "series",
    icon_url: snapshot.icon_url,
    img_url: snapshot.img_url,
    accent_color: snapshot.accent_color,
    visibility_status: snapshot.visibility_status,
    sort_order: snapshot.sort_order,
    created_at: snapshot.created_at,
    updated_at: snapshot.updated_at,
  };
  const updatedValues = planEventGroupUpdateValues(data, {
    sort_order: snapshot.sort_order,
    updated_at: snapshot.updated_at,
  }, now);
  const updatedRow = { ...previous, ...updatedValues };
  const crossesPublicBoundary =
    (snapshot.visibility_status === "public") !== (updatedValues.visibility_status === "public");
  let fenceToken: string | null = null;
  const fenceStatements = [];
  const fenceExpected: number[] = [];
  if (crossesPublicBoundary) {
    fenceToken = snapshot.fence_state === "blocked" || snapshot.fence_state === "release_pending"
      ? snapshot.fence_token
      : null;
    fenceToken ||= generateId("vf");
    fenceStatements.push(buildPublicVisibilityFenceUpsertStatement(db, {
      entityType: "event_group",
      entityId: id,
      fenceToken,
      state: updatedValues.visibility_status === "public" ? "release_pending" : "blocked",
      actorUserId: userId,
      reason: "event_group_visibility_update",
      now,
    }));
    fenceExpected.push(1);
  }

  try {
    const queue = await buildEventGroupChangeQueueBatch(db, {
      reason: "event_group_update",
      requestedByUserId: userId,
    });
    const update = db.run(sql`
      UPDATE event_groups SET
        name = ${updatedValues.name},
        slug = ${updatedValues.slug},
        description = ${updatedValues.description},
        group_type = ${updatedValues.group_type},
        icon_url = ${updatedValues.icon_url},
        accent_color = ${updatedValues.accent_color},
        visibility_status = ${updatedValues.visibility_status},
        sort_order = ${updatedValues.sort_order},
        updated_at = ${updatedValues.updated_at}
      WHERE id = ${id} AND updated_at = ${snapshot.updated_at}
    `);
    const mutationStatements = [update, ...fenceStatements, ...queue.statements];
    const expectedMutationChanges = [1, ...fenceExpected, ...queue.expectedChanges];
    const audits = [{
      table_name: "event_groups" as const,
      target_id: id,
      operation: "UPDATE" as const,
      before: { ...previous },
      after: { ...updatedRow },
      actor_user_id: userId,
      retention_class: "restorable" as const,
    }];
    const budget = planD1AuditMutationBudget({
      mutationStatementCount: mutationStatements.length,
      mutationAssertionCount: expectedMutationChanges.length,
      auditEntryCount: audits.length,
      distinctActorCount: 1,
      callerQueryCount: 3,
    });
    if (!budget.withinLimit) {
      return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 503);
    }

    // Private-only mutations never need an R2 binding. A throwing getter
    // on a public-boundary mutation fails closed before any D1/R2 write.
    let bucket: VisibilityManifestBucket | undefined;
    if (fenceToken) {
      try {
        bucket = c.env.BUCKET as unknown as VisibilityManifestBucket | undefined;
      } catch {
        return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 503);
      }
      if (!bucket) return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 503);
    }
    const fenceHost = bucket ? {
      manifest: {
        read: () => readVisibilityManifestObject(bucket),
        write: (manifest: Parameters<typeof putVisibilityManifestWithCas>[1], options?: {
          ifMatchEtag?: string | null;
          mutateOnConflict?: (latest: Parameters<typeof putVisibilityManifestWithCas>[1]) => Parameters<typeof putVisibilityManifestWithCas>[1];
        }) => putVisibilityManifestWithCas(bucket, manifest, options?.ifMatchEtag, options?.mutateOnConflict),
      },
    } : null;
    let fencePreCommitted = false;
    try {
      if (fenceToken && fenceHost) {
        await preCommitPublicVisibilityFence({
          entityType: "event_group",
          entityId: id,
          fenceToken,
          reason: "event_group_visibility_update",
        }, fenceHost);
        fencePreCommitted = true;
      }
      await mutateWithAudit(db, {
        mutationStatements,
        expectedMutationChanges,
        preloaded: auditPreloaded(c),
        callerQueryCount: 3,
        audits,
      });
    } catch (error) {
      if (fenceToken && fenceHost && fencePreCommitted) {
        await compensatePublicVisibilityFenceOnD1Failure({
          db,
          entityType: "event_group",
          entityId: id,
          fenceToken,
          flow: "event_group_visibility",
        }, fenceHost).catch(() => undefined);
      }
      console.error("[event-group] update failed");
      return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 500);
    }
    return c.json({
      ok: true,
      id,
      ...(queue.statements.length > 0 ? { pendingPublicReflection: true } : {}),
    }, 200);
  } catch {
    return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 500);
  }
});


/** CURRENT SA-028: delete a group and every membership with restorable snapshots. */
const MAX_EVENT_GROUP_DELETE_RELATIONS = 79;

stagedEventGroupWriteRoutes.delete("/:id", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const id = c.req.param("id").trim();
  if (!id || id.length > MAX_EVENT_GROUP_ID_LENGTH) {
    return c.json({ ok: false, message: "ID が必要です。" }, 400);
  }
  const db = c.get("db");
  const userId = c.get("user")!.id;
  const now = Math.floor(Date.now() / 1000);

  type DeleteSnapshot = AuditSettingsRow & {
    group_id: string | null;
    name: string | null;
    slug: string | null;
    description: string | null;
    group_type: ValidEventGroupMutation["group_type"] | null;
    icon_url: string | null;
    img_url: string | null;
    accent_color: string | null;
    visibility_status: ValidEventGroupMutation["visibility_status"] | null;
    sort_order: number | null;
    created_at: number | null;
    updated_at: number | null;
    relation_event_id: string | null;
    relation_type: string | null;
    relation_created_at: number | null;
    relation_updated_at: number | null;
    fence_token: string | null;
    fence_state: string | null;
    operation_mode: string | null;
    disabled_features_json: string | null;
    cost_guard_exception_until: number | null;
    cost_guard_exception_features_json: string | null;
  };

  // One bounded joined read captures the group, every relation (plus one
  // overflow sentinel), audit settings, CostGuard and the visibility fence.
  let rows: DeleteSnapshot[];
  try {
    rows = (await c.env.DB.prepare(`
      SELECT
        g.id AS group_id, g.name, g.slug, g.description, g.group_type,
        g.icon_url, g.img_url, g.accent_color, g.visibility_status,
        g.sort_order, g.created_at, g.updated_at,
        m.event_id AS relation_event_id, m.relation_type,
        m.created_at AS relation_created_at, m.updated_at AS relation_updated_at,
        f.fence_token, f.state AS fence_state,
        s.operation_mode, s.disabled_features_json,
        s.cost_guard_exception_until, s.cost_guard_exception_features_json,
        s.audit_normal_retention_days, s.audit_restorable_retention_days,
        s.audit_long_retention_days, s.audit_max_payload_bytes,
        s.audit_compact_after_days
      FROM system_settings s
      LEFT JOIN event_groups g ON g.id = ?
      LEFT JOIN event_group_events m ON m.event_group_id = g.id
      LEFT JOIN public_visibility_fences f
        ON f.entity_type = 'event_group' AND f.entity_id = g.id
      WHERE s.id = 'default'
      ORDER BY m.event_id ASC
      LIMIT ${MAX_EVENT_GROUP_DELETE_RELATIONS + 1}
    `).bind(id).all<DeleteSnapshot>()).results;
  } catch {
    return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 500);
  }

  const snapshot = rows[0];
  if (!snapshot) return writeGuardDenyResponse(c, "maintenance_mode", 503);
  const cost = evaluateCostGuardCore({
    feature: "admin_event_create",
    operationMode: snapshot.operation_mode,
    disabledFeaturesJson: snapshot.disabled_features_json,
    exceptionUntil: snapshot.cost_guard_exception_until,
    exceptionFeaturesJson: snapshot.cost_guard_exception_features_json,
    now,
  });
  if (cost.blocked) {
    return writeGuardDenyResponse(c, cost.reason === "mode" ? "maintenance_mode" : "cost_guard_blocked", 503);
  }
  c.set("auditSettings", mapAuditSettings(snapshot));
  if (!snapshot.group_id || snapshot.updated_at == null ||
      snapshot.created_at == null || snapshot.sort_order == null ||
      snapshot.visibility_status == null) {
    return c.json({ ok: false, message: "グループが見つかりません。" }, 404);
  }
  if (rows.length > MAX_EVENT_GROUP_DELETE_RELATIONS) {
    return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 503);
  }

  const relationRows: Array<{
    event_group_id: string;
    event_id: string;
    relation_type: string;
    created_at: number;
    updated_at: number;
  }> = [];
  for (const row of rows) {
    if (row.relation_event_id == null) continue;
    if (row.relation_type == null || row.relation_created_at == null ||
        row.relation_updated_at == null) {
      return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 500);
    }
    relationRows.push({
      event_group_id: id,
      event_id: row.relation_event_id,
      relation_type: row.relation_type,
      created_at: row.relation_created_at,
      updated_at: row.relation_updated_at,
    });
  }
  if (relationRows.length > MAX_EVENT_GROUP_DELETE_RELATIONS) {
    return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 503);
  }

  const previous = {
    id,
    name: snapshot.name ?? "",
    slug: snapshot.slug ?? "",
    description: snapshot.description,
    group_type: snapshot.group_type ?? "series",
    icon_url: snapshot.icon_url,
    img_url: snapshot.img_url,
    accent_color: snapshot.accent_color,
    visibility_status: snapshot.visibility_status,
    sort_order: snapshot.sort_order,
    created_at: snapshot.created_at,
    updated_at: snapshot.updated_at,
  };
  const crossesPublicBoundary = snapshot.visibility_status === "public";
  let fenceToken: string | null = null;
  const fenceStatements = [];
  const fenceExpected: number[] = [];
  if (crossesPublicBoundary) {
    fenceToken = snapshot.fence_state === "blocked" || snapshot.fence_state === "release_pending"
      ? snapshot.fence_token
      : null;
    fenceToken ||= generateId("vf");
    fenceStatements.push(buildPublicVisibilityFenceUpsertStatement(db, {
      entityType: "event_group",
      entityId: id,
      fenceToken,
      state: "blocked",
      actorUserId: userId,
      reason: "event_group_delete",
      now,
    }));
    fenceExpected.push(1);
  }

  try {
    const queue = await buildEventGroupChangeQueueBatch(db, {
      reason: "event_group_delete",
      requestedByUserId: userId,
    });
    // A concurrent remove+add (or field update) can preserve the number of
    // relations, so changes() alone cannot guarantee the before-audit rows
    // match the rows actually deleted. Snapshot equality is tested inside
    // the same atomic D1 batch, before either DELETE executes.
    const expectedRelationsJson = JSON.stringify(relationRows.map((row) => ({
      event_id: row.event_id,
      relation_type: row.relation_type,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })));
    // Iterate each bounded snapshot row once, probing the composite
    // (event_group_id, event_id) PK instead of scanning json_each for every
    // live relation (which is quadratic at the allowed 70+ member boundary).
    // Equal counts plus every snapshot row matching live makes this exact:
    // the snapshot is read from a table whose composite PK is unique.
    const relationSnapshotCas = db.run(assertCondition(sql`
      (SELECT COUNT(*) FROM event_group_events WHERE event_group_id = ${id}) = ${relationRows.length}
      AND NOT EXISTS (
        SELECT 1 FROM json_each(${expectedRelationsJson}) snapshot
        LEFT JOIN event_group_events live
          ON live.event_group_id = ${id}
          AND live.event_id = json_extract(snapshot.value, '$.event_id')
        WHERE live.event_id IS NULL
          OR live.relation_type IS NOT json_extract(snapshot.value, '$.relation_type')
          OR live.created_at IS NOT json_extract(snapshot.value, '$.created_at')
          OR live.updated_at IS NOT json_extract(snapshot.value, '$.updated_at')
      )
    `));
    const deleteRelations = db.run(sql`
      DELETE FROM event_group_events WHERE event_group_id = ${id}
    `);
    const deleteGroup = db.run(sql`
      DELETE FROM event_groups
      WHERE id = ${id} AND updated_at = ${snapshot.updated_at}
    `);
    const mutationStatements = [
      deleteRelations, deleteGroup, ...fenceStatements, ...queue.statements,
    ];
    const expectedMutationChanges = [
      relationRows.length, 1, ...fenceExpected, ...queue.expectedChanges,
    ];
    const audits = [
      ...relationRows.map((row) => ({
        table_name: "event_group_events" as const,
        target_id: `${row.event_group_id}:${row.event_id}`,
        operation: "DELETE" as const,
        before: { ...row },
        actor_user_id: userId,
        retention_class: "restorable" as const,
      })),
      {
        table_name: "event_groups" as const,
        target_id: id,
        operation: "DELETE" as const,
        before: { ...previous },
        actor_user_id: userId,
        retention_class: "restorable" as const,
      },
    ];
    const budget = planD1AuditMutationBudget({
      mutationStatementCount: mutationStatements.length,
      mutationAssertionCount: expectedMutationChanges.length,
      preMutationAssertionCount: 1,
      auditEntryCount: audits.length,
      distinctActorCount: 1,
      callerQueryCount: 3,
    });
    if (!budget.withinLimit) {
      return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 503);
    }

    // Private-only mutations never need an R2 binding. A throwing getter
    // on a public-boundary mutation fails closed before any D1/R2 write.
    let bucket: VisibilityManifestBucket | undefined;
    if (fenceToken) {
      try {
        bucket = c.env.BUCKET as unknown as VisibilityManifestBucket | undefined;
      } catch {
        return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 503);
      }
      if (!bucket) return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 503);
    }
    const fenceHost = bucket ? {
      manifest: {
        read: () => readVisibilityManifestObject(bucket),
        write: (manifest: Parameters<typeof putVisibilityManifestWithCas>[1], options?: {
          ifMatchEtag?: string | null;
          mutateOnConflict?: (latest: Parameters<typeof putVisibilityManifestWithCas>[1]) => Parameters<typeof putVisibilityManifestWithCas>[1];
        }) => putVisibilityManifestWithCas(bucket, manifest, options?.ifMatchEtag, options?.mutateOnConflict),
      },
    } : null;
    let fencePreCommitted = false;
    try {
      if (fenceToken && fenceHost) {
        await preCommitPublicVisibilityFence({
          entityType: "event_group",
          entityId: id,
          fenceToken,
          reason: "event_group_delete",
        }, fenceHost);
        fencePreCommitted = true;
      }
      await mutateWithAudit(db, {
        mutationStatements,
        expectedMutationChanges,
        preMutationAssertions: [relationSnapshotCas],
        preloaded: auditPreloaded(c),
        callerQueryCount: 3,
        audits,
      });
    } catch {
      if (fenceToken && fenceHost && fencePreCommitted) {
        await compensatePublicVisibilityFenceOnD1Failure({
          db,
          entityType: "event_group",
          entityId: id,
          fenceToken,
          flow: "event_group_visibility",
        }, fenceHost).catch(() => undefined);
      }
      console.error("[event-group] delete failed");
      return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 500);
    }
    return c.json({ ok: true }, 200);
  } catch {
    return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 500);
  }
});

stagedEventGroupWriteRoutes.delete("/:id/events/:eventId", async (c) => {
  // Membership existence and conflict responses are admin-private, including 200/404/500.
  c.header("Cache-Control", "private, no-store");
  const result = normalizeEventGroupMembershipRemove({
    groupId: c.req.param("id"),
    eventId: c.req.param("eventId"),
  });
  if (!result.ok) return c.json({ ok: false, message: result.message }, 400);
  const { groupId, eventId } = result;
  if (groupId.length > MAX_EVENT_GROUP_ID_LENGTH ||
      eventId.length > MAX_EVENT_GROUP_ID_LENGTH) {
    return c.json({ ok: false, message: "グループとイベントを指定してください。" }, 400);
  }

  // One joined SELECT distinguishes missing group from missing membership and
  // captures the full canonical relation row for restorable audit.
  const db = c.get("db");
  const userId = c.get("user")!.id;
  let stored: (EventGroupMembershipRelationRow & AuditSettingsRow & {
    group_exists: string | null;
    operation_mode: string | null;
    disabled_features_json: string | null;
    cost_guard_exception_until: number | null;
    cost_guard_exception_features_json: string | null;
  }) | null;
  try {
    // Fold CostGuard settings into the authoritative relation snapshot. With
    // S4 session (1) + write identity/ToS (1) + this joined read (1), S3 stays
    // within ZERO_1102's three-pre-read limit without weakening guard order.
    stored = await c.env.DB.prepare(
      `SELECT g.id AS group_exists, m.event_group_id, m.event_id,
              m.relation_type, m.created_at, m.updated_at,
              s.operation_mode, s.disabled_features_json,
              s.cost_guard_exception_until, s.cost_guard_exception_features_json,
              s.audit_normal_retention_days, s.audit_restorable_retention_days,
              s.audit_long_retention_days, s.audit_max_payload_bytes,
              s.audit_compact_after_days
         FROM system_settings AS s
         LEFT JOIN event_groups AS g ON g.id = ?
         LEFT JOIN event_group_events AS m
           ON m.event_group_id = g.id AND m.event_id = ?
        WHERE s.id = 'default' LIMIT ${MAX_SINGLE_ROW_LIMIT}`,
    ).bind(groupId, eventId).first<EventGroupMembershipRelationRow & AuditSettingsRow & {
      group_exists: string | null;
      operation_mode: string | null;
      disabled_features_json: string | null;
      cost_guard_exception_until: number | null;
      cost_guard_exception_features_json: string | null;
    }>();
  } catch {
    return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 500);
  }
  if (!stored) {
    return writeGuardDenyResponse(c, "maintenance_mode", 503);
  }
  const cost = evaluateCostGuardCore({
    feature: "admin_event_create",
    operationMode: stored.operation_mode,
    disabledFeaturesJson: stored.disabled_features_json,
    exceptionUntil: stored.cost_guard_exception_until,
    exceptionFeaturesJson: stored.cost_guard_exception_features_json,
    now: Math.floor(Date.now() / 1000),
  });
  if (cost.blocked) {
    return writeGuardDenyResponse(c, cost.reason === "mode" ? "maintenance_mode" : "cost_guard_blocked", 503);
  }
  c.set("auditSettings", mapAuditSettings(stored));
  if (!stored.group_exists) return c.json({ ok: false, message: "グループが見つかりません。" }, 404);
  const plan = planEventGroupMembershipRemove(groupId, eventId,
    stored.event_id == null ? null : stored);
  if (!plan.ok) return c.json({ ok: false, message: plan.message }, 404);

  try {
    const queue = await buildEventGroupChangeQueueBatch(db, {
      reason: "event_group_member_remove",
      requestedByUserId: userId,
    });
    // S4 + identity/ToS + joined CostGuard/relation snapshot = 3 pre-reads.
    // The helper separately includes these reads in the 50-query logical cap.
    const budget = planEventGroupMembershipDeleteBudget({
      callerQueryCount: 3,
      queueStatementCount: queue.statements.length,
      auditEntryCount: 1,
      distinctActorCount: 1,
    });
    if (!budget.withinLimit) {
      return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 503);
    }
    await mutateWithAudit(db, {
      mutationStatements: [
        db.run(sql`DELETE FROM event_group_events
                   WHERE event_group_id = ${groupId}
                     AND event_id = ${eventId}
                     AND updated_at = ${plan.expectedUpdatedAt}
                     AND relation_type = ${plan.before.relation_type}
                     AND created_at = ${plan.before.created_at}`),
        ...queue.statements,
      ],
      expectedMutationChanges: [1, ...queue.expectedChanges],
      preloaded: auditPreloaded(c),
      // Keep the execution budget identical to the validated S4 + ToS + joined read plan.
      callerQueryCount: 3,
      audits: [{
        table_name: "event_group_events",
        target_id: `${groupId}:${eventId}`,
        operation: "DELETE",
        before: { ...plan.before },
        actor_user_id: userId,
        retention_class: "restorable",
      }],
    });
  } catch {
    // No SQL/provider details in the HTTP body. A failed audited batch rolls
    // back the relation DELETE and queue statement together.
    return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 500);
  }
  return c.json({ ok: true, id: groupId }, 200);
});


/**
 * MIG-0653 U04 SA-029 staged write. The route remains isolated until the
 * CURRENT differential, workerd S3 measurement and independent review pass.
 * One joined read supplies group existence, event membership, CostGuard and
 * audit settings after the parent session + identity/ToS guards.
 */
stagedEventGroupWriteRoutes.post("/:id/events", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const body = await readAdminJsonBody(c.req.raw);
  if (body.kind === "too_large") {
    return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
  }
  if (body.kind !== "ok") {
    return c.json({ ok: false, message: "追加するイベントを選択してください。" }, 400);
  }
  const normalized = normalizeEventGroupMembershipAdd({
    groupId: c.req.param("id"),
    eventIds: body.value.eventIds,
  });
  if (!normalized.ok) return c.json({ ok: false, message: normalized.message }, 400);
  const { groupId, eventIds } = normalized;
  if (groupId.length > MAX_EVENT_GROUP_ID_LENGTH ||
      eventIds.some((id) => id.length > MAX_EVENT_GROUP_ID_LENGTH)) {
    return c.json({ ok: false, message: "追加するイベントを選択してください。" }, 400);
  }

  const db = c.get("db");
  const userId = c.get("user")!.id;
  const placeholders = eventIds.map(() => "?").join(", ");
  type MembershipAddSnapshot = EventGroupMembershipRelationRow & AuditSettingsRow & {
    group_exists: string | null;
    valid_event_id: string | null;
    existing_member_id: string | null;
    operation_mode: string | null;
    disabled_features_json: string | null;
    cost_guard_exception_until: number | null;
    cost_guard_exception_features_json: string | null;
  };
  let rows: MembershipAddSnapshot[];
  try {
    rows = (await c.env.DB.prepare(
      `SELECT g.id AS group_exists,
              e.id AS valid_event_id,
              m.event_id AS existing_member_id,
              s.operation_mode, s.disabled_features_json,
              s.cost_guard_exception_until, s.cost_guard_exception_features_json,
              s.audit_normal_retention_days, s.audit_restorable_retention_days,
              s.audit_long_retention_days, s.audit_max_payload_bytes,
              s.audit_compact_after_days
         FROM system_settings AS s
         LEFT JOIN event_groups AS g ON g.id = ?
         LEFT JOIN events AS e ON g.id IS NOT NULL AND e.id IN (${placeholders})
         LEFT JOIN event_group_events AS m
           ON m.event_group_id = g.id AND m.event_id = e.id
        WHERE s.id = 'default'
        LIMIT ${EVENT_GROUP_ADD_MAX}`,
    ).bind(groupId, ...eventIds).all<MembershipAddSnapshot>()).results;
  } catch {
    return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 500);
  }
  const snapshot = rows[0];
  if (!snapshot) return writeGuardDenyResponse(c, "maintenance_mode", 503);
  const cost = evaluateCostGuardCore({
    feature: "admin_event_create",
    operationMode: snapshot.operation_mode,
    disabledFeaturesJson: snapshot.disabled_features_json,
    exceptionUntil: snapshot.cost_guard_exception_until,
    exceptionFeaturesJson: snapshot.cost_guard_exception_features_json,
    now: Math.floor(Date.now() / 1000),
  });
  if (cost.blocked) {
    return writeGuardDenyResponse(c, cost.reason === "mode" ? "maintenance_mode" : "cost_guard_blocked", 503);
  }
  c.set("auditSettings", mapAuditSettings(snapshot));
  if (!snapshot.group_exists) {
    return c.json({ ok: false, message: "グループが見つかりません。" }, 404);
  }

  const validEventIds = rows.flatMap((row) => row.valid_event_id ? [row.valid_event_id] : []);
  const existingMemberIds = rows.flatMap((row) => row.existing_member_id ? [row.existing_member_id] : []);
  const plan = planEventGroupMembershipAdd(eventIds, validEventIds, existingMemberIds);
  if (!plan.ok) {
    const status = plan.message === "追加できるイベントがありません。" ? 400 : 400;
    return c.json({ ok: false, message: plan.message }, status);
  }

  const now = Math.floor(Date.now() / 1000);
  let insertedRows: EventGroupMembershipRelationRow[];
  try {
    insertedRows = planEventGroupMembershipWriteRows(groupId, plan.toAdd, now);
  } catch {
    return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 400);
  }

  try {
    const queue = await buildEventGroupChangeQueueBatch(db, {
      reason: "event_group_member_add",
      requestedByUserId: userId,
    });
    // One JSON1 INSERT avoids exceeding D1's 100-bind cap at 80 relations.
    // Audit entries are chunked by mutateWithAudit; the full 80-row case is
    // 49/50 logical queries (3 caller reads + 2 preparation + 44 batch).
    const insert = db.run(sql`
      INSERT INTO event_group_events (
        event_group_id, event_id, relation_type, created_at, updated_at
      )
      SELECT
        json_extract(value, '$.event_group_id'),
        json_extract(value, '$.event_id'),
        json_extract(value, '$.relation_type'),
        json_extract(value, '$.created_at'),
        json_extract(value, '$.updated_at')
      FROM json_each(${JSON.stringify(insertedRows)})
    `);
    const mutationStatements = [insert, ...queue.statements];
    const expectedMutationChanges = [insertedRows.length, ...queue.expectedChanges];
    const audits = insertedRows.map((row) => ({
      table_name: "event_group_events" as const,
      target_id: `${row.event_group_id}:${row.event_id}`,
      operation: "CREATE" as const,
      after: { ...row },
      actor_user_id: userId,
      retention_class: "restorable" as const,
    }));
    // The preflight must use the same concrete statements, audit actors,
    // and preloaded guard context as mutateWithAudit. A separate hand-counted
    // budget can drift when a queue builder gains marker DML/assertions.
    const atomicMutation = {
      mutationStatements,
      expectedMutationChanges,
      preloaded: auditPreloaded(c),
      // S4 session, identity/ToS, joined CostGuard/membership/audit-settings read.
      callerQueryCount: 3,
      audits,
    };
    const budget = planAtomicAuditMutationBudget(atomicMutation);
    if (!budget.withinLimit) {
      return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 503);
    }
    await mutateWithAudit(db, atomicMutation);
    return c.json({ ok: true, id: groupId, added: insertedRows.length }, 200);
  } catch (error) {
    // Keep the public response generic; emit only bounded diagnostic metadata
    // so a failed atomic batch can be investigated without logging request data.
    console.error("[event-group] membership add failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorCode: error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code).slice(0, 64)
        : null,
      errorMessage: error instanceof Error ? error.message.slice(0, 160) : null,
    });
    return c.json({ ok: false, message: EVENT_GROUP_WRITE_FAILED }, 500);
  }
});
