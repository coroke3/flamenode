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
import type { AppEnv } from "../../env.ts";
import { adminReadGuardMiddleware } from "../../middleware/adminReadGuard.ts";
import { evaluateAdminWriteGuard } from "../../middleware/writeOrigin.ts";
import { evaluateCostGuardCore } from "@flamenode/domain/admin";
import { MAX_SINGLE_ROW_LIMIT } from "../../lib/limits.ts";
import { planD1AuditMutationBudget } from "@flamenode/server-core/audit/mutateBudget";

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
    !(value as Cursor).id ||
    (value as Cursor).id.length > MAX_EVENT_GROUP_ID_LENGTH ||
    // Numeric-looking timestamps outside Date/SQLite's accepted range can
    // still be safe integers, but must never enter the seek query.
    (value as Cursor).updatedAt < 0
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
    if (!groupId || groupId.length > MAX_EVENT_GROUP_ID_LENGTH || query.length > 64) {
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
    // Emit only cursors that the same endpoint can parse. The 200-character
    // cap is on JSON, not only the ID: JSON escapes can expand legacy IDs.
    const nextCursor = hasMore && last
      ? JSON.stringify({ updatedAt: last.updated_at, id: last.id })
      : null;
    if (nextCursor && (last!.id.length > MAX_EVENT_GROUP_ID_LENGTH ||
        nextCursor.length > 200)) {
      return c.json({ ok: false, message: SEARCH_FAILED }, 503);
    }
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
  const eventIds = [...new Set(
    rawIds.filter((id): id is string => typeof id === "string")
      .map((id) => id.trim()).filter(Boolean),
  )];
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
  return { ok: true, expectedUpdatedAt: relation.updated_at, before: { ...relation } };
}
