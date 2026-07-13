"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, gt } from "drizzle-orm";
import { termsVersions, users } from "@/lib/db/schema";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { mutateWithAudit, planD1AuditMutationBudget } from "@/lib/audit/mutate";
import { buildKnownRecipientNotificationBatch } from "@/lib/notifications/enqueue";
import { generateId } from "@/lib/utils/id";
import {
  getLatestPublishedMajorTerms,
  termsReacceptRequiredCondition,
} from "@/lib/terms/reaccept";

export interface RulesResult { ok: boolean; message?: string; id?: string }
export interface RulesBroadcastResult extends RulesResult { enqueued?: number; cursor?: string }

const TERMS_REACCEPT_BATCH_SIZE = 30;
const TERMS_REACCEPT_MAX_CONTENT_LEN = 1000;
type TermsRow = typeof termsVersions.$inferSelect;

const draftSchema = z.object({
  id: z.string().trim().optional(),
  version_label: z.string().trim().min(1).max(80),
  body_markdown: z.string().trim().min(1).max(40000),
  severity: z.enum(["minor", "major"]).default("minor"),
});

function snapshot(row: object): Record<string, unknown> { return { ...row }; }
function mutationError(error: unknown): RulesResult {
  console.error("[rules] atomic mutation failed", error);
  return { ok: false, message: "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。" };
}

export async function createTermsVersion(formData: FormData): Promise<RulesResult> {
  const guard = await requireAdminWrite("admin_terms_create");
  if (!guard.ok) return { ok: false, message: guard.message };
  const parsed = draftSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  const d = parsed.data;
  const id = d.id?.trim() || generateId("tv");
  const { db } = guard;
  const now = Math.floor(Date.now() / 1000);
  const after: TermsRow = {
    id, version_label: d.version_label, body_markdown: d.body_markdown,
    status: "draft", severity: d.severity, published_at: null,
    created_by_user_id: guard.user.id, created_at: now, updated_at: now,
  };
  try {
    await mutateWithAudit(db, {
      mutationStatements: [db.insert(termsVersions).values(after)],
      expectedMutationChanges: 1,
      audits: [{ table_name: "terms_versions", target_id: id, operation: "CREATE", after: snapshot(after), actor_user_id: guard.user.id, retention_class: "long_audit", context: "admin_terms_create", strict: true }],
    });
  } catch (error) { return mutationError(error); }
  revalidatePath("/admin/rules");
  return { ok: true, id };
}

export async function updateTermsVersion(formData: FormData): Promise<RulesResult> {
  const guard = await requireAdminWrite("admin_terms_update");
  if (!guard.ok) return { ok: false, message: guard.message };
  const parsed = draftSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  const d = parsed.data;
  if (!d.id) return { ok: false, message: "id が必要です。" };
  const { db } = guard;
  const before = (await db.select().from(termsVersions).where(eq(termsVersions.id, d.id)).limit(1))[0];
  if (!before) return { ok: false, message: "対象が見つかりません。" };
  if (before.status !== "draft") return { ok: false, message: "下書き状態のバージョンのみ編集できます。" };
  const patch = { version_label: d.version_label, body_markdown: d.body_markdown, severity: d.severity, updated_at: Math.floor(Date.now() / 1000) };
  const after = { ...before, ...patch };
  try {
    await mutateWithAudit(db, {
      mutationStatements: [db.update(termsVersions).set(patch).where(and(eq(termsVersions.id, d.id), expectedRowCondition({ expectedCurrent: snapshot(before) }))!)],
      expectedMutationChanges: 1,
      audits: [{ table_name: "terms_versions", target_id: d.id, operation: "UPDATE", before: snapshot(before), after: snapshot(after), actor_user_id: guard.user.id, retention_class: "long_audit", context: "admin_terms_update", strict: true }],
    });
  } catch (error) { return mutationError(error); }
  revalidatePath("/admin/rules"); revalidatePath(`/admin/rules/${d.id}/edit`); revalidatePath("/rules");
  return { ok: true, id: d.id };
}

export async function publishTermsVersion(formData: FormData): Promise<RulesResult> {
  const guard = await requireAdminWrite("admin_terms_publish");
  if (!guard.ok) return { ok: false, message: guard.message };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, message: "id が必要です。" };
  const { db } = guard;
  const target = (await db.select().from(termsVersions).where(eq(termsVersions.id, id)).limit(1))[0];
  if (!target) return { ok: false, message: "対象が見つかりません。" };
  if (target.status === "archived") return { ok: false, message: "アーカイブ済みの規約は再公開できません。" };
  if (target.status === "published") return { ok: true, id };
  const published = await db.select().from(termsVersions).where(eq(termsVersions.status, "published")).limit(2);
  if (published.length > 1) return { ok: false, message: "公開中の規約が複数存在するため処理を停止しました。" };
  const current = published[0];
  // 秒精度でも公開順序が曖昧にならないよう、公開時刻を単調増加させる。
  const now = Math.max(
    Math.floor(Date.now() / 1000),
    (current?.published_at ?? 0) + 1,
  );
  const statements = [];
  const expected: number[] = [];
  const audits = [];
  if (current) {
    const after = { ...current, status: "archived" as const, updated_at: now };
    statements.push(db.update(termsVersions).set({ status: "archived", updated_at: now }).where(and(eq(termsVersions.id, current.id), expectedRowCondition({ expectedCurrent: snapshot(current) }))!));
    expected.push(1);
    audits.push({ table_name: "terms_versions", target_id: current.id, operation: "UPDATE" as const, before: snapshot(current), after: snapshot(after), actor_user_id: guard.user.id, retention_class: "long_audit" as const, context: "admin_terms_publish", reason: "新しい規約公開に伴う旧版アーカイブ", strict: true });
  }
  const targetAfter = { ...target, status: "published" as const, published_at: now, updated_at: now };
  statements.push(db.update(termsVersions).set({ status: "published", published_at: now, updated_at: now }).where(and(eq(termsVersions.id, target.id), expectedRowCondition({ expectedCurrent: snapshot(target) }))!));
  expected.push(1);
  audits.push({ table_name: "terms_versions", target_id: target.id, operation: "UPDATE" as const, before: snapshot(target), after: snapshot(targetAfter), actor_user_id: guard.user.id, retention_class: "long_audit" as const, context: "admin_terms_publish", reason: "規約版の公開", strict: true });
  try {
    await mutateWithAudit(db, { mutationStatements: statements, expectedMutationChanges: expected, audits });
  } catch (error) { return mutationError(error); }
  revalidatePath("/admin/rules"); revalidatePath("/rules");
  return { ok: true, id };
}

export async function broadcastTermsReaccept(formData: FormData): Promise<RulesBroadcastResult> {
  const guard = await requireAdminWrite("admin_terms_broadcast");
  if (!guard.ok) return { ok: false, message: guard.message };
  const termsId = String(formData.get("terms_id") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();
  const cursor = String(formData.get("cursor") ?? "").trim();
  if (!termsId) return { ok: false, message: "terms_id が必要です。" };
  if (confirm !== "TERMS") return { ok: false, message: "確認文字列 'TERMS' が一致しません。" };
  if (cursor.length > 128) return { ok: false, message: "cursor が長すぎます。" };
  const content = String(formData.get("content") ?? "").trim().slice(0, TERMS_REACCEPT_MAX_CONTENT_LEN);
  const { db } = guard;
  const target = (await db.select().from(termsVersions).where(eq(termsVersions.id, termsId)).limit(1))[0];
  if (!target || target.status !== "published") return { ok: false, message: "公開中の規約だけ通知できます。" };
  const requiredMajor = await getLatestPublishedMajorTerms(db);
  if (!requiredMajor) return { ok: true, message: "再同意が必要なmajor規約はありません。", enqueued: 0, cursor };
  const rows = await db.select({ user_id: users.id }).from(users).where(and(
    termsReacceptRequiredCondition(requiredMajor),
    eq(users.is_notification_enabled, 1),
    cursor ? gt(users.id, cursor) : undefined,
  )!).orderBy(users.id).limit(TERMS_REACCEPT_BATCH_SIZE + 1);
  const targets = rows.slice(0, TERMS_REACCEPT_BATCH_SIZE);
  if (targets.length === 0) return { ok: true, message: "対象がありません。", enqueued: 0, cursor };
  const message = content || `FlameNode の利用規約が更新されました。\n/rules から確認し、再同意してください。\nversion: ${target.version_label}`;
  const notifications = await buildKnownRecipientNotificationBatch(db, targets.map((row) => ({
    recipientUserId: row.user_id,
    type: "terms_reaccept_required",
    payload: { content: message, terms_version_id: termsId, version_label: target.version_label, terms_url: "/rules" },
    dedupeKey: `terms_reaccept_required:${termsId}:${row.user_id}`,
  })));
  const now = Math.floor(Date.now() / 1000);
  const after = { ...target, updated_at: now };
  const mutationStatements = [
    db.update(termsVersions).set({ updated_at: now }).where(and(eq(termsVersions.id, termsId), expectedRowCondition({ expectedCurrent: snapshot(target) }))!),
    ...notifications.statements,
  ];
  const expected = [1, ...notifications.expectedChanges];
  const budget = planD1AuditMutationBudget({ mutationStatementCount: mutationStatements.length, mutationAssertionCount: 1, auditEntryCount: 1, distinctActorCount: 1 });
  if (!budget.withinLimit) return { ok: false, message: "通知件数がD1処理上限を超えます。" };
  try {
    await mutateWithAudit(db, {
      mutationStatements,
      expectedMutationChanges: expected,
      audits: [{ table_name: "terms_versions", target_id: termsId, operation: "UPDATE", before: snapshot(target), after: snapshot(after), actor_user_id: guard.user.id, retention_class: "long_audit", context: "admin_terms_broadcast", reason: `再同意通知 batch cursor=${cursor} enqueued=${notifications.statements.length}`, strict: true }],
    });
  } catch (error) { return mutationError(error); }
  const nextCursor = targets.at(-1)?.user_id ?? cursor;
  revalidatePath("/admin/rules"); revalidatePath("/admin/notifications");
  return { ok: true, message: `${notifications.statements.length}件を登録しました。`, enqueued: notifications.statements.length, cursor: nextCursor };
}

export async function archiveTermsVersion(formData: FormData): Promise<RulesResult> {
  const guard = await requireAdminWrite("admin_terms_archive");
  if (!guard.ok) return { ok: false, message: guard.message };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, message: "id が必要です。" };
  const { db } = guard;
  const before = (await db.select().from(termsVersions).where(eq(termsVersions.id, id)).limit(1))[0];
  if (!before) return { ok: false, message: "対象が見つかりません。" };
  const after = { ...before, status: "archived" as const, updated_at: Math.floor(Date.now() / 1000) };
  try {
    await mutateWithAudit(db, {
      mutationStatements: [db.update(termsVersions).set({ status: after.status, updated_at: after.updated_at }).where(and(eq(termsVersions.id, id), expectedRowCondition({ expectedCurrent: snapshot(before) }))!)],
      expectedMutationChanges: 1,
      audits: [{ table_name: "terms_versions", target_id: id, operation: "UPDATE", before: snapshot(before), after: snapshot(after), actor_user_id: guard.user.id, retention_class: "long_audit", context: "admin_terms_archive", reason: "規約版のアーカイブ", strict: true }],
    });
  } catch (error) { return mutationError(error); }
  revalidatePath("/admin/rules"); revalidatePath("/rules");
  return { ok: true };
}
