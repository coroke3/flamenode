"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDatabase } from "@/lib/cloudflare";
import { staticRebuildQueue } from "@/lib/db/schema";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { mutateWithAudit } from "@/lib/audit/mutate";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { isStaticRebuildTargetType } from "@/lib/staticRebuild/types";

const BULK_RETRY_MAX = 8;
type Row = typeof staticRebuildQueue.$inferSelect;

async function retryRows(db: NonNullable<ReturnType<typeof getDatabase>>, rows: Row[], actor: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const statements: BatchItem<"sqlite">[] = [];
  const audits: WriteAuditLogInput[] = [];
  for (const before of rows) {
    const patch = { status: "pending" as const, priority: "high" as const, next_retry_at: null, error: null, lease_token: null, lease_expires_at: null, updated_at: now };
    const after = { ...before, ...patch };
    statements.push(db.update(staticRebuildQueue).set(patch).where(and(eq(staticRebuildQueue.id, before.id), expectedRowCondition({ expectedCurrent: { ...before } }))!));
    audits.push({ table_name: "static_rebuild_queue", target_id: before.id, operation: "UPDATE", before: { ...before }, after: { ...after }, actor_user_id: actor, context: "admin_static_rebuild_retry", reason: "失敗した静的再生成を手動リトライ", retention_class: "normal", strict: true });
  }
  await mutateWithAudit(db, { mutationStatements: statements, expectedMutationChanges: rows.map(() => 1), audits });
}

export async function retryFailedStaticRebuild(formData: FormData): Promise<void> {
  const guard = await requireAdminWrite("admin_static_rebuild"); if (!guard.ok) return;
  const id = String(formData.get("queue_id") ?? "").trim(); if (!id || id.length > 128) return;
  const { db } = guard;
  const row = (await db.select().from(staticRebuildQueue).where(eq(staticRebuildQueue.id, id)).limit(1))[0];
  if (!row || row.status !== "failed") return;
  await retryRows(db, [row], guard.user.id);
  revalidatePath("/admin/static-builds");
}

export async function enqueueStaticRebuildAdmin(formData: FormData): Promise<void> {
  const guard = await requireAdminWrite("admin_static_rebuild"); if (!guard.ok) return;
  const targetType = String(formData.get("target_type") ?? "").trim();
  const targetId = String(formData.get("target_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "manual_rebuild").trim();
  if (!isStaticRebuildTargetType(targetType) || !targetId || targetId.length > 128 || !reason || reason.length > 500) return;
  const { db } = guard;
  const queue = await buildStaticRebuildQueueBatch(db, [{ targetType, targetId, reason, priority: "high", requestedByUserId: guard.user.id }]);
  if (queue.statements.length === 0) return;
  await mutateWithAudit(db, {
    mutationStatements: queue.statements,
    expectedMutationChanges: queue.expectedChanges,
    audits: [{ table_name: "static_rebuild_queue", target_id: `manual:${targetType}:${targetId}`, operation: "CREATE", after: { target_type: targetType, target_id: targetId, reason, priority: "high", requested_by_user_id: guard.user.id }, actor_user_id: guard.user.id, context: "admin_static_rebuild_enqueue", reason: "静的再生成を手動登録", retention_class: "normal", strict: true }],
    staticRebuildWakeSource: "admin",
  });
  revalidatePath("/admin/static-builds");
}

export async function retryAllFailedStaticRebuild(): Promise<void> {
  const guard = await requireAdminWrite("admin_static_rebuild"); if (!guard.ok) return;
  const { db } = guard;
  const rows = await db.select().from(staticRebuildQueue).where(eq(staticRebuildQueue.status, "failed")).orderBy(asc(staticRebuildQueue.created_at)).limit(BULK_RETRY_MAX + 1);
  const targets = rows.slice(0, BULK_RETRY_MAX); if (targets.length === 0) return;
  await retryRows(db, targets, guard.user.id);
  revalidatePath("/admin/static-builds");
}
