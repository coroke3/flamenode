export {
  WRITE_FEATURE_KEYS,
  type WriteFeatureKey,
  isWriteFeatureKey,
  type CostGuardCoreDecision,
  evaluateCostGuardCore,
  type WriteIdentity,
  type WriteIdentityDenyReason,
  evaluateWriteIdentity,
  type ActiveXWriteAccessDenyReason,
  evaluateActiveXWriteAccess,
  type ParsedWriteFeatureList,
  parseWriteFeatureList,
} from "@flamenode/domain/admin";
