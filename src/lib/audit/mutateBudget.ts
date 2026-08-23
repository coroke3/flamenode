/** D1 の 1 query あたり bind parameter 上限。 */
export const D1_MAX_BIND_PARAMETERS = 100;
/** D1 Free の 1 invocation あたり query 上限。 */
export const D1_MAX_BATCH_QUERIES = 50;
/**
 * caller の認証・CostGuard・対象行・権限・alias/profile/通知先取得など、
 * mutateWithAudit 外で既に消費される D1 query 用の安全余裕。
 *
 * 旧10では admin member save / video permission save の実経路が境界超過し得た。
 * 100人保存側はchapter JSON chunksを1 compound statementへ畳み、batch側を削減した上で
 * callerへ18 queryを確保する。
 */
export const D1_RESERVED_CALLER_QUERIES = 18;

/** audit_logs INSERTで1 entryあたりbindする列数。AUDIT_COLUMNSと同期すること。 */
const AUDIT_COLUMN_BIND_COUNT = 21;
/** audit assertionで同じchunkのID + 件数をbindするための余裕。 */
const AUDIT_ASSERTION_RESERVED_BIND_COUNT = 1;

/** 監査INSERT / assertion の双方がD1の100 bindを超えない最大entry数。 */
export const AUDIT_INSERT_CHUNK_SIZE = Math.min(
  Math.floor(D1_MAX_BIND_PARAMETERS / AUDIT_COLUMN_BIND_COUNT),
  D1_MAX_BIND_PARAMETERS - AUDIT_ASSERTION_RESERVED_BIND_COUNT,
);

export type D1AuditMutationBudgetInput = {
  mutationStatementCount: number;
  mutationAssertionCount: number;
  auditEntryCount: number;
  postAuditStatementCount?: number;
  distinctActorCount: number;
  /** actor_x_user_id が1件でもあればJSON1一括検証に1 query使う。 */
  actorXValidationQueryCount?: number;
};

export type D1AuditMutationBudget = {
  mutationStatementCount: number;
  mutationAssertionCount: number;
  auditChunkCount: number;
  auditQueryCount: number;
  postAuditStatementCount: number;
  preparationQueryCount: number;
  actorXValidationQueryCount: number;
  reservedCallerQueryCount: number;
  batchQueryCount: number;
  totalQueryCount: number;
  limit: number;
  withinLimit: boolean;
};

/** mutateWithAudit とcallerが共有するD1 query予算の唯一の算定式。 */
export function planD1AuditMutationBudget(
  input: D1AuditMutationBudgetInput,
): D1AuditMutationBudget {
  const mutationStatementCount = Math.max(0, input.mutationStatementCount);
  const mutationAssertionCount = Math.max(0, input.mutationAssertionCount);
  const auditEntryCount = Math.max(0, input.auditEntryCount);
  const postAuditStatementCount = Math.max(
    0,
    input.postAuditStatementCount ?? 0,
  );
  const actorXValidationQueryCount = Math.max(
    0,
    input.actorXValidationQueryCount ?? 0,
  );
  const auditChunkCount = auditEntryCount > 0
    ? Math.ceil(auditEntryCount / AUDIT_INSERT_CHUNK_SIZE)
    : 0;
  const auditQueryCount = auditChunkCount * 2;
  const preparationQueryCount = auditEntryCount > 0
    ? 1 + Math.max(0, input.distinctActorCount) + actorXValidationQueryCount
    : 0;
  const batchQueryCount =
    mutationStatementCount +
    mutationAssertionCount +
    auditQueryCount +
    postAuditStatementCount;
  const totalQueryCount =
    preparationQueryCount +
    batchQueryCount +
    D1_RESERVED_CALLER_QUERIES;

  return {
    mutationStatementCount,
    mutationAssertionCount,
    auditChunkCount,
    auditQueryCount,
    postAuditStatementCount,
    preparationQueryCount,
    actorXValidationQueryCount,
    reservedCallerQueryCount: D1_RESERVED_CALLER_QUERIES,
    batchQueryCount,
    totalQueryCount,
    limit: D1_MAX_BATCH_QUERIES,
    withinLimit: totalQueryCount <= D1_MAX_BATCH_QUERIES,
  };
}
