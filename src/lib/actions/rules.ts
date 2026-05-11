"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, ne } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { historyLogs, termsVersions, users } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";

export interface RulesResult {
  ok: boolean;
  message?: string;
  id?: string;
}

const draftSchema = z.object({
  id: z.string().trim().optional(),
  version_label: z.string().trim().min(1).max(80),
  body_markdown: z.string().trim().min(1).max(40000),
  severity: z.enum(["minor", "major"]).default("minor"),
});

async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; result: RulesResult }
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

export async function createTermsVersion(
  formData: FormData,
): Promise<RulesResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const parsed = draftSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  const d = parsed.data;
  const id = (d.id?.trim() || generateId("tv"));
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const now = Math.floor(Date.now() / 1000);
  await db.insert(termsVersions).values({
    id,
    version_label: d.version_label,
    body_markdown: d.body_markdown,
    severity: d.severity,
    status: "draft",
    created_by_user_id: guard.userId,
    created_at: now,
    updated_at: now,
  });
  await db.insert(historyLogs).values({
    table_name: "terms_versions",
    record_id: id,
    action: "CREATE",
    after_data: JSON.stringify({ version_label: d.version_label }),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });
  revalidatePath("/admin/rules");
  return { ok: true, id };
}

export async function updateTermsVersion(
  formData: FormData,
): Promise<RulesResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const parsed = draftSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  const d = parsed.data;
  if (!d.id) return { ok: false, message: "id が必要です。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const existing = (
    await db.select().from(termsVersions).where(eq(termsVersions.id, d.id)).limit(1)
  )[0];
  if (!existing) return { ok: false, message: "対象が見つかりません。" };
  if (existing.status !== "draft") {
    return {
      ok: false,
      message: "下書き状態のバージョンのみ編集できます。",
    };
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(termsVersions)
    .set({
      version_label: d.version_label,
      body_markdown: d.body_markdown,
      severity: d.severity,
      updated_at: now,
    })
    .where(eq(termsVersions.id, d.id));
  await db.insert(historyLogs).values({
    table_name: "terms_versions",
    record_id: d.id,
    action: "UPDATE",
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });
  revalidatePath("/admin/rules");
  revalidatePath(`/admin/rules/${d.id}/edit`);
  revalidatePath("/rules");
  return { ok: true, id: d.id };
}

export async function publishTermsVersion(
  formData: FormData,
): Promise<RulesResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, message: "id が必要です。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const target = (
    await db.select().from(termsVersions).where(eq(termsVersions.id, id)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "対象が見つかりません。" };
  if (target.status === "archived") {
    return {
      ok: false,
      message: "archived 状態のバージョンは再公開できません。新規作成してください。",
    };
  }

  const now = Math.floor(Date.now() / 1000);
  // 既存の published を archived へ
  await db
    .update(termsVersions)
    .set({ status: "archived", updated_at: now })
    .where(eq(termsVersions.status, "published"));

  await db
    .update(termsVersions)
    .set({ status: "published", published_at: now, updated_at: now })
    .where(eq(termsVersions.id, id));

  // major の場合、全 user に再同意要求フラグを立てる
  if (target.severity === "major") {
    await db
      .update(users)
      .set({ terms_reaccept_required: 1 })
      .where(ne(users.id, ""));
  }

  await db.insert(historyLogs).values({
    table_name: "terms_versions",
    record_id: id,
    action: "UPDATE",
    after_data: JSON.stringify({
      status: "published",
      severity: target.severity,
      forced_reaccept: target.severity === "major",
    }),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });
  revalidatePath("/admin/rules");
  revalidatePath("/rules");
  return { ok: true, id };
}

export async function archiveTermsVersion(
  formData: FormData,
): Promise<RulesResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.result;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, message: "id が必要です。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(termsVersions)
    .set({ status: "archived", updated_at: now })
    .where(eq(termsVersions.id, id));
  await db.insert(historyLogs).values({
    table_name: "terms_versions",
    record_id: id,
    action: "UPDATE",
    after_data: JSON.stringify({ status: "archived" }),
    operator_discord_id: guard.userId,
    retention_class: "long_audit",
    created_at: now,
  });
  revalidatePath("/admin/rules");
  revalidatePath("/rules");
  return { ok: true };
}
