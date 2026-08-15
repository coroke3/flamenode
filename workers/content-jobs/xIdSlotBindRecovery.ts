import { canAutoBindUnassignedReservation } from "../../src/lib/slots/reservationBindIdentityCore.ts";
import { normalizeXId } from "../../src/lib/utils/xid.ts";
import {
  D1_QUERY_SOFT_LIMIT,
  isD1BudgetExhausted,
  type D1Budget,
} from "../shared/d1Budget.ts";

export const X_ID_SLOT_BIND_RECOVERY_REQUEST_LIMIT = 5;
export const X_ID_SLOT_BIND_RECOVERY_SLOT_LIMIT = 30;
export const X_ID_SLOT_BIND_RECOVERY_MAX_ATOMIC_ROWS = 3;
const X_ID_SLOT_BIND_RECOVERY_BATCH_RESERVE = 28;
/** 0057適用前に承認済みだったlink/aliasを一度だけboundedに再検査する。 */
export const X_ID_SLOT_BIND_LEGACY_BACKFILL_LIMIT = 5;
const X_ID_SLOT_BIND_LEGACY_PROMOTION_STATEMENTS = 4;

const SLOT_BIND_REQUEST_TYPES = ["new_link", "existing_link", "alias"] as const;

type RecoveryEnv = {
  DB: D1Database;
  d1Budget?: D1Budget;
};

type PendingRequest = {
  id: string;
  request_type: (typeof SLOT_BIND_REQUEST_TYPES)[number];
  requested_by_auth_user_id: string;
  requested_x_id: string | null;
  target_x_user_id: string | null;
  slot_bind_status: "pending" | "complete";
  slot_bind_attempt_count: number;
  slot_bind_updated_at: number | null;
};

type SlotRow = {
  id: string;
  event_id: string;
  reserved_by_user_id: string;
  reserved_x_id_snapshot: string | null;
  version: number;
  updated_at: number;
  status: string;
  x_user_id: string | null;
};

type IdentityState = {
  submittedXUserId: string;
  bindTargetXUserId: string | null;
  allowNullSnapshot: boolean;
};

function recordD1Changes(metrics: { d1_changes: number } | undefined, result: D1Result<unknown>): void {
  if (metrics) metrics.d1_changes += Number(result.meta?.changes ?? 0);
}

function assertChanges(expected: number): string {
  return `SELECT CASE WHEN changes() = ${expected} THEN 1 ELSE json_extract('not-valid-json', '$') END`;
}

function hasD1Capacity(env: RecoveryEnv, requiredStatements = 1): boolean {
  return (
    !env.d1Budget ||
    env.d1Budget.statements + requiredStatements <= D1_QUERY_SOFT_LIMIT
  );
}

type CanonicalResolution = {
  value: string | null;
  budgetExhausted: boolean;
};

async function resolveCanonicalXUserId(
  env: RecoveryEnv,
  candidate: string | null | undefined,
): Promise<CanonicalResolution> {
  let current = normalizeXId(candidate);
  const seen = new Set<string>();
  for (let depth = 0; current && depth < 8; depth += 1) {
    if (seen.has(current)) return { value: null, budgetExhausted: false };
    seen.add(current);
    if (!hasD1Capacity(env)) {
      return { value: null, budgetExhausted: true };
    }
    const alias = await env.DB
      .prepare("SELECT x_user_id FROM x_user_aliases WHERE alias_x_id = ?1 LIMIT 1")
      .bind(current)
      .first<{ x_user_id: string }>();
    if (alias?.x_user_id) {
      current = normalizeXId(alias.x_user_id);
      continue;
    }
    if (!hasD1Capacity(env)) {
      return { value: null, budgetExhausted: true };
    }
    const row = await env.DB
      .prepare("SELECT id, approval_status FROM x_users WHERE id = ?1 LIMIT 1")
      .bind(current)
      .first<{ id: string; approval_status: string | null }>();
    // Slot bind is a public-facing identity side effect.  A pending/imported
    // x_users row may be linked for review, but it is not a safe bind target
    // until an admin has promoted it to approved.
    if (!row || row.approval_status !== "approved") {
      return { value: null, budgetExhausted: false };
    }
    return { value: row.id, budgetExhausted: false };
  }
  return { value: null, budgetExhausted: false };
}

async function canonicalizeCandidates(
  env: RecoveryEnv,
  values: readonly (string | null | undefined)[],
): Promise<{ values: string[]; budgetExhausted: boolean }> {
  const resolved: string[] = [];
  for (const value of values) {
    const normalized = normalizeXId(value);
    if (!normalized) continue;
    const canonical = await resolveCanonicalXUserId(env, normalized);
    if (canonical.budgetExhausted) {
      return { values: [], budgetExhausted: true };
    }
    resolved.push(canonical.value ?? normalized);
  }
  return {
    values: [...new Set(resolved.filter((value): value is string => Boolean(value)))],
    budgetExhausted: false,
  };
}

async function resolveIdentity(
  env: RecoveryEnv,
  request: PendingRequest,
): Promise<IdentityState> {
  const submittedXUserId = normalizeXId(request.requested_x_id);
  const bindTargetResolution =
    request.request_type === "alias"
      ? await resolveCanonicalXUserId(env, request.target_x_user_id)
      : await resolveCanonicalXUserId(env, submittedXUserId);
  const bindTargetXUserId = bindTargetResolution.value;
  if (!submittedXUserId || !bindTargetXUserId) {
    return {
      submittedXUserId,
      bindTargetXUserId: null,
      allowNullSnapshot: false,
    };
  }
  // Explicit snapshot matches can still be processed, but resolving the
  // approved/pending identity set is required before touching NULL snapshots.
  // Defer the request if the remaining invocation budget cannot cover those
  // two bounded list reads.
  if (bindTargetResolution.budgetExhausted || !hasD1Capacity(env, 2)) {
    return {
      submittedXUserId,
      bindTargetXUserId,
      allowNullSnapshot: false,
    };
  }

  const approvedRows = await env.DB
    .prepare(
      `SELECT l.x_user_id
       FROM x_user_account_links l
       INNER JOIN x_users x ON x.id = l.x_user_id
       WHERE l.auth_user_id = ?1 AND x.approval_status = 'approved'`,
    )
    .bind(request.requested_by_auth_user_id)
    .all<{ x_user_id: string }>();
  const pendingRows = await env.DB
    .prepare(
      `SELECT requested_x_id
       FROM x_identity_requests
       WHERE requested_by_auth_user_id = ?1
         AND status = 'pending'
         AND request_type IN ('new_link', 'existing_link', 'alias')
         AND requested_x_id IS NOT NULL`,
    )
    .bind(request.requested_by_auth_user_id)
    .all<{ requested_x_id: string }>();
  const approvedXIds = await canonicalizeCandidates(
    env,
    (approvedRows.results ?? []).map((row) => row.x_user_id),
  );
  if (approvedXIds.budgetExhausted) {
    return {
      submittedXUserId,
      bindTargetXUserId,
      allowNullSnapshot: false,
    };
  }
  const pendingXIds = await canonicalizeCandidates(
    env,
    (pendingRows.results ?? []).map((row) => row.requested_x_id),
  );
  if (pendingXIds.budgetExhausted) {
    return {
      submittedXUserId,
      bindTargetXUserId,
      allowNullSnapshot: false,
    };
  }
  return {
    submittedXUserId,
    bindTargetXUserId,
    allowNullSnapshot: canAutoBindUnassignedReservation({
      bindTargetXId: bindTargetXUserId,
      approvedXIds: approvedXIds.values,
      pendingXIds: pendingXIds.values,
    }),
  };
}

function snapshotFilterSql(identity: IdentityState): string {
  // 0053 backfills the legacy raw value. Keep candidate lookup aligned with
  // normalizeXId so casing, @ prefixes, and surrounding whitespace do not
  // leave an approved reservation permanently unbound.
  const normalized = "lower(trim(ltrim(reserved_x_id_snapshot, '@'))) = ?5";
  return identity.allowNullSnapshot
    ? `(reserved_x_id_snapshot IS NULL OR ${normalized})`
    : normalized;
}

function buildSlotUpdateStatement(
  env: RecoveryEnv,
  rows: readonly SlotRow[],
  request: PendingRequest,
  identity: IdentityState,
  now: number,
): D1PreparedStatement {
  const rowPredicates = rows
    .map(
      (_, index) =>
        `(id = ?${6 + index * 4} AND version = ?${7 + index * 4} AND updated_at = ?${8 + index * 4} AND reserved_x_id_snapshot IS ?${9 + index * 4})`,
    )
    .join(" OR ");
  const first = rows[0]!;
  const bindings: unknown[] = [
    identity.bindTargetXUserId,
    now,
    first.event_id,
    request.requested_by_auth_user_id,
    identity.submittedXUserId,
  ];
  for (const row of rows) {
    bindings.push(row.id, row.version, row.updated_at, row.reserved_x_id_snapshot);
  }
  const statement = `
    UPDATE slots
    SET x_user_id = ?1,
        updated_at = ?2,
        version = version + 1
    WHERE event_id = ?3
      AND status = 'reserved'
      AND x_user_id IS NULL
      AND reserved_by_user_id = ?4
      AND ${snapshotFilterSql(identity)}
      AND (${rowPredicates})`;
  return env.DB.prepare(statement).bind(...bindings);
}

function buildQueueStatement(
  env: RecoveryEnv,
  eventIds: readonly string[],
  request: PendingRequest,
  now: number,
): D1PreparedStatement | null {
  if (eventIds.length === 0) return null;
  const payload = JSON.stringify(
    eventIds.map((eventId) => ({
      id: `srb:x-id-slot-bind:${crypto.randomUUID()}`,
      target_type: "event_slots",
      target_id: eventId,
      reason: "x_id_approved_slot_bind_recovery",
      priority: "high",
      requested_by_user_id: request.requested_by_auth_user_id,
    })),
  );
  return env.DB.prepare(`
    INSERT INTO static_rebuild_queue (
      id, target_type, target_id, reason, priority, status,
      attempt_count, requested_by_user_id, created_at, updated_at
    )
    SELECT
      json_extract(incoming.value, '$.id'),
      json_extract(incoming.value, '$.target_type'),
      json_extract(incoming.value, '$.target_id'),
      json_extract(incoming.value, '$.reason'),
      json_extract(incoming.value, '$.priority'),
      'pending', 0,
      json_extract(incoming.value, '$.requested_by_user_id'),
      ?1, ?1
    FROM json_each(?2) AS incoming
    WHERE 1 = 1
    ON CONFLICT(target_type, target_id) WHERE status IN ('pending', 'processing')
    DO UPDATE SET
      reason = CASE
        WHEN excluded.priority = 'high' OR static_rebuild_queue.priority <> 'high'
          THEN excluded.reason ELSE static_rebuild_queue.reason END,
      priority = CASE
        WHEN static_rebuild_queue.priority = 'high' OR excluded.priority = 'high' THEN 'high'
        WHEN static_rebuild_queue.priority = 'normal' OR excluded.priority = 'normal' THEN 'normal'
        ELSE 'low' END,
      requested_by_user_id = COALESCE(excluded.requested_by_user_id, static_rebuild_queue.requested_by_user_id),
      updated_at = MAX(static_rebuild_queue.updated_at + 1, excluded.updated_at)
  `).bind(now, payload);
}

function buildAuditStatement(
  env: RecoveryEnv,
  request: PendingRequest,
  rows: readonly SlotRow[],
  targetXId: string | null,
  now: number,
  requestAfter?: Record<string, unknown>,
): D1PreparedStatement {
  const entries = [
    ...(requestAfter
      ? [
          {
            id: crypto.randomUUID(),
            table_name: "x_identity_requests",
            target_id: request.id,
            before_json: JSON.stringify(request),
            after_json: JSON.stringify(requestAfter),
            changed_keys_json: JSON.stringify([
              "slot_bind_status",
              "slot_bind_attempt_count",
              "slot_bind_updated_at",
            ]),
          },
        ]
      : []),
    ...rows.map((row) => ({
      id: crypto.randomUUID(),
      table_name: "slots",
      target_id: row.id,
      before_json: JSON.stringify(row),
      after_json: JSON.stringify({
        ...row,
        x_user_id: targetXId,
        updated_at: now,
        version: row.version + 1,
      }),
      changed_keys_json: JSON.stringify(["x_user_id", "updated_at", "version"]),
    })),
  ];
  return env.DB.prepare(`
    INSERT INTO audit_logs (
      id, table_name, target_id, operation, before_json, after_json,
      changed_keys_json, actor_user_id, actor_x_user_id, reason, context,
      retention_class, restore_strategy, restore_status, payload_size_bytes, created_at
    )
    SELECT
      json_extract(value, '$.id'), json_extract(value, '$.table_name'),
      json_extract(value, '$.target_id'), 'UPDATE',
      json_extract(value, '$.before_json'), json_extract(value, '$.after_json'),
      json_extract(value, '$.changed_keys_json'), ?1, NULL,
      'X ID承認後の予約枠bind recovery', 'x-identity-request:slot-bind:worker',
      'normal', 'none', 'not_restorable',
      length(json_extract(value, '$.before_json')) + length(json_extract(value, '$.after_json')),
      ?2
    FROM json_each(?3)
  `).bind(
    request.requested_by_auth_user_id,
    now,
    JSON.stringify(entries),
  );
}

async function markComplete(
  env: RecoveryEnv,
  request: PendingRequest,
  now: number,
  metrics: { d1_changes: number } | undefined,
): Promise<boolean> {
  const before = { ...request };
  const after = {
    ...request,
    slot_bind_status: "complete",
    slot_bind_updated_at: now,
  };
  const results = await env.DB.batch([
    env.DB
      .prepare(`
        UPDATE x_identity_requests
        SET slot_bind_status = 'complete', slot_bind_updated_at = ?1
        WHERE id = ?2
          AND status = 'approved'
          AND slot_bind_status = 'pending'
          AND slot_bind_updated_at IS ?3
          AND slot_bind_attempt_count = ?4
      `)
      .bind(now, request.id, request.slot_bind_updated_at, request.slot_bind_attempt_count),
    env.DB.prepare(assertChanges(1)),
    buildAuditStatement(env, request, [], null, now, after),
    env.DB.prepare(assertChanges(1)),
  ]);
  for (const result of results) recordD1Changes(metrics, result);
  return true;
}

async function loadPendingRequests(env: RecoveryEnv): Promise<PendingRequest[]> {
  const result = await env.DB
    .prepare(`
      SELECT id, request_type, requested_by_auth_user_id, requested_x_id,
             target_x_user_id, slot_bind_status, slot_bind_attempt_count,
             slot_bind_updated_at
      FROM x_identity_requests
      WHERE status = 'approved'
        AND slot_bind_status = 'pending'
        AND request_type IN ('new_link', 'existing_link', 'alias')
      ORDER BY COALESCE(slot_bind_updated_at, updated_at) ASC, id ASC
      LIMIT ?1
    `)
    .bind(X_ID_SLOT_BIND_RECOVERY_REQUEST_LIMIT)
    .all<PendingRequest>();
  return (result.results ?? []).filter((row) => row.slot_bind_status === "pending");
}

async function loadLegacyApprovedRequests(
  env: RecoveryEnv,
  limit: number,
): Promise<PendingRequest[]> {
  if (limit <= 0) return [];
  const result = await env.DB
    .prepare(`
      SELECT id, request_type, requested_by_auth_user_id, requested_x_id,
             target_x_user_id, slot_bind_status, slot_bind_attempt_count,
             slot_bind_updated_at
      FROM x_identity_requests
      WHERE status = 'approved'
        AND slot_bind_status = 'complete'
        AND slot_bind_updated_at IS NULL
        AND request_type IN ('new_link', 'existing_link', 'alias')
      ORDER BY updated_at ASC, id ASC
      LIMIT ?1
    `)
    .bind(limit)
    .all<PendingRequest>();
  return (result.results ?? []).filter(
    (row) =>
      row.slot_bind_status === "complete" &&
      row.slot_bind_updated_at === null,
  );
}

async function promoteLegacyApprovedRequest(
  env: RecoveryEnv,
  request: PendingRequest,
  now: number,
  metrics: { d1_changes: number } | undefined,
): Promise<PendingRequest | null> {
  const after = {
    ...request,
    slot_bind_status: "pending" as const,
    slot_bind_updated_at: now,
  };
  const results = await env.DB.batch([
    env.DB
      .prepare(`
        UPDATE x_identity_requests
        SET slot_bind_status = 'pending', slot_bind_updated_at = ?1
        WHERE id = ?2
          AND status = 'approved'
          AND slot_bind_status = 'complete'
          AND slot_bind_updated_at IS NULL
      `)
      .bind(now, request.id),
    env.DB.prepare(assertChanges(1)),
    buildAuditStatement(env, request, [], null, now, after),
    env.DB.prepare(assertChanges(1)),
  ]);
  for (const result of results) recordD1Changes(metrics, result);
  return after;
}

async function loadCandidateSlots(
  env: RecoveryEnv,
  request: PendingRequest,
  identity: IdentityState,
): Promise<SlotRow[]> {
  const result = await env.DB
    .prepare(`
      SELECT id, event_id, reserved_by_user_id, reserved_x_id_snapshot,
             version, updated_at, status, x_user_id
      FROM slots
      WHERE reserved_by_user_id = ?1
        AND status = 'reserved'
        AND x_user_id IS NULL
        AND ${identity.allowNullSnapshot
          ? "(reserved_x_id_snapshot IS NULL OR lower(trim(ltrim(reserved_x_id_snapshot, '@'))) = ?2)"
          : "lower(trim(ltrim(reserved_x_id_snapshot, '@'))) = ?2"}
      ORDER BY event_id ASC, start_time ASC, sort_order ASC, id ASC
      LIMIT ?3
    `)
    .bind(
      request.requested_by_auth_user_id,
      identity.submittedXUserId,
      X_ID_SLOT_BIND_RECOVERY_SLOT_LIMIT,
    )
    .all<SlotRow>();
  return (result.results ?? []) as SlotRow[];
}

async function hasMoreCandidates(
  env: RecoveryEnv,
  request: PendingRequest,
  identity: IdentityState,
): Promise<boolean> {
  const row = await env.DB
    .prepare(`
      SELECT 1 AS found
      FROM slots
      WHERE reserved_by_user_id = ?1
        AND status = 'reserved'
        AND x_user_id IS NULL
        AND ${identity.allowNullSnapshot
          ? "(reserved_x_id_snapshot IS NULL OR lower(trim(ltrim(reserved_x_id_snapshot, '@'))) = ?2)"
          : "lower(trim(ltrim(reserved_x_id_snapshot, '@'))) = ?2"}
      LIMIT 1
    `)
    .bind(request.requested_by_auth_user_id, identity.submittedXUserId)
    .first<{ found: number }>();
  return row?.found === 1;
}

async function bindOneRequest(
  env: RecoveryEnv,
  request: PendingRequest,
  signal?: AbortSignal,
  metrics?: { d1_changes: number },
): Promise<{ complete: boolean; bound: number }> {
  if (signal?.aborted) throw signal.reason ?? new Error("slot bind recovery aborted");
  const identity = await resolveIdentity(env, request);
  if (env.d1Budget && isD1BudgetExhausted(env.d1Budget)) {
    return { complete: false, bound: 0 };
  }
  const now = Math.floor(Date.now() / 1000);
  const rows = identity.bindTargetXUserId
    ? await loadCandidateSlots(env, request, identity)
    : [];
  if (rows.length === 0) {
    if (
      env.d1Budget &&
      env.d1Budget.statements + 4 > D1_QUERY_SOFT_LIMIT
    ) {
      return { complete: false, bound: 0 };
    }
    await markComplete(env, request, now, metrics);
    return { complete: true, bound: 0 };
  }
  if (
    env.d1Budget &&
    env.d1Budget.statements + X_ID_SLOT_BIND_RECOVERY_BATCH_RESERVE >
      D1_QUERY_SOFT_LIMIT
  ) {
    return { complete: false, bound: 0 };
  }

  const attemptAfter = {
    ...request,
    slot_bind_attempt_count: request.slot_bind_attempt_count + 1,
    slot_bind_updated_at: now,
  };
  const statements: D1PreparedStatement[] = [
    env.DB
      .prepare(`
        UPDATE x_identity_requests
        SET slot_bind_attempt_count = slot_bind_attempt_count + 1,
            slot_bind_updated_at = ?1
        WHERE id = ?2
          AND status = 'approved'
          AND slot_bind_status = 'pending'
          AND slot_bind_updated_at IS ?3
          AND slot_bind_attempt_count = ?4
      `)
      .bind(now, request.id, request.slot_bind_updated_at, request.slot_bind_attempt_count),
    env.DB.prepare(assertChanges(1)),
  ];
  const eventIds = [...new Set(rows.map((row) => row.event_id))];
  const byEvent = new Map<string, SlotRow[]>();
  for (const row of rows) {
    const eventRows = byEvent.get(row.event_id) ?? [];
    eventRows.push(row);
    byEvent.set(row.event_id, eventRows);
  }
  let bound = 0;
  for (const eventRows of byEvent.values()) {
    for (
      let offset = 0;
      offset < eventRows.length;
      offset += X_ID_SLOT_BIND_RECOVERY_MAX_ATOMIC_ROWS
    ) {
      const chunk = eventRows.slice(
        offset,
        offset + X_ID_SLOT_BIND_RECOVERY_MAX_ATOMIC_ROWS,
      );
      statements.push(
        buildSlotUpdateStatement(env, chunk, request, identity, now),
        env.DB.prepare(assertChanges(chunk.length)),
      );
      bound += chunk.length;
    }
  }
  const queue = buildQueueStatement(env, eventIds, request, now);
  if (queue) statements.push(queue);
  statements.push(
    buildAuditStatement(env, request, rows, identity.bindTargetXUserId, now, attemptAfter),
    env.DB.prepare(assertChanges(rows.length + 1)),
  );
  const results = await env.DB.batch(statements);
  for (const result of results) recordD1Changes(metrics, result);

  // The post-bind existence check is another D1 statement. If the soft
  // limit was reached by the batch, defer both the check and completion to
  // the next recovery invocation instead of issuing statement N+1.
  if (env.d1Budget && isD1BudgetExhausted(env.d1Budget)) {
    return { complete: false, bound };
  }

  const hasMore = await hasMoreCandidates(env, request, identity);
  if (hasMore) return { complete: false, bound };

  const updatedRequest = {
    ...request,
    slot_bind_attempt_count: request.slot_bind_attempt_count + 1,
    slot_bind_updated_at: now,
  };
  if (
    env.d1Budget &&
    env.d1Budget.statements + 4 > D1_QUERY_SOFT_LIMIT
  ) {
    // The candidate set is empty, but there is not enough budget left for
    // the CAS + audit completion batch. Keep the request pending so the next
    // invocation can complete it durably.
    return { complete: false, bound };
  }

  const markedComplete = await markComplete(
    env,
    updatedRequest,
    Math.floor(Date.now() / 1000),
    metrics,
  );
  return { complete: markedComplete, bound };
}

export async function reconcilePendingXIdSlotBinds(
  env: RecoveryEnv,
  signal?: AbortSignal,
  metrics?: { d1_changes: number },
): Promise<{ processed: number; completed: number; bound: number; failed: number; hasMore: boolean }> {
  const pendingRequests = await loadPendingRequests(env);
  const legacyCapacity = Math.max(
    0,
    X_ID_SLOT_BIND_RECOVERY_REQUEST_LIMIT - pendingRequests.length,
  );
  let legacyRequests: PendingRequest[] = [];
  if (
    legacyCapacity > 0 &&
    (!env.d1Budget ||
      env.d1Budget.statements +
        1 +
        legacyCapacity * X_ID_SLOT_BIND_LEGACY_PROMOTION_STATEMENTS <=
        D1_QUERY_SOFT_LIMIT)
  ) {
    const candidates = await loadLegacyApprovedRequests(
      env,
      Math.min(legacyCapacity, X_ID_SLOT_BIND_LEGACY_BACKFILL_LIMIT),
    );
    for (const candidate of candidates) {
      if (signal?.aborted) {
        throw signal.reason ?? new Error("slot bind recovery aborted");
      }
      try {
        const promoted = await promoteLegacyApprovedRequest(
          env,
          candidate,
          Math.floor(Date.now() / 1000),
          metrics,
        );
        if (promoted) legacyRequests.push(promoted);
      } catch (error) {
        console.error("[content-jobs] legacy X ID slot bind promotion failed", {
          request_id: candidate.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  const requests = [...pendingRequests, ...legacyRequests];
  let processed = 0;
  let completed = 0;
  let bound = 0;
  let failed = 0;
  for (const request of requests) {
    if (signal?.aborted) throw signal.reason ?? new Error("slot bind recovery aborted");
    if (env.d1Budget && isD1BudgetExhausted(env.d1Budget)) break;
    try {
      const result = await bindOneRequest(env, request, signal, metrics);
      processed += 1;
      bound += result.bound;
      if (result.complete) completed += 1;
    } catch (error) {
      failed += 1;
      console.error("[content-jobs] X ID slot bind recovery failed", {
        request_id: request.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    processed,
    completed,
    bound,
    failed,
    hasMore: requests.length >= X_ID_SLOT_BIND_RECOVERY_REQUEST_LIMIT,
  };
}
