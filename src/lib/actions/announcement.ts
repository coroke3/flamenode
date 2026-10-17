"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import type { DB } from "@/lib/db/client";
import { announcements } from "@/lib/db/schema";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId } from "@/lib/observability/flowTrace";
import { buildAnnouncementChangeQueueBatch } from "@/lib/staticRebuild/hooks";
import { generateId } from "@/lib/utils/id";
import {
  type AnnouncementResult,
  announcementInputSchema as schema,
  parseAnnouncementDates,
  validateAnnouncementInput,
} from "@flamenode/domain/announcements";

export type { AnnouncementResult };
export { schema, parseAnnouncementDates };

function announcementMutationError(error: unknown): AnnouncementResult {
  unstable_rethrow(error);
  console.error("[announcement] atomic mutation failed", error);
  return {
    ok: false,
    message: "保存に失敗しました。再読み込みして、もう一度お試しください。",
  };
}

async function revalidateAnnouncementPathsBestEffort(
  flow: string,
  paths: readonly string[],
): Promise<void> {
  await runPostCommitBestEffort(
    { flow, traceId: createTraceId() },
    paths.map((path, index) => ({
      name: `revalidate_path_${index + 1}`,
      run: async () => {
        revalidatePath(path);
      },
    })),
  );
}


async function requireAdmin(): Promise<
  | { ok: true; userId: string; db: DB }
  | { ok: false; result: AnnouncementResult }
> {
  const guard = await requireAdminWrite("admin_announcement_broadcast");
  if (!guard.ok) {
    return { ok: false, result: { ok: false, message: guard.message } };
  }
  return { ok: true, userId: guard.user.id, db: guard.db };
}

export async function createAnnouncement(
  formData: FormData,
): Promise<AnnouncementResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const validated = validateAnnouncementInput(Object.fromEntries(formData));
  if (!validated.ok) return validated;
  const { data, dates } = validated;
  const id = data.id?.trim() || generateId("anc");
  const now = Math.floor(Date.now() / 1000);

  try {
    const queue = await buildAnnouncementChangeQueueBatch(guard.db, {
      reason: "announcement_create",
      requestedByUserId: guard.userId,
    });
    await mutateWithAudit(guard.db, {
      mutationStatements: [
        guard.db.run(sql`
          INSERT INTO announcements (
            id, title, body, severity, target_audience, is_published,
            publish_at, expire_at, created_by_user_id, created_at, updated_at
          ) VALUES (
            ${id}, ${data.title}, ${data.body}, ${data.severity},
            ${data.target_audience}, ${data.is_published}, ${dates.publishAt},
            ${dates.expireAt}, ${guard.userId}, ${now}, ${now}
          )
        `),
        ...queue.statements,
      ],
      expectedMutationChanges: [1, ...queue.expectedChanges],
      audits: [
        {
          table_name: "announcements",
          target_id: id,
          operation: "CREATE",
          before: null,
          after: {
            id,
            title: data.title,
            body: data.body,
            severity: data.severity,
            target_audience: data.target_audience,
            is_published: data.is_published,
            publish_at: dates.publishAt,
            expire_at: dates.expireAt,
            created_by_user_id: guard.userId,
            created_at: now,
            updated_at: now,
          },
          actor_user_id: guard.userId,
          retention_class: "normal",
        },
      ],
    });
  } catch (error) {
    return announcementMutationError(error);
  }
  await revalidateAnnouncementPathsBestEffort("announcement.create", [
    "/admin/announcements",
  ]);
  return { ok: true, id };
}

export async function updateAnnouncement(
  formData: FormData,
): Promise<AnnouncementResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const validated = validateAnnouncementInput(Object.fromEntries(formData));
  if (!validated.ok) return validated;
  const { data, dates } = validated;
  const id = data.id?.trim();
  if (!id) return { ok: false, message: "お知らせIDが必要です。" };
  let existing: typeof announcements.$inferSelect | undefined;
  try {
    existing = (
      await guard.db
        .select()
        .from(announcements)
        .where(eq(announcements.id, id))
        .limit(1)
    )[0];
  } catch (error) {
    return announcementMutationError(error);
  }
  if (!existing) return { ok: false, message: "対象のお知らせが見つかりません。" };
  if (data.base_updated_at == null || data.base_updated_at !== existing.updated_at) {
    return {
      ok: false,
      message: "他の操作で更新されています。再読み込みして確認してください。",
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const nextUpdatedAt = Math.max(now, existing.updated_at + 1);
  try {
    const queue = await buildAnnouncementChangeQueueBatch(guard.db, {
      reason: "announcement_update",
      requestedByUserId: guard.userId,
    });
    await mutateWithAudit(guard.db, {
      mutationStatements: [
        guard.db.run(sql`
          UPDATE announcements
          SET title = ${data.title}, body = ${data.body},
              severity = ${data.severity}, target_audience = ${data.target_audience},
              is_published = ${data.is_published}, publish_at = ${dates.publishAt},
              expire_at = ${dates.expireAt}, updated_at = ${nextUpdatedAt}
          WHERE id = ${id} AND updated_at = ${data.base_updated_at}
        `),
        ...queue.statements,
      ],
      expectedMutationChanges: [1, ...queue.expectedChanges],
      audits: [
        {
          table_name: "announcements",
          target_id: id,
          operation: "UPDATE",
          before: { ...existing },
          after: {
            ...existing,
            title: data.title,
            body: data.body,
            severity: data.severity,
            target_audience: data.target_audience,
            is_published: data.is_published,
            publish_at: dates.publishAt,
            expire_at: dates.expireAt,
            updated_at: nextUpdatedAt,
          },
          actor_user_id: guard.userId,
          retention_class: "normal",
        },
      ],
    });
  } catch (error) {
    return announcementMutationError(error);
  }
  await revalidateAnnouncementPathsBestEffort("announcement.update", [
    "/admin/announcements",
    `/admin/announcements/${id}/edit`,
  ]);
  return { ok: true, id };
}

export async function deleteAnnouncement(
  formData: FormData,
): Promise<AnnouncementResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, message: "お知らせIDが必要です。" };
  let existing: typeof announcements.$inferSelect | undefined;
  try {
    existing = (
      await guard.db
        .select()
        .from(announcements)
        .where(eq(announcements.id, id))
        .limit(1)
    )[0];
  } catch (error) {
    return announcementMutationError(error);
  }
  if (!existing) return { ok: false, message: "対象のお知らせが見つかりません。" };
  try {
    const queue = await buildAnnouncementChangeQueueBatch(guard.db, {
      reason: "announcement_delete",
      requestedByUserId: guard.userId,
    });
    await mutateWithAudit(guard.db, {
      mutationStatements: [
        guard.db.run(sql`
          DELETE FROM announcements
          WHERE id = ${id} AND updated_at = ${existing.updated_at}
        `),
        ...queue.statements,
      ],
      expectedMutationChanges: [1, ...queue.expectedChanges],
      audits: [
        {
          table_name: "announcements",
          target_id: id,
          operation: "DELETE",
          before: { ...existing },
          after: null,
          actor_user_id: guard.userId,
          retention_class: "normal",
        },
      ],
    });
  } catch (error) {
    return announcementMutationError(error);
  }
  await revalidateAnnouncementPathsBestEffort("announcement.delete", [
    "/admin/announcements",
  ]);
  return { ok: true };
}
