"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import type { DB } from "@/lib/db/client";
import { announcements } from "@/lib/db/schema";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { generateId } from "@/lib/utils/id";

export interface AnnouncementResult {
  ok: boolean;
  message?: string;
  id?: string;
}

const schema = z.object({
  id: z.string().trim().optional(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000),
  severity: z.enum(["info", "warning", "danger"]).default("info"),
  target_audience: z.enum(["all", "creators", "admins"]).default("all"),
  is_published: z.coerce.number().min(0).max(1).default(0),
  publish_at: z.string().optional().nullable(),
  expire_at: z.string().optional().nullable(),
});

function parseDate(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return Math.floor(t / 1000);
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
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  const d = parsed.data;
  const id = (d.id?.trim() || generateId("anc"));
  const db = guard.db;
  const now = Math.floor(Date.now() / 1000);

  await mutateWithAudit(db, {
    mutationStatements: [db.run(sql`
      INSERT INTO announcements (id, title, body, severity, target_audience, is_published, publish_at, expire_at, created_by_user_id, created_at, updated_at)
      VALUES (${id}, ${d.title}, ${d.body}, ${d.severity}, ${d.target_audience}, ${d.is_published}, ${parseDate(d.publish_at)}, ${parseDate(d.expire_at)}, ${guard.userId}, ${now}, ${now})
    `)],
    expectedMutationChanges: 1,
    audits: [{ table_name: "announcements", target_id: id, operation: "CREATE", before: null, after: { id, title: d.title, body: d.body, severity: d.severity, target_audience: d.target_audience, is_published: d.is_published, publish_at: parseDate(d.publish_at), expire_at: parseDate(d.expire_at), created_by_user_id: guard.userId, created_at: now, updated_at: now }, actor_user_id: guard.userId, retention_class: "normal" }],
  });
  revalidatePath("/admin/announcements");
  return { ok: true, id };
}

export async function updateAnnouncement(
  formData: FormData,
): Promise<AnnouncementResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  const d = parsed.data;
  if (!d.id) return { ok: false, message: "id が必要です。" };
  const db = guard.db;
  const existing = (await db.select().from(announcements).where(eq(announcements.id, d.id)).limit(1))[0];
  if (!existing) return { ok: false, message: "対象のお知らせが見つかりません。" };
  const now = Math.floor(Date.now() / 1000);
  await mutateWithAudit(db, {
    mutationStatements: [db.run(sql`UPDATE announcements SET title=${d.title}, body=${d.body}, severity=${d.severity}, target_audience=${d.target_audience}, is_published=${d.is_published}, publish_at=${parseDate(d.publish_at)}, expire_at=${parseDate(d.expire_at)}, updated_at=${now} WHERE id=${d.id} AND updated_at=${existing.updated_at}`)],
    expectedMutationChanges: 1,
    audits: [{ table_name: "announcements", target_id: d.id, operation: "UPDATE", before: { ...existing }, after: { ...existing, title: d.title, body: d.body, severity: d.severity, target_audience: d.target_audience, is_published: d.is_published, publish_at: parseDate(d.publish_at), expire_at: parseDate(d.expire_at), updated_at: now }, actor_user_id: guard.userId, retention_class: "normal" }],
  });
  revalidatePath("/admin/announcements");
  revalidatePath(`/admin/announcements/${d.id}/edit`);
  return { ok: true, id: d.id };
}

export async function deleteAnnouncement(
  formData: FormData,
): Promise<AnnouncementResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, message: "id が必要です。" };
  const db = guard.db;
  const existing = (await db.select().from(announcements).where(eq(announcements.id, id)).limit(1))[0];
  if (!existing) return { ok: false, message: "対象のお知らせが見つかりません。" };
  await mutateWithAudit(db, {
    mutationStatements: [db.run(sql`DELETE FROM announcements WHERE id=${id} AND updated_at=${existing.updated_at}`)],
    expectedMutationChanges: 1,
    audits: [{ table_name: "announcements", target_id: id, operation: "DELETE", before: { ...existing }, after: null, actor_user_id: guard.userId, retention_class: "long_audit" }],
  });
  revalidatePath("/admin/announcements");
  return { ok: true };
}
