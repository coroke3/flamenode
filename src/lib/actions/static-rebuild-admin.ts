"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { staticRebuildQueue } from "@/lib/db/schema";
import { enqueueManualStaticRebuild } from "@/lib/staticRebuild/hooks";
import type { StaticRebuildTargetType } from "@/lib/staticRebuild/types";

export type StaticRebuildAdminResult = {
  ok: boolean;
  message?: string;
};

async function requireAdminUser(): Promise<
  | { ok: true; userId: string }
  | { ok: false; message: string }
> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id || u.role !== "admin") {
    return { ok: false, message: "管理者のみ操作できます。" };
  }
  return { ok: true, userId: u.id };
}

export async function retryFailedStaticRebuild(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminUser();
  if (!guard.ok) return;

  const id = String(formData.get("queue_id") ?? "").trim();
  if (!id) return;

  const db = getDatabase();
  if (!db) return;

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(staticRebuildQueue)
    .set({
      status: "pending",
      priority: "high",
      next_retry_at: null,
      error: null,
      updated_at: now,
    })
    .where(eq(staticRebuildQueue.id, id));

  revalidatePath("/admin/static-builds");
}

export async function enqueueStaticRebuildAdmin(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminUser();
  if (!guard.ok) return;

  const targetType = String(formData.get("target_type") ?? "").trim() as StaticRebuildTargetType;
  const targetId = String(formData.get("target_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "manual_rebuild").trim();

  if (!targetType || !targetId) return;

  const db = getDatabase();
  if (!db) return;

  await enqueueManualStaticRebuild(db, {
    targetType,
    targetId,
    reason,
    requestedByUserId: guard.userId,
  });

  revalidatePath("/admin/static-builds");
}

export async function retryAllFailedStaticRebuild(): Promise<void> {
  const guard = await requireAdminUser();
  if (!guard.ok) return;

  const db = getDatabase();
  if (!db) return;

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(staticRebuildQueue)
    .set({
      status: "pending",
      priority: "high",
      next_retry_at: null,
      error: null,
      updated_at: now,
    })
    .where(eq(staticRebuildQueue.status, "failed"));

  revalidatePath("/admin/static-builds");
}
