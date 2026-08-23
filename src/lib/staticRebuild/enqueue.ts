import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DB } from "@/lib/db/client";
import { staticRebuildQueue } from "@/lib/db/schema";
import { auditAction } from "@/lib/audit/helpers";
import { generateId } from "@/lib/utils/id";
import {
  staticRebuildActiveLookupSelect,
} from "./activeLookupColumns";
import type { QueueWakeKind, QueueWakeSource } from "@/lib/queues/wakeBudget";
import type { QueueSendBinding } from "@/lib/queues/sendQueueWakeBestEffort";
import { wakeStaticRebuildQueueAfterCommit } from "@/lib/queues/wakeStaticRebuildQueueAfterCommit";
import {
  pickHigherPriority,
  PRIORITY_RANK,
  resolveQueueReason,
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
    byKey.set(key, {
      ...existing,
      ...item,
      priority: mergedPriority,
      reason: resolveQueueReason(
        existing.reason,
        item.reason,
        existingPriority,
        incomingPriority,
      ),
      requestedByUserId:
        item.requestedByUserId ?? existing.requestedByUserId,
    });
  }
  return Array.from(byKey.values());
}

const ENQUEUE_MANY_CONCURRENCY = 4;
const ENQUEUE_CONFLICT_RETRY_LIMIT = 3;
// A full 100-member replacement can invalidate both old and new user pages
// (up to 200 user targets) plus the video/index/event projections. Keep the
// complete fanout in one atomic queue batch instead of dropping user/global
// targets when the request crosses the legacy 24-target cap.
export const MAX_STATIC_REBUILD_BATCH_TARGETS = 256;
export const STATIC_REBUILD_BATCH_PREFETCH_QUERY_COUNT = 0;
// Each JSON1 chunk is a single bind regardless of row count. 100 rows keeps
// payloads compact while reducing a 200+ target member fanout from five
// statements to three, leaving headroom under the D1 Free 50-query limit.
export const STATIC_REBUILD_BULK_UPSERT_ROWS = 100;

export type StaticRebuildQueueBatch = {
  statements: BatchItem<"sqlite">[];
  expectedChanges: number[];
  acceptedTargetCount: number;
};

/**
 * Event Group mutation と同じ D1 batch に queue write を含めるための builder。
 * done/failed 履歴の cooldown では要求を捨てない。active 行は partial unique UPSERT、なければ INSERT。
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
  const rows = normalizedItems.map((item) => ({
    id: generateId("srb"),
    target_type: item.targetType,
    target_id: item.targetId,
    reason: item.reason,
    priority: item.priority ?? "normal",
    requested_by_user_id: item.requestedByUserId ?? null,
  }));

  for (
    let offset = 0;
    offset < rows.length;
    offset += STATIC_REBUILD_BULK_UPSERT_ROWS
  ) {
    const chunk = rows.slice(offset, offset + STATIC_REBUILD_BULK_UPSERT_ROWS);
    const payload = JSON.stringify(chunk);
    statements.push(
      db.run(sql`
        INSERT INTO static_rebuild_queue (
          id, target_type, target_id, reason, priority, status,
          attempt_count, requested_by_user_id, created_at, updated_at
        )
        SELECT
          json_extract(incoming.value, '$.id'),
          json_extract(incoming.value, '$.target_type'),
          json_extract(incoming.value, '$.target_id'),
          json_extract(incoming.value, '$.reason'),
          json_extract(incoming.value, '$.priority'),
          'pending', 0,
          json_extract(incoming.value, '$.requested_by_user_id'),
          ${now}, ${now}
        FROM json_each(${payload}) AS incoming
        WHERE 1 = 1
        ON CONFLICT(target_type, target_id) WHERE status IN ('pending', 'processing')
        DO UPDATE SET
          reason = CASE
            WHEN excluded.reason IN ('video_visibility_update', 'event_id_rename_old_cleanup')
              THEN excluded.reason
            WHEN static_rebuild_queue.reason IN ('video_visibility_update', 'event_id_rename_old_cleanup')
              THEN static_rebuild_queue.reason
            WHEN (CASE excluded.priority WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END)
              >= (CASE static_rebuild_queue.priority WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END)
            THEN excluded.reason
            ELSE static_rebuild_queue.reason
          END,
          priority = CASE
            WHEN static_rebuild_queue.priority = 'high' OR excluded.priority = 'high' THEN 'high'
            WHEN static_rebuild_queue.priority = 'normal' OR excluded.priority = 'normal' THEN 'normal'
            ELSE 'low'
          END,
          requested_by_user_id = COALESCE(
            excluded.requested_by_user_id,
            static_rebuild_queue.requested_by_user_id
          ),
          updated_at = MAX(static_rebuild_queue.updated_at + 1, excluded.updated_at)
      `),
    );
    expectedChanges.push(chunk.length);
  }

  return {
    statements,
    expectedChanges,
    acceptedTargetCount: normalizedItems.length,
  };
}

/**
 * 静的 JSON 再生成キューへ投入。保存処理は成功させ、enqueue 失敗は warn のみ。
 * atomic mutation では buildStaticRebuildQueueBatch を使用すること。
 *
 * Mutation-derived invalidations must not be suppressed by a recent done or
 * failed history row. The source may have changed again after that
 * generation. Active rows are still coalesced by the partial unique index;
 * updating their timestamp preserves the dirty-generation CAS used by the
 * worker. Public misses, periodic refreshes, and manual repairs use
 * directEnqueueStaticRebuild for their explicit cooldown policy.
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
        const update = db.update(staticRebuildQueue).set({
          reason: resolveQueueReason(
            row.reason,
            target.reason,
            existingPriority,
            priority,
          ),
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
