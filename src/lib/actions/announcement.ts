"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { announcements } from "@/lib/db/schema";
import { auditAction } from "@/lib/audit/helpers";
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
  { ok: true; userId: string } | { ok: false; result: AnnouncementResult }
> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id)
    return { ok: false, result: { ok: false, message: "ログインが必要です。" } };
  if (u.role !== "admin")
    return {
      ok: false,
      result: { ok: false, message: "管理者のみ操作できます。" },
    };
  return { ok: true, userId: u.id };
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
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const now = Math.floor(Date.now() / 1000);

  await db.insert(announcements).values({
    id,
    title: d.title,
    body: d.body,
    severity: d.severity,
    target_audience: d.target_audience,
    is_published: d.is_published,
    publish_at: parseDate(d.publish_at),
    expire_at: parseDate(d.expire_at),
    created_by_user_id: guard.userId,
    created_at: now,
    updated_at: now,
  });

  await auditAction(db, {
    table_name: "announcements",
    record_id: id,
    action: "CREATE",
    after_data: { title: d.title, is_published: d.is_published },
    operator_discord_id: guard.userId,
    retention_class: "normal",
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
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(announcements)
    .set({
      title: d.title,
      body: d.body,
      severity: d.severity,
      target_audience: d.target_audience,
      is_published: d.is_published,
      publish_at: parseDate(d.publish_at),
      expire_at: parseDate(d.expire_at),
      updated_at: now,
    })
    .where(eq(announcements.id, d.id));

  await auditAction(db, {
    table_name: "announcements",
    record_id: d.id,
    action: "UPDATE",
    after_data: { title: d.title, is_published: d.is_published },
    operator_discord_id: guard.userId,
    retention_class: "normal",
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
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const now = Math.floor(Date.now() / 1000);
  await db.delete(announcements).where(eq(announcements.id, id));
  await auditAction(db, {
    table_name: "announcements",
    record_id: id,
    action: "DELETE",
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
  });
  revalidatePath("/admin/announcements");
  return { ok: true };
}

export async function setAnnouncementPublished(
  formData: FormData,
): Promise<AnnouncementResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const id = String(formData.get("id") ?? "").trim();
  const next = Number(formData.get("is_published") ?? 0);
  if (!id) return { ok: false, message: "id が必要です。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(announcements)
    .set({ is_published: next, updated_at: now })
    .where(eq(announcements.id, id));
  await auditAction(db, {
    table_name: "announcements",
    record_id: id,
    action: "UPDATE",
    after_data: { is_published: next },
    operator_discord_id: guard.userId,
    retention_class: "normal",
  });
  revalidatePath("/admin/announcements");
  return { ok: true };
}
