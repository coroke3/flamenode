"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import {
  parseEventTemplateSnapshot,
  snapshotFromEvent,
  type EventTemplateSnapshot,
} from "@/lib/admin/eventTemplateSettings";
import { eventTemplates, events, historyLogs } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";

export interface EventTemplateActionResult {
  ok: boolean;
  message?: string;
  templateId?: string;
}

async function requireAdmin(): Promise<
  | { ok: true; userId: string }
  | { ok: false; result: EventTemplateActionResult }
> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) {
    return { ok: false, result: { ok: false, message: "ログインが必要です。" } };
  }
  if (u.role !== "admin") {
    return {
      ok: false,
      result: { ok: false, message: "管理者のみ操作できます。" },
    };
  }
  return { ok: true, userId: u.id };
}

const saveSchema = z.object({
  event_id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
});

export async function saveEventAsTemplate(
  formData: FormData,
): Promise<EventTemplateActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;

  const parsed = saveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const event = (
    await db
      .select()
      .from(events)
      .where(eq(events.id, parsed.data.event_id))
      .limit(1)
  )[0];
  if (!event) {
    return { ok: false, message: "イベントが見つかりません。" };
  }

  const snapshot = snapshotFromEvent(event);
  const id = generateId("etmpl");
  const now = Math.floor(Date.now() / 1000);

  await db.insert(eventTemplates).values({
    id,
    name: parsed.data.name,
    description: parsed.data.description?.trim() || null,
    source_event_id: event.id,
    settings_json: JSON.stringify(snapshot),
    created_by_user_id: guard.userId,
    created_at: now,
    updated_at: now,
  });

  await db.insert(historyLogs).values({
    table_name: "event_templates",
    record_id: id,
    action: "CREATE",
    after_data: JSON.stringify({
      name: parsed.data.name,
      source_event_id: event.id,
    }),
    operator_discord_id: guard.userId,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath("/admin/events/templates");
  revalidatePath(`/admin/events/${event.id}`);
  return { ok: true, templateId: id, message: "テンプレートを保存しました。" };
}

export async function deleteEventTemplate(
  formData: FormData,
): Promise<EventTemplateActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;

  const templateId = String(formData.get("template_id") ?? "").trim();
  if (!templateId) {
    return { ok: false, message: "template_id が必要です。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const row = (
    await db
      .select({ id: eventTemplates.id, name: eventTemplates.name })
      .from(eventTemplates)
      .where(eq(eventTemplates.id, templateId))
      .limit(1)
  )[0];
  if (!row) {
    return { ok: false, message: "テンプレートが見つかりません。" };
  }

  await db.delete(eventTemplates).where(eq(eventTemplates.id, templateId));

  const now = Math.floor(Date.now() / 1000);
  await db.insert(historyLogs).values({
    table_name: "event_templates",
    record_id: templateId,
    action: "DELETE",
    after_data: JSON.stringify({ name: row.name }),
    operator_discord_id: guard.userId,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath("/admin/events/templates");
  revalidatePath("/admin/events/new");
  return { ok: true, message: "テンプレートを削除しました。" };
}

export async function loadEventTemplateSnapshot(
  templateId: string,
): Promise<EventTemplateSnapshot | null> {
  const guard = await requireAdmin();
  if (!guard.ok) return null;

  const db = getDatabase();
  if (!db) return null;

  const row = (
    await db
      .select({ settings_json: eventTemplates.settings_json })
      .from(eventTemplates)
      .where(eq(eventTemplates.id, templateId))
      .limit(1)
  )[0];
  if (!row) return null;
  return parseEventTemplateSnapshot(row.settings_json);
}

export async function listEventTemplatesForAdmin(): Promise<
  Array<{
    id: string;
    name: string;
    description: string | null;
    source_event_id: string | null;
    updated_at: number;
  }>
> {
  const guard = await requireAdmin();
  if (!guard.ok) return [];

  const db = getDatabase();
  if (!db) return [];

  return db
    .select({
      id: eventTemplates.id,
      name: eventTemplates.name,
      description: eventTemplates.description,
      source_event_id: eventTemplates.source_event_id,
      updated_at: eventTemplates.updated_at,
    })
    .from(eventTemplates)
    .orderBy(desc(eventTemplates.updated_at));
}
