import {
  evaluateCostGuardCore as evaluateCostGuardCoreDomain,
  type CostGuardCoreDecision,
  type WriteFeatureKey,
} from "@flamenode/domain/admin";

export {
  WRITE_FEATURE_KEYS,
  type WriteFeatureKey,
  isWriteFeatureKey,
  type CostGuardCoreDecision,
  type WriteIdentity,
  type WriteIdentityDenyReason,
  evaluateWriteIdentity,
  type ActiveXWriteAccessDenyReason,
  evaluateActiveXWriteAccess,
  type ParsedWriteFeatureList,
  parseWriteFeatureList,
} from "@flamenode/domain/admin";

export function evaluateCostGuardCore(input: {
  feature: WriteFeatureKey;
  operationMode: string | null;
  disabledFeaturesJson: string | null;
  exceptionUntil: number | null;
  exceptionFeaturesJson: string | null;
  now: number;
}): CostGuardCoreDecision {
  return evaluateCostGuardCoreDomain(input);
}
