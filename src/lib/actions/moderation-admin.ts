"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { videoEvents, videoModerationCases, videos } from "@/lib/db/schema";
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
import {
  markPendingPublicReflection,
  type PendingPublicReflection,
} from "@/lib/staticRebuild/publicReflectionNotice";
import { generateId } from "@/lib/utils/id";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { createTraceId, logFlowTrace } from "@/lib/observability/flowTrace";
import { MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS } from "@/lib/staticRebuild/hooks";
import {
  enqueueVideoVisibilityNotificationsPostCommit,
  handleVideoVisibilityMutationFailure,
  planVideoVisibilityTransition,
  preCommitVideoVisibilityDepublicization,
  runVideoVisibilityTransitionPostCommit,
} from "@/lib/video/videoVisibilityTransition";

export interface ModerationAdminResult extends PendingPublicReflection {
  ok: boolean;
  message?: string;
}

function snapshot(row: object): Record<string, unknown> { return { ...row }; }
function mutationError(
  error: unknown,
  context?: { flow: string; traceId: string },
): ModerationAdminResult {
  unstable_rethrow(error);
  const error_code = error instanceof Error ? error.name : "UnknownError";
  if (context) {
    logFlowTrace({
      flow: context.flow,
      phase: "moderation_mutation_failed",
      trace_id: context.traceId,
      result: "failed",
      error_code,
      committed: false,
    });
    console.warn(
      JSON.stringify({
        service: "moderation_admin",
        flow: context.flow,
        trace_id: context.traceId,
        phase: "moderation_mutation_failed",
        error_code,
      }),
    );
  } else {
    console.error("[moderation-admin] atomic mutation failed", error);
  }
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

async function runModerationPostCommit(
  video: typeof videos.$inferSelect,
  changed: boolean,
  publicCacheKeys: readonly string[],
): Promise<void> {
  await runPostCommitBestEffort(
    { flow: "moderation.admin", traceId: createTraceId() },
    [{
      name: "moderation_visibility_post_commit",
      run: async () => {
        await runVideoVisibilityTransitionPostCommit({
          publicCacheKeys,
          revalidate: () => {
            revalidateModeration(video, changed);
          },
        });
      },
    }],
  );
}

async function loadVideoEventIds(db: Parameters<typeof planVideoVisibilityTransition>[0], videoId: string): Promise<string[]> {
  const eventRows = await db
    .select({ event_id: videoEvents.event_id })
    .from(videoEvents)
    .where(eq(videoEvents.video_id, videoId))
    .limit(MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS + 1);
  if (eventRows.length > MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS) {
    throw new Error("video_status_rebuild_event_limit_exceeded");
  }
  return eventRows.map((row) => row.event_id);
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
  const { db } = guard;
  const video = (await db.select().from(videos).where(eq(videos.id, videoId)).limit(1))[0];
  if (!video) return { ok: false, message: "対象作品が見つかりません。" };
  const existingOpenCase = (
    await db
      .select({ id: videoModerationCases.id })
      .from(videoModerationCases)
      .where(
        and(
          eq(videoModerationCases.video_id, videoId),
          eq(videoModerationCases.case_type, caseType),
          eq(videoModerationCases.status, "open"),
        )!,
      )
      .limit(1)
  )[0];
  if (existingOpenCase) {
    return { ok: false, message: "同じ種類の open case が既に存在します。既存 case を更新してください。" };
  }
  const now = Math.floor(Date.now() / 1000);
  const id = generateId("vmc");
  const traceId = createTraceId();
  const caseAfter: typeof videoModerationCases.$inferSelect = {
    id, video_id: videoId, case_type: caseType, status: "open",
    public_reason: publicReason || null, private_note: privateNote || null,
    due_at: dueAt, locked_until: null, attempt_count: 0,
    related_x_user_id: relatedXUserId, created_by_user_id: guard.user.id,
    resolved_by_user_id: null, created_at: now, resolved_at: null,
  };
  // pending partial unique index が未適用でも、同一D1 transaction内の
  // NOT EXISTS + changes() assertionで同video/typeのopen重複を防ぐ。
  const statements: BatchItem<"sqlite">[] = [db.run(sql`
    INSERT INTO video_moderation_cases (
      id, video_id, case_type, status, public_reason, private_note,
      due_at, locked_until, attempt_count, related_x_user_id,
      created_by_user_id, resolved_by_user_id, created_at, resolved_at
    )
    SELECT
      ${caseAfter.id}, ${caseAfter.video_id}, ${caseAfter.case_type},
      ${caseAfter.status}, ${caseAfter.public_reason}, ${caseAfter.private_note},
      ${caseAfter.due_at}, ${caseAfter.locked_until}, ${caseAfter.attempt_count},
      ${caseAfter.related_x_user_id}, ${caseAfter.created_by_user_id},
      ${caseAfter.resolved_by_user_id}, ${caseAfter.created_at},
      ${caseAfter.resolved_at}
    WHERE NOT EXISTS (
      SELECT 1
      FROM video_moderation_cases
      WHERE video_id = ${videoId}
        AND case_type = ${caseType}
        AND status = 'open'
    )
  `)];
  const expected: (number | null)[] = [1];
  const audits: WriteAuditLogInput[] = [{ table_name: "video_moderation_cases", target_id: id, operation: "CREATE", after: snapshot(caseAfter), actor_user_id: guard.user.id, retention_class: "long_audit", context: "admin_moderation_create", reason: publicReason || "運営確認ケースの作成", strict: true }];

  let transition = null as Awaited<ReturnType<typeof planVideoVisibilityTransition>> | null;
  if (nextVideoStatus && nextVideoStatus !== video.visibility_status) {
    const eventIds = await loadVideoEventIds(db, videoId);
    transition = await planVideoVisibilityTransition(db, {
      video,
      nextStatus: nextVideoStatus,
      actorUserId: guard.user.id,
      context: "admin_moderation_create",
      reason: publicReason || null,
      eventIds,
      now,
    });
    statements.unshift(...transition.mutationStatements);
    expected.unshift(...transition.expectedMutationChanges);
    audits.unshift(...transition.audits);
    if (transition.depublicizedFromPublic && transition.fenceToken) {
      try {
        await preCommitVideoVisibilityDepublicization({
          videoId,
          fenceToken: transition.fenceToken,
          reason: publicReason || null,
        });
      } catch (error) {
        unstable_rethrow(error);
        const error_code =
          error instanceof Error ? error.name : "UnknownError";
        logFlowTrace({
          flow: "admin_moderation_create",
          phase: "visibility_precommit_failed",
          trace_id: traceId,
          result: "failed",
          error_code,
          committed: false,
        });
        return { ok: false, message: "公開ブロックの記録に失敗しました。" };
      }
    }
  }

  try {
    await mutateWithAudit(db, {
      mutationStatements: statements,
      expectedMutationChanges: expected,
      audits,
      staticRebuildWakeSource:
        transition?.queueBatch.statements.length ? "admin" : undefined,
    });
  } catch (error) {
    if (transition) {
      return handleVideoVisibilityMutationFailure(db, error, {
        flow: "admin_moderation_create",
        traceId,
        videoId,
        depublicizedFromPublic: transition.depublicizedFromPublic,
        fenceToken: transition.fenceToken,
      });
    }
    return mutationError(error, { flow: "admin_moderation_create", traceId });
  }
  if (transition) {
    await enqueueVideoVisibilityNotificationsPostCommit(
      db,
      transition.notificationBatch,
      { flow: "admin_moderation_create", traceId, wakeSource: "admin" },
    );
  }
  await runModerationPostCommit(
    video,
    Boolean(transition?.visibilityChanged),
    transition?.publicCacheKeys ?? [],
  );
  return markPendingPublicReflection(
    { ok: true, message: "case を作成しました。" },
    Boolean(transition?.queueBatch.statements.length),
  );
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
  const { db } = guard;
  const current = (await db.select().from(videoModerationCases).where(eq(videoModerationCases.id, id)).limit(1))[0];
  if (!current) return { ok: false, message: "case が見つかりません。" };
  if (current.status !== "open") {
    if (current.status === status) {
      return { ok: true, message: "case は既にこの状態です。" };
    }
    return { ok: false, message: `status=${current.status} は更新対象外です。` };
  }
  const video = (await db.select().from(videos).where(eq(videos.id, current.video_id)).limit(1))[0];
  if (!video) return { ok: false, message: "対象作品が見つかりません。" };
  const now = Math.floor(Date.now() / 1000);
  const traceId = createTraceId();
  const caseAfter = { ...current, status, private_note: note || current.private_note, resolved_by_user_id: guard.user.id, resolved_at: now };
  const statements: BatchItem<"sqlite">[] = [db.update(videoModerationCases).set({ status, private_note: caseAfter.private_note, resolved_by_user_id: guard.user.id, resolved_at: now }).where(and(eq(videoModerationCases.id, id), expectedRowCondition({ expectedCurrent: snapshot(current) }))!)];
  const expected: (number | null)[] = [1];
  const audits: WriteAuditLogInput[] = [{ table_name: "video_moderation_cases", target_id: id, operation: "UPDATE", before: snapshot(current), after: snapshot(caseAfter), actor_user_id: guard.user.id, retention_class: "long_audit", context: "admin_moderation_update", reason: note || `ケース状態を ${status} に変更`, strict: true }];

  let transition = null as Awaited<ReturnType<typeof planVideoVisibilityTransition>> | null;
  if (nextVideoStatus && nextVideoStatus !== video.visibility_status) {
    const eventIds = await loadVideoEventIds(db, video.id);
    transition = await planVideoVisibilityTransition(db, {
      video,
      nextStatus: nextVideoStatus,
      actorUserId: guard.user.id,
      context: "admin_moderation_update",
      reason: note || null,
      eventIds,
      now,
    });
    statements.push(...transition.mutationStatements);
    expected.push(...transition.expectedMutationChanges);
    audits.push(...transition.audits);
    if (transition.depublicizedFromPublic && transition.fenceToken) {
      try {
        await preCommitVideoVisibilityDepublicization({
          videoId: video.id,
          fenceToken: transition.fenceToken,
          reason: note || null,
        });
      } catch (error) {
        unstable_rethrow(error);
        const error_code =
          error instanceof Error ? error.name : "UnknownError";
        logFlowTrace({
          flow: "admin_moderation_update",
          phase: "visibility_precommit_failed",
          trace_id: traceId,
          result: "failed",
          error_code,
          committed: false,
        });
        return { ok: false, message: "公開ブロックの記録に失敗しました。" };
      }
    }
  }

  try {
    await mutateWithAudit(db, {
      mutationStatements: statements,
      expectedMutationChanges: expected,
      audits,
      staticRebuildWakeSource:
        transition?.queueBatch.statements.length ? "admin" : undefined,
    });
  } catch (error) {
    if (transition) {
      return handleVideoVisibilityMutationFailure(db, error, {
        flow: "admin_moderation_update",
        traceId,
        videoId: video.id,
        depublicizedFromPublic: transition.depublicizedFromPublic,
        fenceToken: transition.fenceToken,
      });
    }
    return mutationError(error, { flow: "admin_moderation_update", traceId });
  }
  if (transition) {
    await enqueueVideoVisibilityNotificationsPostCommit(
      db,
      transition.notificationBatch,
      { flow: "admin_moderation_update", traceId, wakeSource: "admin" },
    );
  }
  await runModerationPostCommit(
    video,
    Boolean(transition?.visibilityChanged),
    transition?.publicCacheKeys ?? [],
  );
  return markPendingPublicReflection(
    { ok: true, message: "case を更新しました。" },
    Boolean(transition?.queueBatch.statements.length),
  );
}
