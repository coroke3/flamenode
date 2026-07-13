"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { events } from "@/lib/db/schema";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { mutateWithAudit } from "@/lib/audit/mutate";

export interface ApiEndpointResult { ok: boolean; message?: string; id?: string }

async function setPublicApi(eventId: string, enabled: 0 | 1): Promise<ApiEndpointResult> {
  const guard = await requireAdminWrite("admin_api_endpoints");
  if (!guard.ok) return { ok: false, message: guard.message };
  if (!eventId || eventId.length > 128) return { ok: false, message: "event_idが不正です。" };
  const { db } = guard;
  const before = (await db.select().from(events).where(eq(events.id, eventId)).limit(1))[0];
  if (!before) return { ok: false, message: "イベントが見つかりません。" };
  if (enabled === 1 && before.visibility_status !== "public") return { ok: false, message: "公開イベントだけAPIを有効化できます。" };
  const now = Math.max(Math.floor(Date.now() / 1000), before.updated_at + 1);
  const after = { ...before, public_api_enabled: enabled, updated_at: now };
  try {
    await mutateWithAudit(db, {
      mutationStatements: [db.update(events).set({ public_api_enabled: enabled, updated_at: now }).where(and(eq(events.id, eventId), expectedRowCondition({ expectedCurrent: { ...before } }))!)],
      expectedMutationChanges: 1,
      audits: [{ table_name: "events", target_id: eventId, operation: "UPDATE", before: { ...before }, after: { ...after }, actor_user_id: guard.user.id, context: "admin_api_endpoints", reason: enabled ? "公開APIを有効化" : "公開APIを無効化", retention_class: "long_audit", strict: true }],
    });
  } catch (error) {
    console.error("[api-endpoints] atomic mutation failed", error);
    return { ok: false, message: "更新が競合したか監査記録に失敗しました。" };
  }
  revalidatePath("/admin/api-endpoints");
  return { ok: true, id: eventId, message: enabled ? "公開APIを有効化しました。" : "公開APIを無効化しました。" };
}

export async function createApiEndpoint(formData: FormData): Promise<ApiEndpointResult> {
  return setPublicApi(String(formData.get("event_id") ?? "").trim(), 1);
}

export async function setApiEndpointActive(formData: FormData): Promise<ApiEndpointResult> {
  const enabled = String(formData.get("public_api_enabled") ?? "0") === "1" ? 1 : 0;
  return setPublicApi(String(formData.get("id") ?? "").trim(), enabled);
}
