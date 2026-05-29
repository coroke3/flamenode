"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { apiEndpoints, events, historyLogs } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";

export interface ApiEndpointResult {
  ok: boolean;
  message?: string;
  id?: string;
}

async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; result: ApiEndpointResult }
> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) return { ok: false, result: { ok: false, message: "ログインが必要です。" } };
  if (u.role !== "admin") {
    return { ok: false, result: { ok: false, message: "管理者のみ操作できます。" } };
  }
  return { ok: true, userId: u.id };
}

export async function createApiEndpoint(
  formData: FormData,
): Promise<ApiEndpointResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;

  const eventId = String(formData.get("event_id") ?? "").trim();
  if (!eventId) return { ok: false, message: "event_id が必要です。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const event = (
    await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1)
  )[0];
  if (!event) return { ok: false, message: "イベントが見つかりません。" };

  const existing = (
    await db
      .select({ id: apiEndpoints.id, is_active: apiEndpoints.is_active })
      .from(apiEndpoints)
      .where(eq(apiEndpoints.event_id, eventId))
      .limit(1)
  )[0];
  const now = Math.floor(Date.now() / 1000);
  if (existing) {
    await db
      .update(apiEndpoints)
      .set({ is_active: 1 })
      .where(eq(apiEndpoints.id, existing.id));
    await db.insert(historyLogs).values({
      table_name: "api_endpoints",
      record_id: existing.id,
      action: "UPDATE",
      before_data: JSON.stringify({ is_active: existing.is_active ?? 0 }),
      after_data: JSON.stringify({ is_active: 1, event_id: eventId }),
      operator_discord_id: guard.userId,
      retention_class: "long_audit",
      created_at: now,
    });
    revalidatePath("/admin/api-endpoints");
    return { ok: true, id: existing.id, message: "既存 endpoint を有効化しました。" };
  }

  const id = generateId("api");
  await db.insert(apiEndpoints).values({
    id,
    event_id: eventId,
    is_active: 1,
    created_at: now,
  });
  await db.insert(historyLogs).values({
    table_name: "api_endpoints",
    record_id: id,
    action: "CREATE",
    after_data: JSON.stringify({ event_id: eventId, is_active: 1 }),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });
  revalidatePath("/admin/api-endpoints");
  return { ok: true, id, message: "API endpoint を作成しました。" };
}

export async function setApiEndpointActive(
  formData: FormData,
): Promise<ApiEndpointResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;

  const id = String(formData.get("id") ?? "").trim();
  const next = Number(formData.get("is_active") ?? 0) === 1 ? 1 : 0;
  if (!id) return { ok: false, message: "id が必要です。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const current = (
    await db.select().from(apiEndpoints).where(eq(apiEndpoints.id, id)).limit(1)
  )[0];
  if (!current) return { ok: false, message: "endpoint が見つかりません。" };

  const now = Math.floor(Date.now() / 1000);
  await db.update(apiEndpoints).set({ is_active: next }).where(eq(apiEndpoints.id, id));
  await db.insert(historyLogs).values({
    table_name: "api_endpoints",
    record_id: id,
    action: "UPDATE",
    before_data: JSON.stringify({ is_active: current.is_active ?? 0 }),
    after_data: JSON.stringify({ is_active: next }),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });
  revalidatePath("/admin/api-endpoints");
  return { ok: true, id, message: next === 1 ? "endpoint を有効化しました。" : "endpoint を無効化しました。" };
}
