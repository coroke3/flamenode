/**
 * MIG-0602 U02: raw-D1 mutation + audit module (decision D-0602-1 Option A,
 * pending owner confirmation; kept as one self-contained module so it can be
 * replaced by a shared core later).
 *
 * Mirrors CURRENT src/lib/audit/mutate.ts `mutateWithAudit` and
 * src/lib/audit/logger.ts `prepareAuditLogEntries` for the subset used by
 * SA-004..008:
 *   - one D1 batch = mutation statements, each followed by a `changes()`
 *     assertion, then audit_logs INSERT (+ count assertion) per chunk
 *   - audit entries are always strict (settings / actor snapshot read errors
 *     throw), restore_strategy is always "none" (capability reason
 *     strategy_none / payload_exceeded), no actor_x_user_id
 *   - D1 query budget (50) and bind limit (100) checks are preserved
 *
 * Parity of the written audit rows is pinned by
 * apps/api/test/auditParity.test.mjs against CURRENT prepareAuditLogEntries.
 */
import {
  BLOCKED_TABLES,
  buildInversePatch,
  calculatePayloadSize,
  computeChangedKeys,
  sanitizeForAudit,
} from "./snapshot.ts";

export type SqlStatement = { sql: string; params: readonly unknown[] };

export type AuditOperation =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "RESTORE"
  | "STATUS_CHANGE"
  | "MERGE"
  | "SYSTEM";
export type RetentionClass = "normal" | "restorable" | "long_audit";

export type AuditInput = {
  table_name: string;
  target_id: string;
  operation: AuditOperation;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  actor_user_id: string;
  reason?: string | null;
  context?: string | null;
  retention_class?: RetentionClass;
};

/** Single-row point reads (ZERO_1102 section 4: bounded reads). */
export const MAX_SINGLE_ROW_LIMIT = 1;

/** Columns of system_settings that hold audit settings (shared with CostGuard's single read). */
export type AuditSettingsRow = {
  audit_normal_retention_days: number;
  audit_restorable_retention_days: number;
  audit_long_retention_days: number;
  audit_max_payload_bytes: number;
  audit_compact_after_days: number;
};

/** src/lib/audit/settings.ts mapAuditSettings. */
export function mapAuditSettings(
  row: AuditSettingsRow | null | undefined,
): AuditLogSettings {
  if (!row) return { ...DEFAULT_AUDIT_LOG_SETTINGS };
  return {
    normal_retention_days: row.audit_normal_retention_days,
    restorable_retention_days: row.audit_restorable_retention_days,
    long_audit_retention_days: row.audit_long_retention_days,
    max_payload_bytes: row.audit_max_payload_bytes,
    compact_after_days: row.audit_compact_after_days,
  };
}

/**
 * Values already read by the request's guards (ZERO_1102 S3: at most 3 D1
 * pre-reads). When present, prepareAuditEntries skips the corresponding read.
 * actorSnapshotJsonById holds the exact JSON buildActorSnapshotJson would build.
 */
export type PreloadedAuditContext = {
  settings?: AuditLogSettings;
  actorSnapshotJsonById?: Readonly<Record<string, string>>;
};

export type AuditLogSettings = {
  normal_retention_days: number;
  restorable_retention_days: number;
  long_audit_retention_days: number;
  max_payload_bytes: number;
  compact_after_days: number;
};

export const DEFAULT_AUDIT_LOG_SETTINGS: AuditLogSettings = {
  normal_retention_days: 30,
  restorable_retention_days: 180,
  long_audit_retention_days: 365,
  max_payload_bytes: 120_000,
  compact_after_days: 30,
};

export type PreparedAuditEntry = {
  id: string;
  table_name: string;
  target_id: string;
  operation: AuditOperation;
  before_json: string | null;
  after_json: string | null;
  changed_keys_json: string | null;
  inverse_patch_json: string | null;
  actor_user_id: string;
  actor_x_user_id: string | null;
  actor_snapshot_json: string | null;
  reason: string | null;
  context: string | null;
  retention_class: RetentionClass;
  restore_strategy: "none";
  restore_status: "not_restorable";
  restore_unavailable_reason_code: string;
  restore_unavailable_message: string;
  payload_size_bytes: number;
  expires_at: number | null;
  created_at: number;
};

export class AuditMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditMutationError";
  }
}

// ---- budget (src/lib/audit/mutateBudget.ts) ------------------------------
export const D1_MAX_BIND_PARAMETERS = 100;
export const D1_MAX_BATCH_QUERIES = 50;
export const D1_RESERVED_CALLER_QUERIES = 18;
export const AUDIT_INSERT_BIND_COUNT_PER_ENTRY = 21;
export const AUDIT_INSERT_CHUNK_SIZE = Math.min(
  Math.floor(D1_MAX_BIND_PARAMETERS / AUDIT_INSERT_BIND_COUNT_PER_ENTRY),
  D1_MAX_BIND_PARAMETERS - 1,
);

const AUDIT_COLUMNS = `
  id, table_name, target_id, operation, before_json, after_json,
  changed_keys_json, inverse_patch_json, actor_user_id, actor_x_user_id, actor_snapshot_json,
  reason, context, retention_class, restore_strategy, restore_status,
  payload_size_bytes, expires_at, created_at,
  restore_unavailable_reason_code, restore_unavailable_message
`;

const EMPTY_ACTOR_JSON = JSON.stringify({
  discord_id: null,
  discord_name: null,
  x_user_id: null,
  x_name: null,
  icon_url: null,
});

const RETENTION_RANGES: Record<RetentionClass, { min: number; max: number }> = {
  normal: { min: 7, max: 365 },
  restorable: { min: 14, max: 1095 },
  long_audit: { min: 30, max: 3650 },
};

function computeExpiresAt(
  createdAt: number,
  retentionClass: RetentionClass,
  settings: AuditLogSettings,
): number {
  const raw =
    retentionClass === "normal"
      ? settings.normal_retention_days
      : retentionClass === "restorable"
        ? settings.restorable_retention_days
        : settings.long_audit_retention_days;
  const range = RETENTION_RANGES[retentionClass];
  const days = Math.max(range.min, Math.min(range.max, Math.round(raw)));
  return createdAt + days * 86400;
}

/** src/lib/utils/id.ts generateId (Web Crypto only; fail closed). */
export function generateId(prefix?: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error("secure_random_unavailable");
  return prefix ? `${prefix}_${uuid}` : uuid;
}

export function planAuditBudget(input: {
  mutationStatementCount: number;
  mutationAssertionCount: number;
  auditEntryCount: number;
  distinctActorCount: number;
  callerQueryCount?: number;
}): { totalQueryCount: number; withinLimit: boolean } {
  const auditChunkCount =
    input.auditEntryCount > 0
      ? Math.ceil(input.auditEntryCount / AUDIT_INSERT_CHUNK_SIZE)
      : 0;
  const preparation =
    input.auditEntryCount > 0 ? 1 + Math.max(0, input.distinctActorCount) : 0;
  const batch =
    input.mutationStatementCount +
    input.mutationAssertionCount +
    auditChunkCount * 2;
  const total =
    preparation + batch + (input.callerQueryCount ?? D1_RESERVED_CALLER_QUERIES);
  return { totalQueryCount: total, withinLimit: total <= D1_MAX_BATCH_QUERIES };
}

// ---- preparation (src/lib/audit/logger.ts) --------------------------------

async function loadAuditSettings(db: D1Database): Promise<AuditLogSettings> {
  const row = await db
    .prepare(
      `SELECT audit_normal_retention_days, audit_restorable_retention_days,
              audit_long_retention_days, audit_max_payload_bytes, audit_compact_after_days
       FROM system_settings WHERE id = ? LIMIT ${MAX_SINGLE_ROW_LIMIT}`,
    )
    .bind("default")
    .first<{
      audit_normal_retention_days: number;
      audit_restorable_retention_days: number;
      audit_long_retention_days: number;
      audit_max_payload_bytes: number;
      audit_compact_after_days: number;
    }>();
  return mapAuditSettings(row);
}

export type ActorSnapshotRow = {
  discord_id: string | null;
  discord_name: string | null;
  active_x_user_id: string | null;
  user_image: string | null;
  x_name: string | null;
  x_icon_url: string | null;
};

/** src/lib/audit/logger.ts buildActorSnapshot (row -> JSON string). */
export function actorSnapshotJsonFromRow(
  row: ActorSnapshotRow | null | undefined,
): string {
  if (!row) return EMPTY_ACTOR_JSON;
  return JSON.stringify({
    discord_id: row.discord_id ?? null,
    discord_name: row.discord_name ?? null,
    x_user_id: row.active_x_user_id ?? null,
    x_name: row.x_name ?? null,
    icon_url: row.x_icon_url || row.user_image || null,
  });
}

async function buildActorSnapshotJson(
  db: D1Database,
  userId: string,
): Promise<string> {
  const row = await db
    .prepare(
      `SELECT u."discord_id" AS discord_id, u."name" AS discord_name,
              u."active_x_user_id" AS active_x_user_id, u."image" AS user_image,
              x."x_name" AS x_name, x."icon_url" AS x_icon_url
       FROM "user" u LEFT JOIN "x_users" x ON x."id" = u."active_x_user_id"
       WHERE u."id" = ? LIMIT ${MAX_SINGLE_ROW_LIMIT}`,
    )
    .bind(userId)
    .first<ActorSnapshotRow>();
  return actorSnapshotJsonFromRow(row);
}

/**
 * Pure part of buildPreparedAuditLogEntry: deterministic except id/created_at,
 * which come from `generateId("audit")` and `Date.now()` exactly as CURRENT.
 */
export function buildPreparedAuditEntry(
  input: AuditInput,
  settings: AuditLogSettings,
  actorJson: string,
): PreparedAuditEntry | null {
  if (BLOCKED_TABLES.has(input.table_name)) return null;
  const retentionClass: RetentionClass = input.retention_class ?? "normal";
  const sanitizedBefore = sanitizeForAudit(
    input.before ?? null,
    Number.MAX_SAFE_INTEGER,
  );
  const sanitizedAfter = sanitizeForAudit(
    input.after ?? null,
    Number.MAX_SAFE_INTEGER,
  );
  const beforeJson = sanitizedBefore ? JSON.stringify(sanitizedBefore) : null;
  const afterJson = sanitizedAfter ? JSON.stringify(sanitizedAfter) : null;
  const payloadSize = calculatePayloadSize(beforeJson, afterJson);
  const payloadExceeded = payloadSize > settings.max_payload_bytes;

  const changedKeys = payloadExceeded
    ? []
    : computeChangedKeys(sanitizedBefore, sanitizedAfter);
  const inversePatch = payloadExceeded
    ? null
    : buildInversePatch(sanitizedBefore, sanitizedAfter);
  const now = Math.floor(Date.now() / 1000);

  // evaluateRestoreCapability with strategy "none": payloadExceeded wins,
  // otherwise strategy_none.
  const unavailable = payloadExceeded
    ? {
        code: "payload_exceeded",
        message: "監査ペイロードが上限を超えたため復元できません。",
      }
    : {
        code: "strategy_none",
        message: "この監査操作には復元戦略がありません。",
      };

  return {
    id: generateId("audit"),
    table_name: input.table_name,
    target_id: input.target_id,
    operation: input.operation,
    before_json: payloadExceeded ? null : beforeJson,
    after_json: payloadExceeded ? null : afterJson,
    changed_keys_json: changedKeys.length > 0 ? JSON.stringify(changedKeys) : null,
    inverse_patch_json: inversePatch ? JSON.stringify(inversePatch) : null,
    actor_user_id: input.actor_user_id,
    actor_x_user_id: null,
    actor_snapshot_json: actorJson,
    reason: input.reason ?? null,
    context: input.context ?? null,
    retention_class: retentionClass,
    restore_strategy: "none",
    restore_status: "not_restorable",
    restore_unavailable_reason_code: unavailable.code,
    restore_unavailable_message: unavailable.message,
    payload_size_bytes: payloadSize,
    expires_at: computeExpiresAt(now, retentionClass, settings),
    created_at: now,
  };
}

/** Strict preparation: any read error propagates (CURRENT strict: true). */
export async function prepareAuditEntries(
  db: D1Database,
  inputs: readonly AuditInput[],
  preloaded: PreloadedAuditContext = {},
): Promise<(PreparedAuditEntry | null)[]> {
  const active = inputs.filter((input) => !BLOCKED_TABLES.has(input.table_name));
  if (active.length === 0) return inputs.map(() => null);

  const settings = preloaded.settings ?? (await loadAuditSettings(db));
  const actorJsonById = new Map<string, string>();
  const actorIds = [...new Set(active.map((input) => input.actor_user_id))];
  for (let offset = 0; offset < actorIds.length; offset += 4) {
    await Promise.all(
      actorIds.slice(offset, offset + 4).map(async (actorId) => {
        const known = preloaded.actorSnapshotJsonById?.[actorId];
        if (known !== undefined) {
          actorJsonById.set(actorId, known);
          return;
        }
        actorJsonById.set(actorId, await buildActorSnapshotJson(db, actorId));
      }),
    );
  }
  return inputs.map((input) =>
    buildPreparedAuditEntry(
      input,
      settings,
      actorJsonById.get(input.actor_user_id) ?? EMPTY_ACTOR_JSON,
    ),
  );
}

// ---- batch (src/lib/audit/mutate.ts) --------------------------------------

export function assertChanges(expectedChanges: number): SqlStatement {
  return {
    sql: `SELECT CASE WHEN changes() = ? THEN 1 ELSE json_extract('not-valid-json', '$') END`,
    params: [expectedChanges],
  };
}

function auditInsert(entries: readonly PreparedAuditEntry[]): SqlStatement {
  const params: unknown[] = [];
  const selects = entries.map((entry) => {
    params.push(
      entry.id, entry.table_name, entry.target_id, entry.operation,
      entry.before_json, entry.after_json, entry.changed_keys_json,
      entry.inverse_patch_json, entry.actor_user_id, entry.actor_x_user_id,
      entry.actor_snapshot_json, entry.reason, entry.context,
      entry.retention_class, entry.restore_strategy, entry.restore_status,
      entry.payload_size_bytes, entry.expires_at, entry.created_at,
      entry.restore_unavailable_reason_code, entry.restore_unavailable_message,
    );
    return `SELECT ${Array(AUDIT_INSERT_BIND_COUNT_PER_ENTRY).fill("?").join(", ")} WHERE (1 = 1)`;
  });
  return {
    sql: `INSERT INTO audit_logs (${AUDIT_COLUMNS}) ${selects.join(" UNION ALL ")}`,
    params,
  };
}

function auditAssertion(entries: readonly PreparedAuditEntry[]): SqlStatement {
  return {
    sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM audit_logs WHERE id IN (${entries
      .map(() => "?")
      .join(", ")})) = ? THEN 1 ELSE json_extract('not-valid-json', '$') END`,
    params: [...entries.map((entry) => entry.id), entries.length],
  };
}

export type AtomicAuditMutationInput = {
  mutationStatements: readonly SqlStatement[];
  /** Per-statement expected changes; null skips the assertion (idempotent INSERT). */
  expectedMutationChanges: readonly (number | null)[];
  audits: readonly AuditInput[];
  callerQueryCount?: number;
  /** Values the request guards already read (skips those D1 reads). */
  preloaded?: PreloadedAuditContext;
};

/**
 * All-or-nothing: mutation + changes() assertions + audit INSERT + count
 * assertion in one D1 batch. Returns the audit ids. Any failure rejects and
 * D1 rolls the batch back.
 */
export async function mutateWithAudit(
  db: D1Database,
  input: AtomicAuditMutationInput,
): Promise<string[]> {
  if (input.mutationStatements.length === 0) {
    throw new AuditMutationError("原子的監査 mutation に本体 SQL がありません。");
  }
  if (input.audits.length === 0) {
    throw new AuditMutationError("重要 mutation には監査ログが必要です。");
  }
  if (input.expectedMutationChanges.length !== input.mutationStatements.length) {
    throw new AuditMutationError(
      "原子的監査 mutation の件数検査と本体 SQL の数が一致しません。",
    );
  }
  const budget = planAuditBudget({
    mutationStatementCount: input.mutationStatements.length,
    mutationAssertionCount: input.expectedMutationChanges.filter(
      (expected) => expected !== null,
    ).length,
    auditEntryCount: input.audits.length,
    distinctActorCount: new Set(input.audits.map((audit) => audit.actor_user_id))
      .size,
    callerQueryCount: input.callerQueryCount,
  });
  if (!budget.withinLimit) {
    throw new AuditMutationError(
      `監査前処理と D1 batch の query 数が上限を超えるため拒否しました（${budget.totalQueryCount}/${D1_MAX_BATCH_QUERIES}）。`,
    );
  }
  for (const [index, statement] of input.mutationStatements.entries()) {
    if (statement.params.length > D1_MAX_BIND_PARAMETERS) {
      throw new AuditMutationError(
        `D1 statement ${index + 1} のbind数 ${statement.params.length} が上限 ${D1_MAX_BIND_PARAMETERS} を超えます。`,
      );
    }
  }

  const prepared = await prepareAuditEntries(db, input.audits, input.preloaded);
  const entries = prepared.map((entry, index) => {
    if (!entry) {
      throw new AuditMutationError(
        `テーブル「${input.audits[index].table_name}」の監査ログを作成できません。`,
      );
    }
    return entry;
  });

  const batch: SqlStatement[] = input.mutationStatements.flatMap(
    (statement, index) => {
      const expected = input.expectedMutationChanges[index];
      return expected === null ? [statement] : [statement, assertChanges(expected)];
    },
  );
  for (let offset = 0; offset < entries.length; offset += AUDIT_INSERT_CHUNK_SIZE) {
    const chunk = entries.slice(offset, offset + AUDIT_INSERT_CHUNK_SIZE);
    batch.push(auditInsert(chunk), auditAssertion(chunk));
  }

  await db.batch(
    batch.map((statement) => db.prepare(statement.sql).bind(...statement.params)),
  );
  return entries.map((entry) => entry.id);
}
