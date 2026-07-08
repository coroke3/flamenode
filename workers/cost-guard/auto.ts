import {
  isMoreRestrictiveCostGuardMode,
  normalizeCostGuardMode,
  parseCostGuardThresholds,
  recommendCostGuardMode,
  type CostGuardMode,
  type CostUsageSnapshotLike,
} from "../../src/lib/admin/costGuardPolicy.ts";

export interface Env {
  DB: D1Database;
}

export interface AutoCostGuardResult {
  applied: boolean;
  currentMode: CostGuardMode;
  recommendedMode: CostGuardMode | null;
  reason:
    | "disabled"
    | "no_snapshot"
    | "not_more_restrictive"
    | "applied";
  highestRatio: number;
}

interface SettingsRow {
  operation_mode?: string | null;
  auto_cost_guard_enabled?: number | null;
  cost_guard_thresholds_json?: string | null;
}

type SnapshotRow = CostUsageSnapshotLike & {
  id: string;
};

const SYSTEM_ACTOR_ID = "system:cost-guard";

export async function applyAutoCostGuard(
  env: Env,
  now = Math.floor(Date.now() / 1000),
): Promise<AutoCostGuardResult> {
  const settings = await readSettings(env);
  const currentMode = normalizeCostGuardMode(settings?.operation_mode);

  if (settings?.auto_cost_guard_enabled === 0) {
    return {
      applied: false,
      currentMode,
      recommendedMode: null,
      reason: "disabled",
      highestRatio: 0,
    };
  }

  const snapshot = await readLatestSnapshot(env);
  if (!snapshot) {
    return {
      applied: false,
      currentMode,
      recommendedMode: null,
      reason: "no_snapshot",
      highestRatio: 0,
    };
  }

  const recommendation = recommendCostGuardMode(
    snapshot,
    parseCostGuardThresholds(settings?.cost_guard_thresholds_json),
  );

  if (!isMoreRestrictiveCostGuardMode(recommendation.mode, currentMode)) {
    await updateSnapshotMode(env, snapshot.id, currentMode);
    return {
      applied: false,
      currentMode,
      recommendedMode: recommendation.mode,
      reason: "not_more_restrictive",
      highestRatio: recommendation.highestRatio,
    };
  }

  const reason = buildReason(recommendation.reasons);
  await upsertOperationMode(env, recommendation.mode, reason, now);
  await updateSnapshotMode(env, snapshot.id, recommendation.mode);
  await writeAudit(env, currentMode, recommendation.mode, reason, now);

  return {
    applied: true,
    currentMode,
    recommendedMode: recommendation.mode,
    reason: "applied",
    highestRatio: recommendation.highestRatio,
  };
}

async function readSettings(env: Env): Promise<SettingsRow | null> {
  return env.DB.prepare(
    `SELECT operation_mode, auto_cost_guard_enabled, cost_guard_thresholds_json
     FROM system_settings
     WHERE id = 'default'
     LIMIT 1`,
  ).first<SettingsRow>();
}

async function readLatestSnapshot(env: Env): Promise<SnapshotRow | null> {
  return env.DB.prepare(
    `SELECT id,
            workers_requests_today,
            pages_functions_requests_today,
            d1_rows_read_today,
            d1_rows_written_today,
            r2_class_a_month,
            r2_class_b_month,
            kv_writes_today
     FROM cost_usage_snapshots
     ORDER BY captured_at DESC
     LIMIT 1`,
  ).first<SnapshotRow>();
}

async function upsertOperationMode(
  env: Env,
  mode: CostGuardMode,
  reason: string,
  now: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO system_settings (
       id,
       operation_mode,
       cost_guard_reason,
       cost_guard_updated_by_user_id,
       cost_guard_updated_at
     )
     VALUES ('default', ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       operation_mode = excluded.operation_mode,
       cost_guard_reason = excluded.cost_guard_reason,
       cost_guard_updated_by_user_id = excluded.cost_guard_updated_by_user_id,
       cost_guard_updated_at = excluded.cost_guard_updated_at`,
  )
    .bind(mode, reason, SYSTEM_ACTOR_ID, now)
    .run();
}

async function updateSnapshotMode(
  env: Env,
  snapshotId: string,
  mode: CostGuardMode,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE cost_usage_snapshots
     SET guard_mode_after_check = ?
     WHERE id = ?`,
  )
    .bind(mode, snapshotId)
    .run();
}

async function writeAudit(
  env: Env,
  beforeMode: CostGuardMode,
  afterMode: CostGuardMode,
  reason: string,
  now: number,
): Promise<void> {
  const beforeJson = JSON.stringify({ operation_mode: beforeMode });
  const afterJson = JSON.stringify({
    operation_mode: afterMode,
    cost_guard_reason: reason,
  });
  const payloadSize = beforeJson.length + afterJson.length;
  try {
    await env.DB.prepare(
      `INSERT INTO audit_logs (
         id,
         table_name,
         target_id,
         operation,
         before_json,
         after_json,
         changed_keys_json,
         actor_user_id,
         actor_snapshot_json,
         reason,
         context,
         retention_class,
         restore_strategy,
         restore_status,
         payload_size_bytes,
         expires_at,
         created_at
       )
       VALUES (?, 'system_settings', 'default', 'UPDATE', ?, ?, ?, ?, ?, ?, ?,
               'long_audit', 'update_before', 'restorable', ?, ?, ?)`,
    )
      .bind(
        `audit_${crypto.randomUUID()}`,
        beforeJson,
        afterJson,
        JSON.stringify(["operation_mode", "cost_guard_reason"]),
        SYSTEM_ACTOR_ID,
        JSON.stringify({ source: "worker", worker: "content-jobs" }),
        reason,
        "auto_cost_guard",
        payloadSize,
        now + 365 * 86400,
        now,
      )
      .run();
  } catch (error) {
    console.warn("[auto-cost-guard] failed to write audit log:", error);
  }
}

function buildReason(reasons: string[]): string {
  const suffix = reasons.length > 0 ? reasons.join(",") : "threshold";
  return `auto_cost_guard:${suffix}`.slice(0, 500);
}
