"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDatabase } from "@/lib/cloudflare";
import { videoModerationCases, videos } from "@/lib/db/schema";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { mutateWithAudit } from "@/lib/audit/mutate";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import {
  normalizeModerationCaseType,
  normalizeModerationResolutionStatus,
  normalizeModerationText,
  normalizeModerationVideoStatus,
  normalizeModerationXUserId,
  parseModerationDueAt,
} from "@/lib/admin/moderationCaseInput";
import { buildNotificationOutboxStatement } from "@/lib/notifications/enqueue";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import { generateId } from "@/lib/utils/id";

export interface ModerationAdminResult { ok: boolean; message?: string }

function snapshot(row: object): Record<string, unknown> { return { ...row }; }
function mutationError(error: unknown): ModerationAdminResult {
  console.error("[moderation-admin] atomic mutation failed", error);
  return { ok: false, message: "更新が競合したか、監査・通知記録に失敗しました。再読み込みしてお試しください。" };
}

function revalidateModeration(video: typeof videos.$inferSelect, changed: boolean): void {
  revalidatePath("/admin/moderation");
  revalidatePath(`/admin/videos/${video.id}`);
  revalidatePath("/admin");
  if (changed) {
    revalidatePath("/admin/videos");
    revalidatePath(`/${video.youtube_video_id ?? video.id}`);
    revalidatePath("/list");
  }
}

export async function createModerationCase(formData: FormData): Promise<ModerationAdminResult> {
  const guard = await requireAdminWrite("admin_moderation_create");
  if (!guard.ok) return { ok: false, message: guard.message };
  const videoId = String(formData.get("video_id") ?? "").trim();
  const caseType = normalizeModerationCaseType(String(formData.get("case_type") ?? ""));
  const publicReason = normalizeModerationText(String(formData.get("public_reason") ?? ""), 1000);
  const privateNote = normalizeModerationText(String(formData.get("private_note") ?? ""), 2000);
  const dueAt = parseModerationDueAt(String(formData.get("due_at") ?? ""));
  const relatedXUserId = normalizeModerationXUserId(String(formData.get("related_x_user_id") ?? ""));
  const nextVideoStatus = normalizeModerationVideoStatus(String(formData.get("video_status") ?? ""));
  if (!videoId) return { ok: false, message: "video_id が必要です。" };
  if (!caseType) return { ok: false, message: "不正な case_type です。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const video = (await db.select().from(videos).where(eq(videos.id, videoId)).limit(1))[0];
  if (!video) return { ok: false, message: "対象作品が見つかりません。" };
  const now = Math.floor(Date.now() / 1000);
  const id = generateId("vmc");
  const caseAfter: typeof videoModerationCases.$inferSelect = {
    id, video_id: videoId, case_type: caseType, status: "open",
    public_reason: publicReason || null, private_note: privateNote || null,
    due_at: dueAt, locked_until: null, attempt_count: 0,
    related_x_user_id: relatedXUserId, created_by_user_id: guard.user.id,
    resolved_by_user_id: null, created_at: now, resolved_at: null,
  };
  const changed = Boolean(nextVideoStatus && nextVideoStatus !== video.visibility_status);
  const videoAfter = changed ? { ...video, visibility_status: nextVideoStatus!, updated_at: now } : null;
  const queue = changed ? await buildStaticRebuildQueueBatch(db, [{ targetType: "video", targetId: video.id, reason: "moderation_case_created", priority: "high", requestedByUserId: guard.user.id }]) : { statements: [], expectedChanges: [] };
  const notification = video.submitted_by_user_id ? await buildNotificationOutboxStatement(db, {
    recipientUserId: video.submitted_by_user_id,
    type: "moderation_created",
    payload: { content: `作品「${video.title}」に運営確認ケースが作成されました。`, video_id: video.id, case_id: id, case_type: caseType, public_reason: publicReason || undefined, due_at: dueAt ?? undefined, video_status: changed ? nextVideoStatus : undefined },
    eventId: video.primary_event_id,
    dedupeKey: `moderation_created:${id}`,
  }) : null;
  const statements: BatchItem<"sqlite">[] = [db.insert(videoModerationCases).values(caseAfter)];
  const expected: (number | null)[] = [1];
  const audits: WriteAuditLogInput[] = [{ table_name: "video_moderation_cases", target_id: id, operation: "CREATE", after: snapshot(caseAfter), actor_user_id: guard.user.id, retention_class: "long_audit", context: "admin_moderation_create", reason: publicReason || "運営確認ケースの作成", strict: true }];
  if (videoAfter) {
    statements.push(db.update(videos).set({ visibility_status: videoAfter.visibility_status, updated_at: now }).where(and(eq(videos.id, video.id), expectedRowCondition({ expectedCurrent: snapshot(video) }))!));
    expected.push(1);
    audits.push({ table_name: "videos", target_id: video.id, operation: "UPDATE", after: snapshot(videoAfter), actor_user_id: guard.user.id, retention_class: videoAfter.visibility_status === "voided" ? "long_audit" : "normal", context: "admin_moderation_create", reason: `ケース ${id} 作成に伴う公開状態変更`, strict: true, before: snapshot(video) });
  }
  statements.push(...queue.statements); expected.push(...queue.expectedChanges);
  if (notification) { statements.push(notification); expected.push(null); }
  try { await mutateWithAudit(db, { mutationStatements: statements, expectedMutationChanges: expected, audits }); }
  catch (error) { return mutationError(error); }
  revalidateModeration(video, changed);
  return { ok: true, message: "case を作成しました。" };
}

export async function updateModerationCaseStatus(formData: FormData): Promise<ModerationAdminResult> {
  const guard = await requireAdminWrite("admin_moderation_update");
  if (!guard.ok) return { ok: false, message: guard.message };
  const id = String(formData.get("id") ?? "").trim();
  const status = normalizeModerationResolutionStatus(String(formData.get("status") ?? ""));
  const note = normalizeModerationText(String(formData.get("private_note") ?? ""), 2000);
  const nextVideoStatus = normalizeModerationVideoStatus(String(formData.get("video_status") ?? ""));
  if (!id) return { ok: false, message: "id が必要です。" };
  if (!status) return { ok: false, message: "不正な status です。" };
  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const current = (await db.select().from(videoModerationCases).where(eq(videoModerationCases.id, id)).limit(1))[0];
  if (!current) return { ok: false, message: "case が見つかりません。" };
  if (current.status !== "open") return { ok: false, message: `status=${current.status} は更新対象外です。` };
  const video = (await db.select().from(videos).where(eq(videos.id, current.video_id)).limit(1))[0];
  if (!video) return { ok: false, message: "対象作品が見つかりません。" };
  const now = Math.floor(Date.now() / 1000);
  const caseAfter = { ...current, status, private_note: note || current.private_note, resolved_by_user_id: guard.user.id, resolved_at: now };
  const changed = Boolean(nextVideoStatus && nextVideoStatus !== video.visibility_status);
  const videoAfter = changed ? { ...video, visibility_status: nextVideoStatus!, updated_at: now } : null;
  const queue = changed ? await buildStaticRebuildQueueBatch(db, [{ targetType: "video", targetId: video.id, reason: "moderation_case_resolved", priority: "high", requestedByUserId: guard.user.id }]) : { statements: [], expectedChanges: [] };
  const notification = video.submitted_by_user_id ? await buildNotificationOutboxStatement(db, {
    recipientUserId: video.submitted_by_user_id,
    type: `moderation_${status}`,
    payload: { content: `作品「${video.title}」の運営確認ケースが ${status} になりました。`, video_id: video.id, case_id: id, case_type: current.case_type, status, note: note || undefined, video_status: changed ? nextVideoStatus : undefined },
    eventId: video.primary_event_id,
    dedupeKey: `moderation_${status}:${id}`,
  }) : null;
  const statements: BatchItem<"sqlite">[] = [db.update(videoModerationCases).set({ status, private_note: caseAfter.private_note, resolved_by_user_id: guard.user.id, resolved_at: now }).where(and(eq(videoModerationCases.id, id), expectedRowCondition({ expectedCurrent: snapshot(current) }))!)];
  const expected: (number | null)[] = [1];
  const audits: WriteAuditLogInput[] = [{ table_name: "video_moderation_cases", target_id: id, operation: "UPDATE", before: snapshot(current), after: snapshot(caseAfter), actor_user_id: guard.user.id, retention_class: "long_audit", context: "admin_moderation_update", reason: note || `ケース状態を ${status} に変更`, strict: true }];
  if (videoAfter) {
    statements.push(db.update(videos).set({ visibility_status: videoAfter.visibility_status, updated_at: now }).where(and(eq(videos.id, video.id), expectedRowCondition({ expectedCurrent: snapshot(video) }))!));
    expected.push(1);
    audits.push({ table_name: "videos", target_id: video.id, operation: "UPDATE", before: snapshot(video), after: snapshot(videoAfter), actor_user_id: guard.user.id, retention_class: videoAfter.visibility_status === "voided" ? "long_audit" : "normal", context: "admin_moderation_update", reason: `ケース ${id} 更新に伴う公開状態変更`, strict: true });
  }
  statements.push(...queue.statements); expected.push(...queue.expectedChanges);
  if (notification) { statements.push(notification); expected.push(null); }
  try { await mutateWithAudit(db, { mutationStatements: statements, expectedMutationChanges: expected, audits }); }
  catch (error) { return mutationError(error); }
  revalidateModeration(video, changed);
  return { ok: true, message: "case を更新しました。" };
}
