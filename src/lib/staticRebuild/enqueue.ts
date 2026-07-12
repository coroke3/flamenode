import "server-only";
import { and, desc, eq, inArray, isNull, max, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DB } from "@/lib/db/client";
import { staticRebuildQueue } from "@/lib/db/schema";
import { auditAction } from "@/lib/audit/helpers";
import { generateId } from "@/lib/utils/id";
import { normalizeStaticRebuildTarget } from "./normalizeTarget";
import { pickHigherPriority } from "./priority";
import {
  indexUniqueStaticRebuildTargetRows,
  staticRebuildTargetKey,
} from "./queueBatchCore";
import type { EnqueueStaticRebuildInput } from "./types";

const PRIORITY_RANK: Record<"high" | "normal" | "low", number> = {
  high: 3,
  normal: 2,
  low: 1,
};

function dedupeStaticRebuildInputs(
  items: EnqueueStaticRebuildInput[],
): EnqueueStaticRebuildInput[] {
  const byKey = new Map<string, EnqueueStaticRebuildInput>();
  for (const item of items) {
    const normalized = normalizeStaticRebuildTarget(item);
    const key = `${normalized.targetType}:${normalized.targetId}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, normalized);
      continue;
    }
    const mergedPriority = pickHigherPriority(
      (existing.priority ?? "normal") as "high" | "normal" | "low",
      (normalized.priority ?? "normal") as "high" | "normal" | "low",
    );
    byKey.set(key, {
      ...existing,
      ...normalized,
      priority: mergedPriority,
      reason:
        PRIORITY_RANK[mergedPriority] >=
        PRIORITY_RANK[(existing.priority ?? "normal") as "high" | "normal" | "low"]
          ? normalized.reason
          : existing.reason,
      requestedByUserId:
        normalized.requestedByUserId ?? existing.requestedByUserId,
    });
  }
  return Array.from(byKey.values());
}

const PUBLIC_MISS_COOLDOWN_SEC = 5 * 60;
const DEFAULT_DONE_COOLDOWN_SEC = 60;
export const MAX_STATIC_REBUILD_BATCH_TARGETS = 16;
export const STATIC_REBUILD_BATCH_PREFETCH_QUERY_COUNT = 2;

export type StaticRebuildQueueBatch = {
  statements: BatchItem<"sqlite">[];
  expectedChanges: number[];
};

/**
 * Event Group mutation と同じ D1 batch に queue write を含めるための builder。
 * ここでは書き込みを実行せず、失敗は呼び出し元へ返して batch を rollback させる。
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
    return { statements: [], expectedChanges: [] };
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
    .select()
    .from(staticRebuildQueue)
    .where(
      and(
        targetCondition,
        inArray(staticRebuildQueue.status, ["pending", "processing"]),
      ),
    )
    .limit(MAX_STATIC_REBUILD_BATCH_TARGETS + 1);
  const latestUpdate = db
    .select({
      target_type: staticRebuildQueue.target_type,
      target_id: staticRebuildQueue.target_id,
      updated_at: max(staticRebuildQueue.updated_at).as("latest_updated_at"),
    })
    .from(staticRebuildQueue)
    .where(targetCondition)
    .groupBy(
      staticRebuildQueue.target_type,
      staticRebuildQueue.target_id,
    )
    .as("latest_static_rebuild_queue");
  const latestRows = await db
    .select({ queue: staticRebuildQueue })
    .from(staticRebuildQueue)
    .innerJoin(
      latestUpdate,
      and(
        eq(staticRebuildQueue.target_type, latestUpdate.target_type),
        eq(staticRebuildQueue.target_id, latestUpdate.target_id),
        eq(staticRebuildQueue.updated_at, latestUpdate.updated_at),
      ),
    )
    .where(targetCondition)
    .limit(MAX_STATIC_REBUILD_BATCH_TARGETS + 1);
  const activeByTarget = indexUniqueStaticRebuildTargetRows(activeRows, {
    maxRows: MAX_STATIC_REBUILD_BATCH_TARGETS,
    label: "active",
  });
  const latestByTarget = indexUniqueStaticRebuildTargetRows(
    latestRows.map(({ queue }) => queue),
    {
      maxRows: MAX_STATIC_REBUILD_BATCH_TARGETS,
      label: "latest",
    },
  );

  for (const normalized of normalizedItems) {
    const row = activeByTarget.get(
      staticRebuildTargetKey(normalized.targetType, normalized.targetId),
    );
    if (row?.status === "pending") {
      statements.push(
        db
          .update(staticRebuildQueue)
          .set({
            reason: normalized.reason,
            priority: pickHigherPriority(
              row.priority as "high" | "normal" | "low",
              normalized.priority ?? "normal",
            ),
            requested_by_user_id:
              normalized.requestedByUserId ?? row.requested_by_user_id,
            updated_at: now,
          })
          .where(
            and(
              eq(staticRebuildQueue.id, row.id),
              eq(staticRebuildQueue.status, "pending"),
              eq(staticRebuildQueue.updated_at, row.updated_at),
            )!,
          ),
      );
      expectedChanges.push(1);
      continue;
    }
    if (row?.status === "processing") {
      statements.push(
        db
          .update(staticRebuildQueue)
          .set({
            reason: normalized.reason,
            priority: pickHigherPriority(
              row.priority as "high" | "normal" | "low",
              normalized.priority ?? "normal",
            ),
            requested_by_user_id:
              normalized.requestedByUserId ?? row.requested_by_user_id,
            lease_token: null,
            lease_expires_at: null,
            updated_at: now,
          })
          .where(
            and(
              eq(staticRebuildQueue.id, row.id),
              eq(staticRebuildQueue.status, "processing"),
              eq(staticRebuildQueue.updated_at, row.updated_at),
              row.lease_token
                ? eq(staticRebuildQueue.lease_token, row.lease_token)
                : isNull(staticRebuildQueue.lease_token),
            )!,
          ),
      );
      expectedChanges.push(1);
      continue;
    }
    const latest = latestByTarget.get(
      staticRebuildTargetKey(normalized.targetType, normalized.targetId),
    );
    if (shouldSkipRecentRow(normalized, latest, now)) continue;

    statements.push(
      db.insert(staticRebuildQueue).values({
        id: generateId("srb"),
        target_type: normalized.targetType,
        target_id: normalized.targetId,
        reason: normalized.reason,
        priority: normalized.priority ?? "normal",
        status: "pending",
        requested_by_user_id: normalized.requestedByUserId ?? null,
        created_at: now,
        updated_at: now,
      }),
    );
    expectedChanges.push(1);
  }

  return { statements, expectedChanges };
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
 */
export async function enqueueStaticRebuild(
  db: DB,
  input: EnqueueStaticRebuildInput,
): Promise<void> {
  const normalized = normalizeStaticRebuildTarget(input);
  const now = Math.floor(Date.now() / 1000);
  const priority = normalized.priority ?? "normal";

  try {
    for (let enqueueAttempt = 0; enqueueAttempt < 2; enqueueAttempt += 1) {
      const existing = await db
        .select()
        .from(staticRebuildQueue)
        .where(
          and(
            eq(staticRebuildQueue.target_type, normalized.targetType),
            eq(staticRebuildQueue.target_id, normalized.targetId),
            inArray(staticRebuildQueue.status, ["pending", "processing"]),
          )!,
        )
        .limit(1);

      const row = existing[0];
      if (!row) break;

      const update = db.update(staticRebuildQueue).set({
        reason: normalized.reason,
        priority: pickHigherPriority(
          row.priority as "high" | "normal" | "low",
          priority,
        ),
        requested_by_user_id:
          normalized.requestedByUserId ?? row.requested_by_user_id,
        ...(row.status === "processing"
          ? { lease_token: null, lease_expires_at: null }
          : {}),
        updated_at: now,
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
      if ((result.meta?.changes ?? 0) === 1) return;
      if (enqueueAttempt === 1) {
        throw new Error("static rebuild queue active row changed during enqueue");
      }
    }

    if (await shouldSkipRecentEnqueue(db, normalized, now)) {
      return;
    }

    await db.insert(staticRebuildQueue).values({
      id: generateId("srb"),
      target_type: normalized.targetType,
      target_id: normalized.targetId,
      reason: normalized.reason,
      priority,
      status: "pending",
      requested_by_user_id: normalized.requestedByUserId ?? null,
      created_at: now,
      updated_at: now,
    });
  } catch (e) {
    console.warn("[enqueueStaticRebuild] failed", normalized, e);
    try {
      await auditAction(db, {
        table_name: "static_rebuild_queue",
        record_id: `${normalized.targetType}:${normalized.targetId}`,
        action: "UPDATE",
        after_data: JSON.stringify({
          reason: normalized.reason,
          error: e instanceof Error ? e.message : String(e),
        }),
        operator_user_id: input.requestedByUserId ?? "system",
        retention_class: "normal",
      });
    } catch (historyErr) {
      console.warn("[enqueueStaticRebuild] history log failed", historyErr);
    }
  }
}

export async function enqueueStaticRebuildMany(
  db: DB,
  items: EnqueueStaticRebuildInput[],
): Promise<void> {
  for (const item of dedupeStaticRebuildInputs(items)) {
    await enqueueStaticRebuild(db, item);
  }
}
