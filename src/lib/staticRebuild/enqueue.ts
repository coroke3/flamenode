import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { historyLogs, staticRebuildQueue } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { pickHigherPriority } from "./priority";
import type { EnqueueStaticRebuildInput } from "./types";

/**
 * 静的 JSON 再生成キューへ投入。保存処理は成功させ、enqueue 失敗は warn のみ。
 */
export async function enqueueStaticRebuild(
  db: DB,
  input: EnqueueStaticRebuildInput,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const priority = input.priority ?? "normal";

  try {
    const existing = await db
      .select()
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
    if (row?.status === "pending") {
      await db
        .update(staticRebuildQueue)
        .set({
          reason: input.reason,
          priority: pickHigherPriority(
            row.priority as "high" | "normal" | "low",
            priority,
          ),
          requested_by_user_id:
            input.requestedByUserId ?? row.requested_by_user_id,
          updated_at: now,
        })
        .where(eq(staticRebuildQueue.id, row.id));
      return;
    }

    if (row?.status === "processing") {
      return;
    }

    await db.insert(staticRebuildQueue).values({
      id: generateId("srb"),
      target_type: input.targetType,
      target_id: input.targetId,
      reason: input.reason,
      priority,
      status: "pending",
      requested_by_user_id: input.requestedByUserId ?? null,
      created_at: now,
      updated_at: now,
    });
  } catch (e) {
    console.warn("[enqueueStaticRebuild] failed", input, e);
    try {
      await db.insert(historyLogs).values({
        table_name: "static_rebuild_queue",
        record_id: `${input.targetType}:${input.targetId}`,
        action: "UPDATE",
        after_data: JSON.stringify({
          reason: input.reason,
          error: e instanceof Error ? e.message : String(e),
        }),
        operator_discord_id: input.requestedByUserId ?? null,
        retention_class: "normal",
        created_at: now,
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
  for (const item of items) {
    await enqueueStaticRebuild(db, item);
  }
}
