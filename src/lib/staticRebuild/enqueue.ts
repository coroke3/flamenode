import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { staticRebuildQueue } from "@/lib/db/schema";
import { auditAction } from "@/lib/audit/helpers";
import { generateId } from "@/lib/utils/id";
import { normalizeStaticRebuildTarget } from "./normalizeTarget";
import { pickHigherPriority } from "./priority";
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
    if (row?.status === "pending") {
      await db
        .update(staticRebuildQueue)
        .set({
          reason: normalized.reason,
          priority: pickHigherPriority(
            row.priority as "high" | "normal" | "low",
            priority,
          ),
          requested_by_user_id:
            normalized.requestedByUserId ?? row.requested_by_user_id,
          updated_at: now,
        })
        .where(eq(staticRebuildQueue.id, row.id));
      return;
    }

    if (row?.status === "processing") {
      return;
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
        operator_discord_id: input.requestedByUserId ?? "system",
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
