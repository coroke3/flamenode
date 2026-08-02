import "server-only";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DB } from "@/lib/db/client";
import { staticRebuildQueue } from "@/lib/db/schema";
import { auditAction } from "@/lib/audit/helpers";
import { generateId } from "@/lib/utils/id";
import {
  indexUniqueStaticRebuildTargetRows,
  staticRebuildTargetKey,
} from "./queueBatchCore";
import {
  staticRebuildActiveLookupSelect,
  type StaticRebuildActiveLookupRow,
} from "./activeLookupColumns";
import type { QueueWakeKind, QueueWakeSource } from "@/lib/queues/wakeBudget";
import type { QueueSendBinding } from "@/lib/queues/sendQueueWakeBestEffort";
import { wakeStaticRebuildQueueAfterCommit } from "@/lib/queues/wakeStaticRebuildQueueAfterCommit";
import {
  pickHigherPriority,
  PRIORITY_RANK,
  shouldUseIncomingQueueMetadata,
} from "./priorityCore";
import type {
  EnqueueStaticRebuildInput,
  StaticRebuildPriority,
} from "./types";

export type EnqueueStaticRebuildOptions = {
  wakeSource?: QueueWakeSource;
  sentKinds?: Set<QueueWakeKind>;
  queue?: QueueSendBinding | null;
  envFlags?: Record<string, string | undefined> | null;
};

function dedupeStaticRebuildInputs(
  items: EnqueueStaticRebuildInput[],
): EnqueueStaticRebuildInput[] {
  const byKey = new Map<string, EnqueueStaticRebuildInput>();
  for (const item of items) {
    const key = `${item.targetType}:${item.targetId}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    const existingPriority = (existing.priority ?? "normal") as StaticRebuildPriority;
    const incomingPriority = (item.priority ?? "normal") as StaticRebuildPriority;
    const mergedPriority = pickHigherPriority(existingPriority, incomingPriority);
    const useIncomingMetadata = shouldUseIncomingQueueMetadata(
      existingPriority,
      incomingPriority,
    );
    byKey.set(key, {
      ...existing,
      ...item,
      priority: mergedPriority,
      reason: useIncomingMetadata ? item.reason : existing.reason,
      requestedByUserId:
        item.requestedByUserId ?? existing.requestedByUserId,
    });
  }
  return Array.from(byKey.values());
}

const PUBLIC_MISS_COOLDOWN_SEC = 5 * 60;
const DEFAULT_DONE_COOLDOWN_SEC = 60;
const ENQUEUE_MANY_CONCURRENCY = 4;
const ENQUEUE_CONFLICT_RETRY_LIMIT = 3;
export const MAX_STATIC_REBUILD_BATCH_TARGETS = 16;
export const STATIC_REBUILD_BATCH_PREFETCH_QUERY_COUNT = 1;
export const STATIC_REBUILD_BULK_UPDATE_ROWS = 6;
export const STATIC_REBUILD_BULK_INSERT_ROWS = 10;

export type StaticRebuildQueueBatch = {
  statements: BatchItem<"sqlite">[];
  expectedChanges: number[];
  acceptedTargetCount: number;
};

/**
 * Event Group mutation と同じ D1 batch に queue write を含めるための builder。
 * done/failed 履歴の cooldown では要求を捨てない。active 行があれば CAS UPDATE、なければ INSERT。
 */
export async function buildStaticRebuildQueueBatch(
  db: DB,
  items: EnqueueStaticRebuildInput[],
): Promise<StaticRebuildQueueBatch> {
  const normalizedItems = dedupeStaticRebuildInputs(items);
  if (normalizedItems.length > MAX_STATIC_REBUILD_BATCH_TARGETS) {
    throw new Error("static_rebuild_batch_target_limit_exceeded");
  }
  if (normalizedItems.length === 0) {
    return {
      statements: [],
      expectedChanges: [],
      acceptedTargetCount: 0,
    };
  }

  const statements: BatchItem<"sqlite">[] = [];
  const expectedChanges: number[] = [];
  const now = Math.floor(Date.now() / 1000);
  const targetCondition = or(
    ...normalizedItems.map((input) =>
      and(
        eq(staticRebuildQueue.target_type, input.targetType),
        eq(staticRebuildQueue.target_id, input.targetId),
      ),
    ),
  )!;

  const activeRows = await db
    .select(staticRebuildActiveLookupSelect)
    .from(staticRebuildQueue)
    .where(
      and(
        targetCondition,
        inArray(staticRebuildQueue.status, ["pending", "processing"]),
      ),
    )
    .limit(MAX_STATIC_REBUILD_BATCH_TARGETS + 1);

  const activeByTarget = indexUniqueStaticRebuildTargetRows(activeRows, {
    maxRows: MAX_STATIC_REBUILD_BATCH_TARGETS,
    label: "active",
  });

  const activeUpdates: Array<{
    row: StaticRebuildActiveLookupRow;
    reason: string;
    priority: "high" | "normal" | "low";
    requestedByUserId: string | null;
  }> = [];
  const inserts: (typeof staticRebuildQueue.$inferInsert)[] = [];
  for (const normalized of normalizedItems) {
    const row = activeByTarget.get(
      staticRebuildTargetKey(normalized.targetType, normalized.targetId),
    );
    if (row?.status === "pending" || row?.status === "processing") {
      const incomingPriority = (normalized.priority ?? "normal") as StaticRebuildPriority;
      const existingPriority = row.priority;
      const mergedPriority = pickHigherPriority(existingPriority, incomingPriority);
      const useIncomingMetadata = shouldUseIncomingQueueMetadata(
        existingPriority,
        incomingPriority,
      );
      activeUpdates.push({
        row,
        reason: useIncomingMetadata
          ? normalized.reason
          : row.reason ?? normalized.reason,
        priority: mergedPriority,
        requestedByUserId:
          normalized.requestedByUserId ?? row.requested_by_user_id,
      });
      continue;
    }

    inserts.push({
      id: generateId("srb"),
      target_type: normalized.targetType,
      target_id: normalized.targetId,
      reason: normalized.reason,
      priority: normalized.priority ?? "normal",
      status: "pending",
      requested_by_user_id: normalized.requestedByUserId ?? null,
      created_at: now,
      updated_at: now,
    });
  }

  for (
    let offset = 0;
    offset < activeUpdates.length;
    offset += STATIC_REBUILD_BULK_UPDATE_ROWS
  ) {
    const chunk = activeUpdates.slice(
      offset,
      offset + STATIC_REBUILD_BULK_UPDATE_ROWS,
    );
    statements.push(
      db
        .update(staticRebuildQueue)
        .set({
          reason: sql<string>`CASE ${staticRebuildQueue.id} ${sql.join(
            chunk.map(
              (item) => sql`WHEN ${item.row.id} THEN ${item.reason}`,
            ),
            sql` `,
          )} ELSE ${staticRebuildQueue.reason} END`,
          priority: sql<"high" | "normal" | "low">`CASE ${
            staticRebuildQueue.id
          } ${sql.join(
            chunk.map(
              (item) => sql`WHEN ${item.row.id} THEN ${item.priority}`,
            ),
            sql` `,
          )} ELSE ${staticRebuildQueue.priority} END`,
          requested_by_user_id: sql<string | null>`CASE ${
            staticRebuildQueue.id
          } ${sql.join(
            chunk.map(
              (item) =>
                sql`WHEN ${item.row.id} THEN ${item.requestedByUserId}`,
            ),
            sql` `,
          )} ELSE ${staticRebuildQueue.requested_by_user_id} END`,
          updated_at: sql<number>`CASE ${staticRebuildQueue.id} ${sql.join(
            chunk.map(
              (item) =>
                sql`WHEN ${item.row.id} THEN MAX(${item.row.updated_at} + 1, ${now})`,
            ),
            sql` `,
          )} ELSE ${staticRebuildQueue.updated_at} END`,
        })
        .where(
          or(
            ...chunk.map(
              (item) =>
                and(
                  eq(staticRebuildQueue.id, item.row.id),
                  eq(staticRebuildQueue.status, item.row.status),
                  eq(staticRebuildQueue.updated_at, item.row.updated_at),
                  item.row.lease_token
                    ? eq(
                        staticRebuildQueue.lease_token,
                        item.row.lease_token,
                      )
                    : isNull(staticRebuildQueue.lease_token),
                )!,
            ),
          )!,
        ),
    );
    expectedChanges.push(chunk.length);
  }
  for (
    let offset = 0;
    offset < inserts.length;
    offset += STATIC_REBUILD_BULK_INSERT_ROWS
  ) {
    const chunk = inserts.slice(offset, offset + STATIC_REBUILD_BULK_INSERT_ROWS);
    statements.push(db.insert(staticRebuildQueue).values(chunk));
    expectedChanges.push(chunk.length);
  }

  return {
    statements,
    expectedChanges,
    acceptedTargetCount: activeUpdates.length + inserts.length,
  };
}

async function shouldSkipRecentEnqueue(
  db: DB,
  input: EnqueueStaticRebuildInput,
  now: number,
): Promise<boolean> {
  const latest = (
    await db
      .select()
      .from(staticRebuildQueue)
      .where(
        and(
          eq(staticRebuildQueue.target_type, input.targetType),
          eq(staticRebuildQueue.target_id, input.targetId),
        )!,
      )
      .orderBy(desc(staticRebuildQueue.updated_at))
      .limit(1)
  )[0];

  return shouldSkipRecentRow(input, latest, now);
}

function shouldSkipRecentRow(
  input: EnqueueStaticRebuildInput,
  latest: typeof staticRebuildQueue.$inferSelect | undefined,
  now: number,
): boolean {
  if (!latest) return false;
  if (latest.status === "pending" || latest.status === "processing") {
    return false;
  }

  if (latest.status === "failed") {
    const retryAt = latest.next_retry_at ?? 0;
    return retryAt > now;
  }

  if (latest.status !== "done") return false;

  const processedAt = latest.processed_at ?? latest.updated_at ?? 0;
  const cooldown = input.reason.startsWith("public_")
    ? PUBLIC_MISS_COOLDOWN_SEC
    : DEFAULT_DONE_COOLDOWN_SEC;
  return processedAt > 0 && now - processedAt < cooldown;
}

/**
 * 静的 JSON 再生成キューへ投入。保存処理は成功させ、enqueue 失敗は warn のみ。
 * atomic mutation では buildStaticRebuildQueueBatch を使用すること。
 */
export async function enqueueStaticRebuild(
  db: DB,
  input: EnqueueStaticRebuildInput,
  options?: EnqueueStaticRebuildOptions,
): Promise<void> {
  const target = input;
  const now = Math.floor(Date.now() / 1000);
  const priority = target.priority ?? "normal";

  try {
    for (
      let enqueueAttempt = 0;
      enqueueAttempt < ENQUEUE_CONFLICT_RETRY_LIMIT;
      enqueueAttempt += 1
    ) {
      const existing = await db
        .select(staticRebuildActiveLookupSelect)
        .from(staticRebuildQueue)
        .where(
          and(
            eq(staticRebuildQueue.target_type, target.targetType),
            eq(staticRebuildQueue.target_id, target.targetId),
            inArray(staticRebuildQueue.status, ["pending", "processing"]),
          )!,
        )
        .limit(1);

      const row = existing[0];
      if (row) {
        const existingPriority = row.priority;
        const mergedPriority = pickHigherPriority(existingPriority, priority);
        const useIncomingMetadata = shouldUseIncomingQueueMetadata(
          existingPriority,
          priority,
        );
        const update = db.update(staticRebuildQueue).set({
          reason: useIncomingMetadata ? target.reason : row.reason ?? target.reason,
          priority: mergedPriority,
          requested_by_user_id:
            target.requestedByUserId ?? row.requested_by_user_id,
          updated_at: sql<number>`MAX(${staticRebuildQueue.updated_at} + 1, ${now})`,
        });
        const result = await update.where(
          and(
            eq(staticRebuildQueue.id, row.id),
            eq(staticRebuildQueue.status, row.status),
            eq(staticRebuildQueue.updated_at, row.updated_at),
            ...(row.status === "processing"
              ? [
                  row.lease_token
                    ? eq(staticRebuildQueue.lease_token, row.lease_token)
                    : isNull(staticRebuildQueue.lease_token),
                ]
              : []),
          )!,
        );
        if ((result.meta?.changes ?? 0) === 1) {
          await wakeAfterSuccessfulEnqueue(options);
          return;
        }
        continue;
      }

      if (await shouldSkipRecentEnqueue(db, target, now)) return;

      const insertResult = await db
        .insert(staticRebuildQueue)
        .values({
          id: generateId("srb"),
          target_type: target.targetType,
          target_id: target.targetId,
          reason: target.reason,
          priority,
          status: "pending",
          requested_by_user_id: target.requestedByUserId ?? null,
          created_at: now,
          updated_at: now,
        })
        .onConflictDoNothing();
      if ((insertResult.meta?.changes ?? 0) === 1) {
        await wakeAfterSuccessfulEnqueue(options);
        return;
      }
    }
    throw new Error("static rebuild queue changed during enqueue retries");
  } catch (error) {
    console.warn("[enqueueStaticRebuild] failed", target, error);
    try {
      await auditAction(db, {
        table_name: "static_rebuild_queue",
        record_id: `${target.targetType}:${target.targetId}`,
        action: "UPDATE",
        after_data: JSON.stringify({
          reason: target.reason,
          error: error instanceof Error ? error.message : String(error),
        }),
        operator_user_id: input.requestedByUserId ?? "system",
        retention_class: "normal",
      });
    } catch (historyError) {
      console.warn(
        "[enqueueStaticRebuild] history log failed",
        historyError,
      );
    }
  }
}

export async function enqueueStaticRebuildMany(
  db: DB,
  items: EnqueueStaticRebuildInput[],
  options?: EnqueueStaticRebuildOptions,
): Promise<void> {
  const sentKinds = options?.sentKinds ?? new Set<QueueWakeKind>();
  const deduped = dedupeStaticRebuildInputs(items);
  for (let offset = 0; offset < deduped.length; offset += ENQUEUE_MANY_CONCURRENCY) {
    await Promise.all(
      deduped
        .slice(offset, offset + ENQUEUE_MANY_CONCURRENCY)
        .map((item) =>
          enqueueStaticRebuild(db, item, { ...options, sentKinds }),
        ),
    );
  }
}

async function wakeAfterSuccessfulEnqueue(
  options?: EnqueueStaticRebuildOptions,
): Promise<void> {
  await wakeStaticRebuildQueueAfterCommit(options?.wakeSource ?? "web", {
    sentKinds: options?.sentKinds,
    queue: options?.queue,
    envFlags: options?.envFlags,
  });
}

export { PRIORITY_RANK } from "./priorityCore";
export { directEnqueueStaticRebuild } from "./directEnqueue";
