import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DB } from "@/lib/db/client";
import type { QueueWakeKind, QueueWakeSource } from "@/lib/queues/wakeBudget";
import type { WriteAuditLogInput } from "./types";
import {
  prepareAuditLogEntries,
  type PreparedAuditLogEntry,
} from "./logger";
import {
  AUDIT_INSERT_CHUNK_SIZE,
  AUDIT_INSERT_BIND_COUNT_PER_ENTRY,
  D1_MAX_BIND_PARAMETERS,
  planD1AuditMutationBudget,
  type D1AuditMutationBudget,
} from "./mutateBudget";

export {
  AUDIT_INSERT_CHUNK_SIZE,
  D1_MAX_BATCH_QUERIES,
  D1_MAX_BIND_PARAMETERS,
  AUDIT_INSERT_BIND_COUNT_PER_ENTRY,
  D1_RESERVED_CALLER_QUERIES,
  planD1AuditMutationBudget,
} from "./mutateBudget";

const AUDIT_COLUMNS = sql.raw(`
  id, table_name, target_id, operation, before_json, after_json,
  changed_keys_json, inverse_patch_json, actor_user_id, actor_x_user_id, actor_snapshot_json,
  reason, context, retention_class, restore_strategy, restore_status,
  payload_size_bytes, expires_at, created_at,
  restore_unavailable_reason_code, restore_unavailable_message
`);

export class AuditMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditMutationError";
  }
}

export type AtomicAuditMutationInput = {
  /** D1 batch で先に実行する mutation SQL。最後の文の changes() を検証する。 */
  mutationStatements: readonly BatchItem<"sqlite">[];
  /**
   * mutation SQL が更新すべき件数。
   * 数値は従来どおり最後の statement を検査する。配列を渡す場合は各 statement
   * の直後に検査し、複数行の一括処理も D1 batch 全体で fail-closed にする。
   */
  /**
   * `null` は競合しても安全な idempotent INSERT など、変更件数を固定できない
   * statement を表す。UPDATE/DELETE や置換系 DML は必ず数値を指定する。
   */
  expectedMutationChanges: number | readonly (number | null)[];
  /**
   * mutation 前に同じ D1 batch で確認する集合/CAS不変条件。失敗時は本体DMLより
   * 前に batch 全体を中断する。複合フローでは個別 changes() assertion の代わりに
   * snapshot 全体の整合性をここで確認できる。
   */
  preMutationAssertions?: readonly BatchItem<"sqlite">[];
  /**
   * mutation 後、audit INSERT 前に確認する集合/CAS不変条件。`null` の
   * expectedMutationChanges を使う複合フローは必ず対応する事後条件を持つ。
   */
  postMutationAssertions?: readonly BatchItem<"sqlite">[];
  /** mutateWithAudit 呼び出し前にこの invocation が消費した logical D1 query 数。 */
  callerQueryCount?: number;
  /** mutation ごとの完全 before/after snapshot。 */
  audits: readonly WriteAuditLogInput[];
  /**
   * 監査 INSERT が成功した後に同じ D1 batch で実行する statement。
   * restore_status と audit_restore_runs の更新のように、監査対象 mutation と
   * 不可分でなければならない後処理にのみ使う。
   */
  postAuditStatements?: readonly BatchItem<"sqlite">[];
  /** notification_outbox への pending 保存を含む batch 成功後に Queue wake を1回送る。 */
  notificationWakeSource?: QueueWakeSource;
  /** static_rebuild_queue への保存を含む batch 成功後に Queue wake を1回送る。 */
  staticRebuildWakeSource?: QueueWakeSource;
  /**
   * 同一リクエスト内の wake 重複防止用 Set。
   * 未指定時は wake source がある場合だけ内部で生成する。
   */
  wakeSentKinds?: Set<QueueWakeKind>;
};

/** 直前の DML が期待した行数を変更しなければ SQLite error にして batch を中断する。 */
export function assertChanges(expectedChanges: number): SQL {
  // 小さなassertionもbindのまま統一し、mutateWithAudit内でSQL textへ値を展開しない。
  return sql`
    SELECT CASE
      WHEN changes() = ${expectedChanges} THEN 1
      ELSE json_extract('not-valid-json', '$')
    END
  `;
}

/** 条件が偽なら SQLite error にして同じ D1 batch を rollback する。 */
export function assertCondition(condition: SQL): SQL {
  return sql`
    SELECT CASE
      WHEN (${condition}) THEN 1
      ELSE json_extract('not-valid-json', '$')
    END
  `;
}

/**
 * mutateWithAudit と複合フローの事前検査が共有する実行計画。個別DMLの
 * changes() assertion と、snapshot/CAS assertion の双方をD1 budgetに含める。
 */
export function planAtomicAuditMutationBudget(
  input: Pick<
    AtomicAuditMutationInput,
    | "mutationStatements"
    | "expectedMutationChanges"
    | "preMutationAssertions"
    | "postMutationAssertions"
    | "audits"
    | "postAuditStatements"
    | "callerQueryCount"
  >,
): D1AuditMutationBudget {
  const mutationAssertionCount = Array.isArray(input.expectedMutationChanges)
    ? input.expectedMutationChanges.filter((expected) => expected !== null).length
    : 1;
  const actorXValidationQueryCount = input.audits.some((audit) =>
    Boolean(audit.actor_x_user_id?.trim()),
  )
    ? 1
    : 0;
  return planD1AuditMutationBudget({
    mutationStatementCount: input.mutationStatements.length,
    mutationAssertionCount,
    preMutationAssertionCount: input.preMutationAssertions?.length ?? 0,
    postMutationAssertionCount: input.postMutationAssertions?.length ?? 0,
    auditEntryCount: input.audits.length,
    postAuditStatementCount: input.postAuditStatements?.length ?? 0,
    distinctActorCount: new Set(
      input.audits.map((audit) => audit.actor_user_id),
    ).size,
    actorXValidationQueryCount,
    callerQueryCount: input.callerQueryCount,
  });
}

function auditSelect(
  entry: PreparedAuditLogEntry,
  condition: SQL,
): SQL {
  return sql`
    SELECT
      ${entry.id}, ${entry.table_name}, ${entry.target_id}, ${entry.operation},
      ${entry.before_json}, ${entry.after_json}, ${entry.changed_keys_json},
      ${entry.inverse_patch_json}, ${entry.actor_user_id}, ${entry.actor_x_user_id}, ${entry.actor_snapshot_json},
      ${entry.reason}, ${entry.context}, ${entry.retention_class},
      ${entry.restore_strategy}, ${entry.restore_status}, ${entry.payload_size_bytes},
      ${entry.expires_at}, ${entry.created_at},
      ${entry.restore_unavailable_reason_code}, ${entry.restore_unavailable_message}
    WHERE (${condition})
  `;
}

function assertionSql(entries: readonly PreparedAuditLogEntry[]): SQL {
  const ids = sql.join(
    entries.map((entry) => sql`${entry.id}`),
    sql`, `,
  );
  // json_extract の不正 JSON は SQLite/D1 でエラーになる。条件付き INSERT が
  // 0 行になった場合も batch 全体を rollback するための fail-closed assertion。
  // audit idもbindにしてSQL textのサイズを値の長さへ依存させない。
  return sql`
    SELECT CASE
      WHEN (SELECT COUNT(*) FROM audit_logs WHERE id IN (${ids})) = ${entries.length}
      THEN 1
      ELSE json_extract('not-valid-json', '$')
    END
  `;
}

function chunkEntries(
  entries: readonly PreparedAuditLogEntry[],
): readonly PreparedAuditLogEntry[][] {
  const chunks: PreparedAuditLogEntry[][] = [];
  for (let index = 0; index < entries.length; index += AUDIT_INSERT_CHUNK_SIZE) {
    chunks.push(entries.slice(index, index + AUDIT_INSERT_CHUNK_SIZE));
  }
  return chunks;
}

function auditInsertSql(
  entries: readonly PreparedAuditLogEntry[],
  condition: SQL,
): SQL {
  const selects = entries.map((entry) => auditSelect(entry, condition));
  // before_json / after_json は監査設定上100KBを超える場合がある。
  // inlineParams()するとD1のSQL text上限へ到達するためprepared bindのまま保持する。
  return sql`
    INSERT INTO audit_logs (${AUDIT_COLUMNS})
    ${sql.join(selects, sql` UNION ALL `)}
  `;
}

/** `db.run()` が返す SQLiteRaw。builder とは config 形状で区別する。 */
function isDbRunBatchItem(statement: unknown): boolean {
  const config = (statement as { config?: { action?: string; table?: unknown } })
    ?.config;
  return typeof config?.action === "string" && config.table === undefined;
}

type PreparedBatchItem = BatchItem<"sqlite"> & {
  _prepare: () => { getQuery: () => { params: unknown[] } };
};

function hasPrepare(value: unknown): value is PreparedBatchItem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { _prepare?: unknown })._prepare === "function"
  );
}

function hasGetSQL(value: unknown): value is SQLWrapper {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SQLWrapper).getSQL === "function"
  );
}

type D1BatchRuntime = DB & {
  dialect?: {
    sqlToQuery?: (query: unknown) => { sql: string; params: unknown[] };
  };
  $client?: {
    prepare?: (query: string) => { bind: (...params: unknown[]) => unknown };
  };
};

function getStatementBindCount(
  db: DB,
  statement: BatchItem<"sqlite">,
): number {
  const candidate: unknown = statement;
  const runtimeDb = db as D1BatchRuntime;
  if (hasGetSQL(candidate)) {
    const query = runtimeDb.dialect?.sqlToQuery?.(candidate.getSQL());
    if (query) return query.params.length;
  }
  if (hasPrepare(candidate)) {
    const query = candidate._prepare().getQuery();
    return query.params.length;
  }
  // Use the same conversion path as batch execution. This does not execute SQL;
  // it only asks Drizzle/D1 to compile the prepared statement.
  const runnable = asBatchRunnable(db, statement);
  if (hasPrepare(runnable)) return runnable._prepare().getQuery().params.length;
  throw new AuditMutationError("D1 bind数を事前検査できない statement です。");
}

/**
 * Compile every non-audit statement before an external pre-commit side effect.
 * Audit chunks have a fixed 21-column shape and are checked by their worst-case
 * size below, so a caller can run this without first reading audit settings.
 */
export function assertAtomicAuditMutationBindLimits(
  db: DB,
  input: Pick<
    AtomicAuditMutationInput,
    | "mutationStatements"
    | "expectedMutationChanges"
    | "preMutationAssertions"
    | "postMutationAssertions"
    | "postAuditStatements"
    | "audits"
  >,
): void {
  const expected = typeof input.expectedMutationChanges === "number"
    ? [input.expectedMutationChanges]
    : input.expectedMutationChanges.filter((value) => value !== null);
  const statements = [
    ...(input.preMutationAssertions ?? []),
    ...input.mutationStatements,
    ...expected.map((value) => db.run(assertChanges(value))),
    ...(input.postMutationAssertions ?? []),
    ...(input.postAuditStatements ?? []),
  ];
  for (const [index, statement] of statements.entries()) {
    const bindCount = getStatementBindCount(db, statement);
    if (bindCount > D1_MAX_BIND_PARAMETERS) {
      throw new AuditMutationError(
        `D1 statement ${index + 1} のbind数 ${bindCount} が上限 ${D1_MAX_BIND_PARAMETERS} を超えます。`,
      );
    }
  }

  if (input.audits.length > 0) {
    const auditInsertBindCount =
      AUDIT_INSERT_CHUNK_SIZE * AUDIT_INSERT_BIND_COUNT_PER_ENTRY;
    // assertionSql() binds one id per entry plus the expected count.
    const auditAssertionBindCount = AUDIT_INSERT_CHUNK_SIZE + 1;
    if (
      auditInsertBindCount > D1_MAX_BIND_PARAMETERS ||
      auditAssertionBindCount > D1_MAX_BIND_PARAMETERS
    ) {
      throw new AuditMutationError("監査INSERTのD1 bind上限設定が不正です。");
    }
  }
}

/** Convert Drizzle SQL wrappers into statements accepted by D1Session.batch(). */
export function asBatchRunnable(
  db: DB,
  statement: BatchItem<"sqlite">,
): BatchItem<"sqlite"> {
  const candidate: unknown = statement;

  // Drizzle D1 の db.batch() は RunnableQuery._prepare() からSQLとparamsを取得し、
  // D1PreparedStatement.bind(...params) して実行する。ここでinlineParams()すると、
  // JSON1の大きなpayloadまでSQL本文へ展開されD1のSQLサイズ上限へ到達し得るため、
  // db.run() が返したRunnableQueryはbindを保持したまま渡す。
  if (hasGetSQL(candidate)) {
    const runtimeDb = db as D1BatchRuntime;
    const query = runtimeDb.dialect?.sqlToQuery?.(candidate.getSQL());
    const client = runtimeDb.$client;
    if (isDbRunBatchItem(candidate) && query && client?.prepare) {
      const stmt = client.prepare(query.sql);
      return {
        _prepare: () => ({
          getQuery: () => query,
          stmt,
          mapResult: (result: unknown) => result,
        }),
      } as unknown as BatchItem<"sqlite">;
    }
  }
  if (hasPrepare(candidate)) {
    return candidate;
  }
  if (hasGetSQL(candidate)) {
    const fallback = db.run(candidate.getSQL());
    return fallback;
  }
  throw new AuditMutationError(
    "D1 batch に渡せない mutation statement です。await 済みの結果を渡していないか確認してください。",
  );
}

/**
 * D1 batch を使い、本体変更と監査 INSERT を同じ all-or-nothing 単位で実行する。
 *
 * `changes()` は直前の mutation statement の更新件数を検査する。監査 INSERT の
 * 条件が満たされなければ最後の assertion がエラーになり、D1 batch 全体が戻る。
 */
export async function mutateWithAudit(
  db: DB,
  input: AtomicAuditMutationInput,
): Promise<string[]> {
  if (input.mutationStatements.length === 0) {
    throw new AuditMutationError("原子的監査 mutation に本体 SQL がありません。");
  }
  if (input.audits.length === 0) {
    throw new AuditMutationError("重要 mutation には監査ログが必要です。");
  }

  const scalarExpectedChanges =
    typeof input.expectedMutationChanges === "number"
      ? input.expectedMutationChanges
      : null;
  const perStatementExpectedChanges: readonly (number | null)[] | null =
    typeof input.expectedMutationChanges === "number"
      ? null
      : input.expectedMutationChanges;
  if (scalarExpectedChanges !== null && input.mutationStatements.length !== 1) {
    throw new AuditMutationError(
      "scalar の mutation 件数検査は本体 SQL 1件に限定されます。",
    );
  }
  if (
    perStatementExpectedChanges &&
    perStatementExpectedChanges.length !== input.mutationStatements.length
  ) {
    throw new AuditMutationError(
      "原子的監査 mutation の件数検査と本体 SQL の数が一致しません。",
    );
  }

  const budget = planAtomicAuditMutationBudget(input);
  if (!budget.withinLimit) {
    throw new AuditMutationError(
      `監査前処理と D1 batch の query 数が上限を超えるため拒否しました（caller${budget.callerQueryCount} + 前処理${budget.preparationQueryCount} + batch${budget.batchQueryCount}/${budget.limit}）。`,
    );
  }
  assertAtomicAuditMutationBindLimits(db, input);

  const preparedEntries = await prepareAuditLogEntries(
    db,
    input.audits.map((audit) => ({ ...audit, strict: true })),
  );
  const entries = preparedEntries.map((entry, index) => {
    if (!entry) {
      throw new AuditMutationError(
        `テーブル「${input.audits[index].table_name}」の監査ログを作成できません。`,
      );
    }
    return entry;
  });

  const condition = sql`1 = 1`;
  const auditChunks = chunkEntries(entries);
  const preMutationAssertions = (input.preMutationAssertions ?? []).map((statement) =>
    asBatchRunnable(db, statement),
  );
  const mutationStatements = input.mutationStatements.map((statement) =>
    asBatchRunnable(db, statement),
  );
  const postMutationAssertions = (input.postMutationAssertions ?? []).map((statement) =>
    asBatchRunnable(db, statement),
  );
  const postAuditStatements = (input.postAuditStatements ?? []).map((statement) =>
    asBatchRunnable(db, statement),
  );
  const mutationBatchItems: BatchItem<"sqlite">[] = perStatementExpectedChanges
    ? mutationStatements.flatMap((statement, index) => [
        statement,
        ...(perStatementExpectedChanges[index] === null
          ? []
          : [db.run(assertChanges(perStatementExpectedChanges[index]!))]),
      ])
    : [
        mutationStatements[0],
        db.run(assertChanges(scalarExpectedChanges!)),
      ];

  const batchItems: BatchItem<"sqlite">[] = [
    ...preMutationAssertions,
    ...mutationBatchItems,
    ...postMutationAssertions,
    ...auditChunks.flatMap((chunk) => [
      db.run(auditInsertSql(chunk, condition)),
      db.run(assertionSql(chunk)),
    ]),
    ...postAuditStatements,
  ].map((item) => asBatchRunnable(db, item));

  for (const [index, item] of batchItems.entries()) {
    if (!hasPrepare(item)) {
      throw new AuditMutationError(
        `D1 batch の ${index + 1} 件目が RunnableQuery ではありません。`,
      );
    }
  }

  await db.batch(batchItems as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  const wakeSentKinds =
    input.wakeSentKinds ??
    (input.notificationWakeSource || input.staticRebuildWakeSource
      ? new Set<QueueWakeKind>()
      : undefined);
  if (input.notificationWakeSource) {
    const { wakeNotificationQueueAfterCommit } = await import(
      "@/lib/queues/wakeNotificationQueueAfterCommit"
    );
    await wakeNotificationQueueAfterCommit(input.notificationWakeSource, {
      sentKinds: wakeSentKinds,
    });
  }
  if (input.staticRebuildWakeSource) {
    const { wakeStaticRebuildQueueAfterCommit } = await import(
      "@/lib/queues/wakeStaticRebuildQueueAfterCommit"
    );
    await wakeStaticRebuildQueueAfterCommit(input.staticRebuildWakeSource, {
      sentKinds: wakeSentKinds,
    });
  }
  return entries.map((entry) => entry.id);
}
