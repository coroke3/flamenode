/** D1 の 1 query あたり bind parameter 上限。 */
export const D1_MAX_BIND_PARAMETERS = 100;
/** D1 Free の 1 invocation あたり query 上限。 */
export const D1_MAX_BATCH_QUERIES = 50;
/**
 * 既存 caller 向けの後方互換デフォルト。新しい複合フローは必ず
 * `callerQueryCount` を明示し、この値を実測値の代わりに使ってはならない。
 *
 * 旧10では admin member save / video permission save の実経路が境界超過し得たため、
 * 明示値をまだ渡していない既存フローだけは18 queryを予約する。
 */
export const D1_RESERVED_CALLER_QUERIES = 18;

/** audit_logs INSERTで1 entryあたりbindする列数。AUDIT_COLUMNSと同期すること。 */
export const AUDIT_INSERT_BIND_COUNT_PER_ENTRY = 21;
/** audit assertionで同じchunkのID + 件数をbindするための余裕。 */
const AUDIT_ASSERTION_RESERVED_BIND_COUNT = 1;

/** 監査INSERT / assertion の双方がD1の100 bindを超えない最大entry数。 */
export const AUDIT_INSERT_CHUNK_SIZE = Math.min(
  Math.floor(D1_MAX_BIND_PARAMETERS / AUDIT_INSERT_BIND_COUNT_PER_ENTRY),
  D1_MAX_BIND_PARAMETERS - AUDIT_ASSERTION_RESERVED_BIND_COUNT,
);

export type D1AuditMutationBudgetInput = {
  mutationStatementCount: number;
  mutationAssertionCount: number;
  /** mutation 前後の集合/CAS不変条件 assertion。 */
  preMutationAssertionCount?: number;
  postMutationAssertionCount?: number;
  auditEntryCount: number;
  postAuditStatementCount?: number;
  distinctActorCount: number;
  /** actor_x_user_id が1件でもあればJSON1一括検証に1 query使う。 */
  actorXValidationQueryCount?: number;
  /**
   * この invocation で mutateWithAudit に到達するまでに消費した logical D1 query 数。
   * 指定しない既存 caller だけ D1_RESERVED_CALLER_QUERIES を使う。
   */
  callerQueryCount?: number;
};

export type D1AuditMutationBudget = {
  mutationStatementCount: number;
  mutationAssertionCount: number;
  preMutationAssertionCount: number;
  postMutationAssertionCount: number;
  integrityAssertionCount: number;
  auditChunkCount: number;
  auditQueryCount: number;
  postAuditStatementCount: number;
  preparationQueryCount: number;
  actorXValidationQueryCount: number;
  callerQueryCount: number;
  /** @deprecated callerQueryCount の旧名称。 */
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
  const preMutationAssertionCount = Math.max(
    0,
    input.preMutationAssertionCount ?? 0,
  );
  const postMutationAssertionCount = Math.max(
    0,
    input.postMutationAssertionCount ?? 0,
  );
  const integrityAssertionCount =
    preMutationAssertionCount + postMutationAssertionCount;
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
    integrityAssertionCount +
    auditQueryCount +
    postAuditStatementCount;
  const callerQueryCount = Math.max(
    0,
    input.callerQueryCount ?? D1_RESERVED_CALLER_QUERIES,
  );
  const totalQueryCount =
    preparationQueryCount +
    batchQueryCount +
    callerQueryCount;

  return {
    mutationStatementCount,
    mutationAssertionCount,
    preMutationAssertionCount,
    postMutationAssertionCount,
    integrityAssertionCount,
    auditChunkCount,
    auditQueryCount,
    postAuditStatementCount,
    preparationQueryCount,
    actorXValidationQueryCount,
    callerQueryCount,
    reservedCallerQueryCount: callerQueryCount,
    batchQueryCount,
    totalQueryCount,
    limit: D1_MAX_BATCH_QUERIES,
    withinLimit: totalQueryCount <= D1_MAX_BATCH_QUERIES,
  };
}
