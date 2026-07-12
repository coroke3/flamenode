import type { DB } from "@/lib/db/client";
import { auditLogs } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import type {
  AuditOperation,
  RetentionClass,
  RestoreStatus,
  WriteAuditLogInput,
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
import { buildActorSnapshot } from "./actor";
import { evaluateRestoreCapability } from "./capability";

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

function buildPreparedAuditLogEntry(
  input: WriteAuditLogInput,
  settings: typeof DEFAULT_AUDIT_LOG_SETTINGS,
  actorJson: string,
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
  const changedKeys = computeChangedKeys(sanitizedBefore, sanitizedAfter);
  const inversePatch = buildInversePatch(sanitizedBefore, sanitizedAfter);
  const payloadSize = calculatePayloadSize(beforeJson, afterJson);
  const payloadExceeded = payloadSize > settings.max_payload_bytes;
  const changedKeysJson = changedKeys.length > 0 ? JSON.stringify(changedKeys) : null;
  const inversePatchJson =
    payloadExceeded || !inversePatch ? null : JSON.stringify(inversePatch);
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

/** Prepare audit entries with one settings query and one actor query per unique actor. */
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
  for (const actorUserId of new Set(activeInputs.map((input) => input.actor_user_id))) {
    try {
      actorJsonById.set(
        actorUserId,
        JSON.stringify(await buildActorSnapshot(db, actorUserId)),
      );
    } catch (error) {
      if (inputs.some((input) => input.strict && input.actor_user_id === actorUserId)) {
        throw error;
      }
      actorJsonById.set(actorUserId, EMPTY_ACTOR_JSON);
    }
  }

  return inputs.map((input) =>
    buildPreparedAuditLogEntry(
      input,
      settings,
      actorJsonById.get(input.actor_user_id) ?? EMPTY_ACTOR_JSON,
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
