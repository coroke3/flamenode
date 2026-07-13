import type { DB } from "@/lib/db/client";
import { writeAuditLog } from "./logger";
import { isRegisteredRestoreTable } from "./registry";
import type { AuditOperation, RetentionClass } from "./types";
import { RestoreStrategy } from "./types";

const ATOMIC_ONLY_TABLES = new Set([
  "user",
  "users",
  "x_users",
  "x_user_icons",
  "events",
  "event_staff",
  "slots",
  "videos",
  "video_events",
  "video_members",
  "video_chapters",
  "video_softwares",
  "video_custom_answers",
  "event_custom_questions",
  "event_groups",
  "event_group_events",
  "system_settings",
  "audit_log_settings",
]);

function assertAuditActionAllowed(
  tableName: string,
): void {
  if (ATOMIC_ONLY_TABLES.has(tableName)) {
    throw new Error(
      `テーブル「${tableName}」はauditActionを直接使用できません。mutateWithAuditを使用してください。`,
    );
  }
}

const STRICT_TABLES = new Set([
  "users",
  "event_staff",
  "system_settings",
  "audit_log_settings",
  "x_id_merge_requests",
  "x_users",
]);

function parseJsonField(
  data: string | Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!data) return null;
  if (typeof data === "object" && !Array.isArray(data)) return data;
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return null;
  }
}

function normalizeRetentionClass(
  raw: RetentionClass | "normal" | "long_audit" | undefined,
): RetentionClass {
  if (raw === "long_audit" || raw === "restorable") return raw;
  return "normal";
}

function inferRestoreStrategy(
  operation: AuditOperation,
  retentionClass: RetentionClass,
): RestoreStrategy {
  if (retentionClass === "normal") return RestoreStrategy.none;
  switch (operation) {
    case "CREATE":
      return RestoreStrategy.delete_created;
    case "UPDATE":
    case "STATUS_CHANGE":
      return RestoreStrategy.update_before;
    case "DELETE":
      return RestoreStrategy.recreate_deleted;
    default:
      return RestoreStrategy.none;
  }
}

function inferRetentionClass(
  tableName: string,
  operation: AuditOperation,
  requested: RetentionClass,
): RetentionClass {
  if (requested === "long_audit" || requested === "restorable") return requested;
  if (
    isRegisteredRestoreTable(tableName) &&
    operation !== "CREATE"
  ) {
    return "restorable";
  }
  return "normal";
}

function inferStrict(
  tableName: string,
  operation: AuditOperation,
  retentionClass: RetentionClass,
  explicit?: boolean,
): boolean {
  if (explicit !== undefined) return explicit;
  if (retentionClass === "long_audit") return true;
  if (operation === "DELETE") return true;
  if (STRICT_TABLES.has(tableName)) return true;
  return false;
}

export interface AuditActionInput {
  table_name: string;
  record_id: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  before_data?: string | Record<string, unknown> | null;
  after_data?: string | Record<string, unknown> | null;
  operator_user_id: string;
  retention_class?: RetentionClass | "normal" | "long_audit";
  reason?: string | null;
  action_label?: string | null;
  strict?: boolean;
  restore_strategy?: RestoreStrategy;
  source?: string | null;
}

/**
 * 監査アクションを正規化し、共通の writeAuditLog へ渡す。
 */
export async function auditAction(
  db: DB,
  input: AuditActionInput,
): Promise<string | null> {
  assertAuditActionAllowed(input.table_name);
  const retentionClass = inferRetentionClass(
    input.table_name,
    input.action,
    normalizeRetentionClass(input.retention_class),
  );
  const before = parseJsonField(input.before_data);
  const after = parseJsonField(input.after_data);
  const restoreStrategy =
    input.restore_strategy ?? inferRestoreStrategy(input.action, retentionClass);

  return writeAuditLog(db, {
    table_name: input.table_name,
    target_id: input.record_id,
    operation: input.action,
    before,
    after,
    actor_user_id: input.operator_user_id,
    reason: input.reason,
    retention_class: retentionClass,
    restore_strategy: restoreStrategy,
    strict: inferStrict(
      input.table_name,
      input.action,
      retentionClass,
      input.strict,
    ),
    context: input.action_label ?? input.source ?? null,
  });
}
