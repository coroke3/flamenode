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
  planD1AuditMutationBudget,
} from "./mutateBudget";

export {
  AUDIT_INSERT_CHUNK_SIZE,
  D1_MAX_BATCH_QUERIES,
  D1_MAX_BIND_PARAMETERS,
  D1_RESERVED_CALLER_QUERIES,
  planD1AuditMutationBudget,
} from "./mutateBudget";

const AUDIT_COLUMNS = sql.raw(`
  id, table_name, target_id, operation, before_json, after_json,
  changed_keys_json, inverse_patch_json, actor_user_id, actor_snapshot_json,
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
  return sql`
    SELECT CASE
      WHEN changes() = ${expectedChanges} THEN 1
      ELSE json_extract('not-valid-json', '$')
    END
  `.inlineParams();
}

function auditSelect(
  entry: PreparedAuditLogEntry,
  condition: SQL,
): SQL {
  return sql`
    SELECT
      ${entry.id}, ${entry.table_name}, ${entry.target_id}, ${entry.operation},
      ${entry.before_json}, ${entry.after_json}, ${entry.changed_keys_json},
      ${entry.inverse_patch_json}, ${entry.actor_user_id}, ${entry.actor_snapshot_json},
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
  return sql`
    SELECT CASE
      WHEN (SELECT COUNT(*) FROM audit_logs WHERE id IN (${ids})) = ${entries.length}
      THEN 1
      ELSE json_extract('not-valid-json', '$')
    END
  `.inlineParams();
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
  return sql`
    INSERT INTO audit_logs (${AUDIT_COLUMNS})
    ${sql.join(selects, sql` UNION ALL `)}
  `.inlineParams();
}

/** `db.run()` が返す SQLiteRaw。builder とは config 形状で区別する。 */
function isDbRunBatchItem(statement: unknown): boolean {
  const config = (statement as { config?: { action?: string; table?: unknown } })
    ?.config;
  return typeof config?.action === "string" && config.table === undefined;
}

function inlineBatchSql(query: SQL): SQL {
  return query.inlineParams();
}

function hasPrepare(value: unknown): value is BatchItem<"sqlite"> {
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

function asBatchRunnable(db: DB, statement: BatchItem<"sqlite">): BatchItem<"sqlite"> {
  const candidate: unknown = statement;
  if (isDbRunBatchItem(candidate)) {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      typeof (candidate as { getQuery?: unknown }).getQuery === "function" &&
      hasGetSQL(candidate)
    ) {
      const raw = candidate as {
        getSQL: () => SQL;
        getQuery: () => { params: unknown[] };
      };
      if (raw.getQuery().params.length === 0) {
        return statement;
      }
      return db.run(inlineBatchSql(raw.getSQL()));
    }
    return statement;
  }
  if (hasPrepare(candidate)) {
    return candidate;
  }
  if (hasGetSQL(candidate)) {
    return db.run(inlineBatchSql(candidate.getSQL()));
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

  const mutationAssertionCount = perStatementExpectedChanges
    ? perStatementExpectedChanges.filter((expected) => expected !== null).length
    : 1;
  const budget = planD1AuditMutationBudget({
    mutationStatementCount: input.mutationStatements.length,
    mutationAssertionCount,
    auditEntryCount: input.audits.length,
    postAuditStatementCount: input.postAuditStatements?.length ?? 0,
    distinctActorCount: new Set(
      input.audits.map((audit) => audit.actor_user_id),
    ).size,
  });
  if (!budget.withinLimit) {
    throw new AuditMutationError(
      `監査前処理と D1 batch の query 数が上限を超えるため拒否しました（前処理${budget.preparationQueryCount} + batch${budget.batchQueryCount} + 予約${budget.reservedCallerQueryCount}/${budget.limit}）。`,
    );
  }

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
  const mutationStatements = input.mutationStatements.map((statement) =>
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
    ...mutationBatchItems,
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
