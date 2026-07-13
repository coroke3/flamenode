import { getRestoreRegistration } from "./registry";
import {
  RestoreStatus,
  RestoreStrategy,
  type RestoreStrategy as RestoreStrategyValue,
} from "./types";

export type AuditSnapshot = Record<string, unknown>;

export type RestoreCapability = {
  restorable: boolean;
  status: RestoreStatus;
  reasonCode: string;
  message: string;
};

export type EvaluateRestoreCapabilityInput = {
  tableName: string;
  strategy: RestoreStrategyValue | string | null | undefined;
  before: AuditSnapshot | null | undefined;
  after: AuditSnapshot | null | undefined;
  payloadExceeded: boolean;
};

export const RESTORE_CAPABILITY_REASON = {
  payloadExceeded: "payload_exceeded",
  strategyNone: "strategy_none",
  strategyUnsupported: "strategy_unsupported",
  adapterMissing: "adapter_missing",
  beforeMissing: "before_missing",
  afterMissing: "after_missing",
  snapshotInvalid: "snapshot_invalid",
  snapshotRedacted: "snapshot_redacted",
  primaryKeyMissing: "primary_key_missing",
  eventIdMissing: "event_id_missing",
  staffSubjectMissing: "event_staff_subject_missing",
  requiredFieldMissing: "required_field_missing",
  expired: "expired",
  alreadyRestored: "already_restored",
  targetConflict: "target_conflict",
  targetMissing: "target_missing",
  targetAlreadyExists: "target_already_exists",
  mutationFailed: "mutation_failed",
} as const;

function unavailable(reasonCode: string, message: string): RestoreCapability {
  return {
    restorable: false,
    status: RestoreStatus.not_restorable,
    reasonCode,
    message,
  };
}

function isPlainObject(value: unknown): value is AuditSnapshot {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isRedacted(value: unknown): boolean {
  return value === "[REDACTED]";
}

function containsRedacted(value: unknown): boolean {
  if (isRedacted(value)) return true;
  if (Array.isArray(value)) return value.some(containsRedacted);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(containsRedacted);
  }
  return false;
}

function isJsonSerializable(value: unknown, seen = new Set<unknown>()): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.every((item) => isJsonSerializable(item, seen));
  }
  return Object.values(value as Record<string, unknown>).every((item) =>
    isJsonSerializable(item, seen),
  );
}

function validateSnapshot(
  snapshot: AuditSnapshot | null | undefined,
): RestoreCapability | null {
  if (!isPlainObject(snapshot) || !isJsonSerializable(snapshot)) {
    return unavailable(
      RESTORE_CAPABILITY_REASON.snapshotInvalid,
      "復元スナップショットの形式が不正です。",
    );
  }
  if (containsRedacted(snapshot)) {
    return unavailable(
      RESTORE_CAPABILITY_REASON.snapshotRedacted,
      "復元スナップショットに秘匿化済みの値が含まれるため復元できません。",
    );
  }
  if (!snapshot.id || isRedacted(snapshot.id)) {
    return unavailable(
      RESTORE_CAPABILITY_REASON.primaryKeyMissing,
      "復元スナップショットに主キーがありません。",
    );
  }
  return null;
}

function validateTableSpecificSnapshot(
  tableName: string,
  snapshot: AuditSnapshot,
): RestoreCapability | null {
  if (tableName !== "event_staff") return null;

  if (!snapshot.event_id || isRedacted(snapshot.event_id)) {
    return unavailable(
      RESTORE_CAPABILITY_REASON.eventIdMissing,
      "イベントスタッフの復元スナップショットに event_id がありません。",
    );
  }

  const userId = snapshot.user_id;
  const xUserId = snapshot.x_user_id;
  if (
    (!userId || isRedacted(userId)) &&
    (!xUserId || isRedacted(xUserId))
  ) {
    return unavailable(
      RESTORE_CAPABILITY_REASON.staffSubjectMissing,
      "イベントスタッフの復元スナップショットに主体 ID がありません。",
    );
  }

  if (!snapshot.permission_preset || isRedacted(snapshot.permission_preset)) {
    return unavailable(
      RESTORE_CAPABILITY_REASON.snapshotInvalid,
      "イベントスタッフの復元スナップショットに権限プリセットがありません。",
    );
  }
  if (
    ![
      "owner",
      "manager",
      "slot_manager",
      "content_editor",
      "reviewer",
      "xid_reviewer",
      "public_staff",
      "custom",
    ].includes(String(snapshot.permission_preset))
  ) {
    return unavailable(
      RESTORE_CAPABILITY_REASON.snapshotInvalid,
      "イベントスタッフの復元スナップショットの権限プリセットが不正です。",
    );
  }
  return null;
}

function snapshotForStrategy(
  strategy: RestoreStrategyValue,
  before: AuditSnapshot | null | undefined,
  after: AuditSnapshot | null | undefined,
): AuditSnapshot | null | undefined {
  return strategy === RestoreStrategy.delete_created ? after : before;
}

/**
 * 保存時・実行時・UI 表示で共通利用する復元可能性判定。
 *
 * `restore_status` は過去の保存結果であって現在の安全性を保証しないため、
 * 復元実行の直前にも必ずこの関数で再評価する。
 */
export function evaluateRestoreCapability(
  input: EvaluateRestoreCapabilityInput,
): RestoreCapability {
  if (input.payloadExceeded) {
    return unavailable(
      RESTORE_CAPABILITY_REASON.payloadExceeded,
      "監査ペイロードが上限を超えたため復元できません。",
    );
  }

  const strategy = input.strategy;
  if (!strategy || strategy === RestoreStrategy.none) {
    return unavailable(
      RESTORE_CAPABILITY_REASON.strategyNone,
      "この監査操作には復元戦略がありません。",
    );
  }

  if (
    strategy !== RestoreStrategy.update_before &&
    strategy !== RestoreStrategy.delete_created &&
    strategy !== RestoreStrategy.recreate_deleted &&
    strategy !== RestoreStrategy.custom_adapter
  ) {
    return unavailable(
      RESTORE_CAPABILITY_REASON.strategyUnsupported,
      "この監査操作の復元戦略はサポートされていません。",
    );
  }

  const registration = getRestoreRegistration(input.tableName);

  if (!registration) {
    return unavailable(
      RESTORE_CAPABILITY_REASON.adapterMissing,
      `テーブル「${input.tableName}」の復元アダプターがありません。`,
    );
  }

  if (
    !registration.supportedStrategies.includes(strategy as RestoreStrategyValue)
  ) {
    return unavailable(
      RESTORE_CAPABILITY_REASON.strategyUnsupported,
      `テーブル「${input.tableName}」は ${strategy} をサポートしていません。`,
    );
  }

  if (
    (strategy === RestoreStrategy.update_before ||
      strategy === RestoreStrategy.recreate_deleted) &&
    !input.before
  ) {
    return unavailable(
      RESTORE_CAPABILITY_REASON.beforeMissing,
      "復元に必要な変更前スナップショットがありません。",
    );
  }
  if (strategy === RestoreStrategy.delete_created && !input.after) {
    return unavailable(
      RESTORE_CAPABILITY_REASON.afterMissing,
      "復元に必要な変更後スナップショットがありません。",
    );
  }
  if (strategy === RestoreStrategy.update_before && !input.after) {
    return unavailable(
      RESTORE_CAPABILITY_REASON.afterMissing,
      "競合再検証に必要な変更後スナップショットがありません。",
    );
  }

  const requiredSnapshot = snapshotForStrategy(
    strategy,
    input.before,
    input.after,
  );
  const invalid = validateSnapshot(requiredSnapshot);
  if (invalid) return invalid;

  const requiredFields =
    strategy === RestoreStrategy.delete_created
      ? registration.requiredAfterFields
      : registration.requiredBeforeFields;

  for (const field of requiredFields) {
    const value = requiredSnapshot?.[field];

    if (
      value === null ||
      value === undefined ||
      value === "" ||
      value === "[REDACTED]"
    ) {
      return unavailable(
        RESTORE_CAPABILITY_REASON.requiredFieldMissing,
        `復元スナップショットに必須項目「${field}」がありません。`,
      );
    }
  }

  const tableInvalid = validateTableSpecificSnapshot(
    input.tableName,
    requiredSnapshot!,
  );
  if (tableInvalid) return tableInvalid;

  if (strategy === RestoreStrategy.update_before) {
    const afterInvalid = validateSnapshot(input.after);
    if (afterInvalid) return afterInvalid;
  }

  return {
    restorable: true,
    status: RestoreStatus.restorable,
    reasonCode: "restorable",
    message: "復元可能です。",
  };
}
