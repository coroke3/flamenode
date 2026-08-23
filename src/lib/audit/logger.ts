import { eq, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { auditLogs, users, xUsers, xUserAccountLinks } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import type {
  AuditOperation,
  RetentionClass,
  RestoreStatus,
  WriteAuditLogInput,
  ActorSnapshot,
} from "./types";
import { RestoreStrategy } from "./types";
import {
  sanitizeForAudit,
  computeChangedKeys,
  buildInversePatch,
  calculatePayloadSize,
  BLOCKED_TABLES,
} from "./snapshot";
import { computeExpiresAt, DEFAULT_AUDIT_LOG_SETTINGS } from "./retention";
import { getAuditLogSettings } from "./settings";
import { evaluateRestoreCapability } from "./capability";

async function buildActorSnapshot(
  db: DB,
  userId: string,
): Promise<ActorSnapshot> {
  const row = await db
    .select({
      discord_id: users.discord_id,
      discord_name: users.name,
      active_x_user_id: users.active_x_user_id,
      user_image: users.image,
      x_name: xUsers.x_name,
      x_icon_url: xUsers.icon_url,
    })
    .from(users)
    .leftJoin(xUsers, eq(xUsers.id, users.active_x_user_id))
    .where(eq(users.id, userId))
    .get();

  if (!row) {
    return {
      discord_id: null,
      discord_name: null,
      x_user_id: null,
      x_name: null,
      icon_url: null,
    };
  }

  return {
    discord_id: row.discord_id ?? null,
    discord_name: row.discord_name ?? null,
    x_user_id: row.active_x_user_id ?? null,
    x_name: row.x_name ?? null,
    icon_url: row.x_icon_url || row.user_image || null,
  };
}

export type PreparedAuditLogEntry = {
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
  restore_strategy: RestoreStrategy;
  restore_status: RestoreStatus;
  restore_unavailable_reason_code: string | null;
  restore_unavailable_message: string | null;
  payload_size_bytes: number;
  expires_at: number | null;
  created_at: number;
};

const EMPTY_ACTOR_JSON = JSON.stringify({
  discord_id: null,
  discord_name: null,
  x_user_id: null,
  x_name: null,
  icon_url: null,
});

function actorXPairKey(actorUserId: string, actorXUserId: string): string {
  return `${actorUserId}\u0000${actorXUserId.trim().toLowerCase()}`;
}

/**
 * 全auditのactor/X ID連携をJSON1 1 queryで検証する。
 * entryごとのSELECTを避け、mutateWithAuditのD1 query budgetと実消費を一致させる。
 */
async function loadApprovedActorXPairs(
  db: DB,
  inputs: readonly WriteAuditLogInput[],
): Promise<Set<string>> {
  const pairs = Array.from(
    new Map(
      inputs
        .map((input) => ({
          actor_user_id: input.actor_user_id,
          x_user_id: input.actor_x_user_id?.trim().toLowerCase() || "",
        }))
        .filter((pair) => pair.x_user_id)
        .map((pair) => [actorXPairKey(pair.actor_user_id, pair.x_user_id), pair] as const),
    ).values(),
  );
  if (pairs.length === 0) return new Set();

  const payload = JSON.stringify(pairs);
  const rows = await db
    .select({
      auth_user_id: xUserAccountLinks.auth_user_id,
      x_user_id: xUserAccountLinks.x_user_id,
    })
    .from(xUserAccountLinks)
    .innerJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
    .where(sql`
      ${xUsers.approval_status} = 'approved'
      AND EXISTS (
        SELECT 1
        FROM json_each(${payload}) AS requested_pairs
        WHERE CAST(json_extract(requested_pairs.value, '$.actor_user_id') AS TEXT)
                = ${xUserAccountLinks.auth_user_id}
          AND lower(CAST(json_extract(requested_pairs.value, '$.x_user_id') AS TEXT))
                = lower(${xUserAccountLinks.x_user_id})
      )
    `);

  return new Set(
    rows.map((row) => actorXPairKey(row.auth_user_id, row.x_user_id)),
  );
}

function buildPreparedAuditLogEntry(
  input: WriteAuditLogInput,
  settings: typeof DEFAULT_AUDIT_LOG_SETTINGS,
  actorJson: string,
  actorXUserId: string | null,
): PreparedAuditLogEntry | null {
  if (BLOCKED_TABLES.has(input.table_name)) return null;

  const retentionClass: RetentionClass = input.retention_class ?? "normal";
  const restoreStrategy: RestoreStrategy =
    input.restore_strategy ?? RestoreStrategy.none;
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

  // 大きなsnapshotは最終的にbefore/afterを保存しない。以前はこの判定後も
  // rows配列などをcomputeChangedKeys/buildInversePatchで再JSON.stringifyしており、
  // 100人×多数chapterの保存でWorker CPUを無駄に消費していた。
  const changedKeys = payloadExceeded
    ? []
    : computeChangedKeys(sanitizedBefore, sanitizedAfter);
  const inversePatch = payloadExceeded
    ? null
    : buildInversePatch(sanitizedBefore, sanitizedAfter);
  const changedKeysJson = changedKeys.length > 0 ? JSON.stringify(changedKeys) : null;
  const inversePatchJson = inversePatch ? JSON.stringify(inversePatch) : null;
  const finalBeforeJson = payloadExceeded ? null : beforeJson;
  const finalAfterJson = payloadExceeded ? null : afterJson;
  const capability = evaluateRestoreCapability({
    tableName: input.table_name,
    strategy: restoreStrategy,
    before: payloadExceeded ? null : sanitizedBefore,
    after: payloadExceeded ? null : sanitizedAfter,
    payloadExceeded,
  });
  const now = Math.floor(Date.now() / 1000);

  return {
    id: generateId("audit"),
    table_name: input.table_name,
    target_id: input.target_id,
    operation: input.operation,
    before_json: finalBeforeJson,
    after_json: finalAfterJson,
    changed_keys_json: changedKeysJson,
    inverse_patch_json: inversePatchJson,
    actor_user_id: input.actor_user_id,
    actor_x_user_id: actorXUserId,
    actor_snapshot_json: actorJson,
    reason: input.reason ?? null,
    context: input.context ?? null,
    retention_class: retentionClass,
    restore_strategy: restoreStrategy,
    restore_status: capability.status,
    restore_unavailable_reason_code: capability.restorable
      ? null
      : capability.reasonCode,
    restore_unavailable_message: capability.restorable
      ? null
      : capability.message,
    payload_size_bytes: payloadSize,
    expires_at: computeExpiresAt(now, retentionClass, settings),
    created_at: now,
  };
}

/** Prepare audit entries with bounded queries independent of entry count. */
export async function prepareAuditLogEntries(
  db: DB,
  inputs: readonly WriteAuditLogInput[],
): Promise<(PreparedAuditLogEntry | null)[]> {
  const activeInputs = inputs.filter((input) => !BLOCKED_TABLES.has(input.table_name));
  if (activeInputs.length === 0) return inputs.map(() => null);

  let settings = DEFAULT_AUDIT_LOG_SETTINGS;
  try {
    settings = await getAuditLogSettings(db);
  } catch (error) {
    if (inputs.some((input) => input.strict)) throw error;
  }

  const actorJsonById = new Map<string, string>();
  const actorUserIds = [
    ...new Set(activeInputs.map((input) => input.actor_user_id)),
  ];
  for (let offset = 0; offset < actorUserIds.length; offset += 4) {
    await Promise.all(
      actorUserIds.slice(offset, offset + 4).map(async (actorUserId) => {
        try {
          actorJsonById.set(
            actorUserId,
            JSON.stringify(await buildActorSnapshot(db, actorUserId)),
          );
        } catch (error) {
          if (
            inputs.some(
              (input) => input.strict && input.actor_user_id === actorUserId,
            )
          ) {
            throw error;
          }
          actorJsonById.set(actorUserId, EMPTY_ACTOR_JSON);
        }
      }),
    );
  }

  let approvedActorXPairs = new Set<string>();
  try {
    approvedActorXPairs = await loadApprovedActorXPairs(db, activeInputs);
  } catch (error) {
    if (
      activeInputs.some(
        (input) => Boolean(input.strict && input.actor_x_user_id?.trim()),
      )
    ) {
      throw error;
    }
  }

  const actorXUserIdByInput = new Map<WriteAuditLogInput, string | null>();
  for (const input of activeInputs) {
    const normalized = input.actor_x_user_id?.trim().toLowerCase() || null;
    if (!normalized) {
      actorXUserIdByInput.set(input, null);
      continue;
    }
    const linked = approvedActorXPairs.has(
      actorXPairKey(input.actor_user_id, normalized),
    );
    if (!linked && input.strict) {
      throw new Error("actor_x_user_id is not linked to actor_user_id");
    }
    actorXUserIdByInput.set(input, linked ? normalized : null);
  }

  return inputs.map((input) =>
    buildPreparedAuditLogEntry(
      input,
      settings,
      actorJsonById.get(input.actor_user_id) ?? EMPTY_ACTOR_JSON,
      actorXUserIdByInput.get(input) ?? null,
    ),
  );
}

export async function prepareAuditLogEntry(
  db: DB,
  input: WriteAuditLogInput,
): Promise<PreparedAuditLogEntry | null> {
  return (await prepareAuditLogEntries(db, [input]))[0] ?? null;
}

export async function writeAuditLog(
  db: DB,
  input: WriteAuditLogInput,
): Promise<string | null> {
  try {
    const entry = await prepareAuditLogEntry(db, input);
    if (!entry) return null;
    await db.insert(auditLogs).values(entry);
    return entry.id;
  } catch (err) {
    if (input.strict) throw err;
    return null;
  }
}
