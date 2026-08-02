import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { staticRebuildQueue } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { wakeStaticRebuildQueueAfterCommit } from "@/lib/queues/wakeStaticRebuildQueueAfterCommit";
import type { QueueSendBinding } from "@/lib/queues/sendQueueWakeBestEffort";
import type { QueueWakeKind, QueueWakeSource } from "@/lib/queues/wakeBudget";
import { staticRebuildActiveLookupSelect } from "./activeLookupColumns";
import {
  pickHigherPriority,
  shouldUseIncomingQueueMetadata,
} from "./priorityCore";
import type {
  DirectEnqueueCause,
  DirectEnqueueResult,
  EnqueueStaticRebuildInput,
} from "./types";

const ENQUEUE_CONFLICT_RETRY_LIMIT = 3;

export type DirectEnqueueStaticRebuildOptions = {
  wakeSource?: QueueWakeSource;
  sentKinds?: Set<QueueWakeKind>;
  queue?: QueueSendBinding | null;
  envFlags?: Record<string, string | undefined> | null;
};

function isAllowedDirectEnqueueCause(
  cause: DirectEnqueueCause,
  reason: string,
): boolean {
  if (cause.kind === "public_miss") {
    return reason.startsWith("public_");
  }
  if (cause.kind === "periodic") {
    return (
      reason.startsWith("periodic_") ||
      reason.startsWith("deploy_") ||
      reason.startsWith("recovery_")
    );
  }
  return (
    reason.startsWith("manual_") ||
    reason.endsWith("_manual_repair") ||
    reason.includes("manual_repair")
  );
}

function rebuildStateForAction(
  action: "inserted" | "active_updated" | "cooldown_skipped",
): DirectEnqueueResult {
  if (action === "cooldown_skipped") {
    return {
      ok: true,
      action,
      rebuildState: "cooldown_suppressed",
    };
  }
  if (action === "active_updated") {
    return {
      ok: true,
      action,
      rebuildState: "already_active",
    };
  }
  return {
    ok: true,
    action,
    rebuildState: "requested",
  };
}

async function shouldSkipDirectEnqueueCooldown(
  db: DB,
  input: EnqueueStaticRebuildInput,
  cooldownSeconds: number,
  now: number,
): Promise<boolean> {
  if (cooldownSeconds <= 0) return false;

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

  if (!latest) return false;
  if (latest.status === "pending" || latest.status === "processing") {
    return false;
  }
  if (latest.status !== "done") return false;

  const processedAt = latest.processed_at ?? latest.updated_at ?? 0;
  return processedAt > 0 && now - processedAt < cooldownSeconds;
}

async function wakeAfterSuccessfulEnqueue(
  options?: DirectEnqueueStaticRebuildOptions,
): Promise<void> {
  await wakeStaticRebuildQueueAfterCommit(options?.wakeSource ?? "web", {
    sentKinds: options?.sentKinds,
    queue: options?.queue,
    envFlags: options?.envFlags,
  });
}

/**
 * public miss / periodic / manual repair 専用の direct enqueue。
 * 例外を握り潰さず DirectEnqueueResult を返す。
 */
export async function directEnqueueStaticRebuild(
  db: DB,
  input: EnqueueStaticRebuildInput,
  cause: DirectEnqueueCause,
  options?: DirectEnqueueStaticRebuildOptions,
): Promise<DirectEnqueueResult> {
  if (!isAllowedDirectEnqueueCause(cause, input.reason)) {
    return {
      ok: false,
      errorCode: "direct_enqueue_cause_mismatch",
      message: `reason ${input.reason} is not allowed for ${cause.kind}`,
      rebuildState: "failed",
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const priority = input.priority ?? "normal";

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
            eq(staticRebuildQueue.target_type, input.targetType),
            eq(staticRebuildQueue.target_id, input.targetId),
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
        const result = await db
          .update(staticRebuildQueue)
          .set({
            reason: useIncomingMetadata
              ? input.reason
              : row.reason ?? input.reason,
            priority: mergedPriority,
            requested_by_user_id:
              input.requestedByUserId ?? row.requested_by_user_id,
            updated_at: sql<number>`MAX(${staticRebuildQueue.updated_at} + 1, ${now})`,
          })
          .where(
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
          return rebuildStateForAction("active_updated");
        }
        continue;
      }

      if (
        await shouldSkipDirectEnqueueCooldown(
          db,
          input,
          cause.cooldownSeconds,
          now,
        )
      ) {
        return rebuildStateForAction("cooldown_skipped");
      }

      const insertResult = await db
        .insert(staticRebuildQueue)
        .values({
          id: generateId("srb"),
          target_type: input.targetType,
          target_id: input.targetId,
          reason: input.reason,
          priority,
          status: "pending",
          requested_by_user_id: input.requestedByUserId ?? null,
          created_at: now,
          updated_at: now,
        })
        .onConflictDoNothing();
      if ((insertResult.meta?.changes ?? 0) === 1) {
        await wakeAfterSuccessfulEnqueue(options);
        return rebuildStateForAction("inserted");
      }
    }

    return {
      ok: false,
      errorCode: "enqueue_conflict_retries_exhausted",
      message: "static rebuild queue changed during direct enqueue retries",
      rebuildState: "failed",
    };
  } catch (error) {
    return {
      ok: false,
      errorCode: "direct_enqueue_failed",
      message: error instanceof Error ? error.message : String(error),
      rebuildState: "failed",
    };
  }
}
