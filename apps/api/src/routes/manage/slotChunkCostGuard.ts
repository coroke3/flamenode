/** MIG-0656 U03w: fail-closed CostGuard at SA-058/059 D1 chunk boundary.
 * UNMOUNTED candidate only. The initial parent CostGuard check is still
 * authoritative; this reuses its domain rule at the later scoped read and
 * compares the exact policy in the same atomic batch as slot DML/audits/Queue.
 * Adds no D1 round trip: the policy is projected into the existing scope read.
 */
import { evaluateCostGuardCore, parseWriteFeatureList, type WriteFeatureKey } from "@flamenode/domain/admin";
import { sql, type SQL } from "@flamenode/server-core/sql";

const POLICY_JSON = `json_object(
  'operation_mode', operation_mode,
  'disabled_features_json', disabled_features_json,
  'cost_guard_exception_until', cost_guard_exception_until,
  'cost_guard_exception_features_json', cost_guard_exception_features_json
)`;

/** A scalar subquery; missing settings yields NULL and is always rejected. */
export const SLOT_CHUNK_COST_GUARD_SELECT =
  `(SELECT ${POLICY_JSON} FROM system_settings WHERE id = 'default' LIMIT 1) AS cost_guard_json`;

export type SlotChunkCostGuardApproval = {
  approved: true;
  /** Verified against the shared @flamenode/domain CostGuard policy. */
  snapshotJson: string;
  /** A temporary exception must still be active when the atomic batch begins. */
  exceptionDeadline: number | null;
};
export type SlotChunkCostGuardOutcome =
  | SlotChunkCostGuardApproval
  | { approved: false; reason: "maintenance_mode" | "cost_guard_blocked" };

function deny(reason: "maintenance_mode" | "cost_guard_blocked"): SlotChunkCostGuardOutcome {
  return { approved: false, reason };
}

/**
 * Re-evaluate at the scoped read (which occurs AFTER the CostGuard middleware).
 * This prevents an allow->deny transition between those two D1 reads.
 * Never trust malformed, oversized or unexpectedly typed DB policy JSON.
 */
export function verifySlotChunkCostGuard(
  rawJson: string | null,
  feature: WriteFeatureKey,
  now: number = Math.floor(Date.now() / 1000),
): SlotChunkCostGuardOutcome {
  if (typeof rawJson !== "string" || rawJson.length > 16384 || !Number.isSafeInteger(now)) {
    return deny("cost_guard_blocked");
  }
  let unknownRow: unknown;
  try { unknownRow = JSON.parse(rawJson); }
  catch { return deny("cost_guard_blocked"); }
  if (!unknownRow || typeof unknownRow !== "object" || Array.isArray(unknownRow)) {
    return deny("cost_guard_blocked");
  }
  const row = unknownRow as Record<string, unknown>;
  if ((row.operation_mode !== null && typeof row.operation_mode !== "string") ||
      (row.disabled_features_json !== null && typeof row.disabled_features_json !== "string") ||
      (row.cost_guard_exception_features_json !== null &&
       typeof row.cost_guard_exception_features_json !== "string") ||
      (row.cost_guard_exception_until !== null &&
       (!Number.isSafeInteger(row.cost_guard_exception_until) || (row.cost_guard_exception_until as number) < 0))) {
    return deny("cost_guard_blocked");
  }
  const operationMode = row.operation_mode as string | null;
  const disabledFeaturesJson = row.disabled_features_json as string | null;
  const exceptionFeaturesJson = row.cost_guard_exception_features_json as string | null;
  const exceptionUntil = row.cost_guard_exception_until as number | null;
  const decision = evaluateCostGuardCore({
    feature, operationMode, disabledFeaturesJson,
    exceptionUntil, exceptionFeaturesJson, now,
  });
  if (decision.blocked) {
    return deny(decision.reason === "mode" ? "maintenance_mode" : "cost_guard_blocked");
  }
  // Only a policy exception needed for THIS authorization requires a
  // deadline assertion in the atomic batch. Under normal/economy mode with
  // this feature otherwise enabled, expiry must not reject a valid write.
  // Reuse the domain evaluator, rather than approximating its fallback rule.
  const fallback = evaluateCostGuardCore({
    feature, operationMode, disabledFeaturesJson,
    exceptionUntil: null, exceptionFeaturesJson, now,
  });
  const exceptions = parseWriteFeatureList(exceptionFeaturesJson);
  const exceptionDeadline = fallback.blocked && exceptions.ok &&
    exceptions.features.includes(feature) &&
    exceptionUntil !== null && exceptionUntil > now ? exceptionUntil : null;
  return { approved: true, snapshotJson: rawJson, exceptionDeadline };
}

/** First-transaction assertion: any policy change aborts the entire D1 batch.
 * Even without a row change, a temporary exception cannot expire mid-request.
 */
export function buildSlotChunkCostGuardAssertion(approval: SlotChunkCostGuardApproval): SQL {
  if (!approval || approval.approved !== true ||
      typeof approval.snapshotJson !== "string" ||
      (approval.exceptionDeadline !== null &&
       (!Number.isSafeInteger(approval.exceptionDeadline) || approval.exceptionDeadline < 0))) {
    throw new Error("slot_chunk_invalid_cost_guard_approval");
  }
  const exceptionStillValid = approval.exceptionDeadline === null
    ? sql`1 = 1`
    : sql`${approval.exceptionDeadline} > CAST(strftime('%s','now') AS INTEGER)`;
  return sql`
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM system_settings
      WHERE id = 'default'
        AND ${sql.raw(POLICY_JSON)} IS ${approval.snapshotJson}
    ) AND ${exceptionStillValid}
    THEN 1 ELSE json_extract('slot-chunk-cost-guard-changed', '$') END
  `;
}
