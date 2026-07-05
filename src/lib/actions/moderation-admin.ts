"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { videoModerationCases, videos } from "@/lib/db/schema";
import { auditAction } from "@/lib/audit/helpers";
import {
  normalizeModerationCaseType,
  normalizeModerationResolutionStatus,
  normalizeModerationText,
  normalizeModerationVideoStatus,
  normalizeModerationXUserId,
  parseModerationDueAt,
} from "@/lib/admin/moderationCaseInput";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { generateId } from "@/lib/utils/id";

export interface ModerationAdminResult {
  ok: boolean;
  message?: string;
}

interface AdminUser {
  id?: string;
  role?: string;
}

function getAdminUser(sessionUser: unknown): AdminUser | null {
  const u = sessionUser as AdminUser | undefined;
  return u?.id && u.role === "admin" ? u : null;
}

async function notifyVideoSubmitter(
  db: ReturnType<typeof getDatabase>,
  target: {
    title: string;
    submitted_by_discord_user_id: string | null;
    primary_event_id: string | null;
  } | null,
  input: {
    type: string;
    content: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  if (!db || !target?.submitted_by_discord_user_id) return;
  await enqueueNotification(db, {
    discordUserId: target.submitted_by_discord_user_id,
    type: input.type,
    payload: {
      content: input.content,
      ...input.payload,
    },
    eventId: target.primary_event_id ?? null,
  });
}

export async function createModerationCase(
  formData: FormData,
): Promise<ModerationAdminResult> {
  const session = await auth().catch(() => null);
  const u = getAdminUser(session?.user);
  if (!u?.id) {
    return { ok: false, message: "管理者のみ操作できます。" };
  }

  const videoId = String(formData.get("video_id") ?? "").trim();
  const caseType = normalizeModerationCaseType(String(formData.get("case_type") ?? ""));
  const publicReason = normalizeModerationText(
    String(formData.get("public_reason") ?? ""),
    1000,
  );
  const privateNote = normalizeModerationText(
    String(formData.get("private_note") ?? ""),
    2000,
  );
  const dueAt = parseModerationDueAt(String(formData.get("due_at") ?? ""));
  const relatedXUserId = normalizeModerationXUserId(
    String(formData.get("related_x_user_id") ?? ""),
  );
  const nextVideoStatus = normalizeModerationVideoStatus(
    String(formData.get("video_status") ?? ""),
  );

  if (!videoId) return { ok: false, message: "video_id が必要です。" };
  if (!caseType) return { ok: false, message: "不正な case_type です。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const target = (
    await db
      .select({
        id: videos.id,
        title: videos.title,
        visibility_status: videos.visibility_status,
        submitted_by_discord_user_id: videos.submitted_by_discord_user_id,
        primary_event_id: videos.primary_event_id,
        youtube_video_id: videos.youtube_video_id,
      })
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1)
  )[0];
  if (!target) return { ok: false, message: "対象作品が見つかりません。" };

  const now = Math.floor(Date.now() / 1000);
  const id = generateId("vmc");
  await db.insert(videoModerationCases).values({
    id,
    video_id: videoId,
    case_type: caseType,
    status: "open",
    public_reason: publicReason || null,
    private_note: privateNote || null,
    due_at: dueAt,
    attempt_count: 0,
    related_x_user_id: relatedXUserId,
    created_by_user_id: u.id,
    created_at: now,
  });

  let videoStatusChanged: string | null = null;
  if (nextVideoStatus && nextVideoStatus !== target.visibility_status) {
    await db
      .update(videos)
      .set({
        visibility_status: nextVideoStatus,
        updated_at: now,
      })
      .where(eq(videos.id, videoId));
    videoStatusChanged = nextVideoStatus;

    await auditAction(db, {
      table_name: "videos",
      record_id: videoId,
      action: "UPDATE",
      before_data: { visibility_status: target.visibility_status },
      after_data: {
        visibility_status: nextVideoStatus,
        moderation_case_id: id,
        case_type: caseType,
      },
      operator_discord_id: u.id,
      retention_class: nextVideoStatus === "voided" ? "long_audit" : "normal",
    });
  }

  await auditAction(db, {
    table_name: "video_moderation_cases",
    record_id: id,
    action: "CREATE",
    after_data: {
      video_id: videoId,
      case_type: caseType,
      status: "open",
      public_reason: publicReason || null,
      private_note: privateNote ? "[stored]" : null,
      due_at: dueAt,
      related_x_user_id: relatedXUserId,
      video_status: videoStatusChanged,
    },
    operator_discord_id: u.id,
    retention_class: "long_audit",
  });

  await notifyVideoSubmitter(db, target, {
    type: "moderation_created",
    content: `作品「${target.title}」に運営確認ケースが作成されました。`,
    payload: {
      video_id: videoId,
      case_id: id,
      case_type: caseType,
      public_reason: publicReason || undefined,
      due_at: dueAt ?? undefined,
      video_status: videoStatusChanged ?? undefined,
    },
  });

  revalidatePath("/admin/moderation");
  revalidatePath(`/admin/videos/${videoId}`);
  revalidatePath("/admin");
  if (videoStatusChanged) {
    revalidatePath("/admin/videos");
    revalidatePath(`/${target.youtube_video_id ?? videoId}`);
    revalidatePath("/list");
  }
  return { ok: true, message: "case を作成しました。" };
}

export async function updateModerationCaseStatus(
  formData: FormData,
): Promise<ModerationAdminResult> {
  const session = await auth().catch(() => null);
  const u = getAdminUser(session?.user);
  if (!u?.id) {
    return { ok: false, message: "管理者のみ操作できます。" };
  }

  const id = String(formData.get("id") ?? "").trim();
  const status = normalizeModerationResolutionStatus(
    String(formData.get("status") ?? ""),
  );
  const note = normalizeModerationText(
    String(formData.get("private_note") ?? ""),
    2000,
  );
  const nextVideoStatus = normalizeModerationVideoStatus(
    String(formData.get("video_status") ?? ""),
  );
  if (!id) return { ok: false, message: "id が必要です。" };
  if (!status) return { ok: false, message: "不正な status です。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const current = (
    await db.select().from(videoModerationCases).where(eq(videoModerationCases.id, id)).limit(1)
  )[0];
  if (!current) return { ok: false, message: "case が見つかりません。" };
  if (current.status !== "open") {
    return { ok: false, message: `status=${current.status} は更新対象外です。` };
  }

  const target = (
    await db
      .select({
        id: videos.id,
        title: videos.title,
        visibility_status: videos.visibility_status,
        submitted_by_discord_user_id: videos.submitted_by_discord_user_id,
        primary_event_id: videos.primary_event_id,
        youtube_video_id: videos.youtube_video_id,
      })
      .from(videos)
      .where(eq(videos.id, current.video_id))
      .limit(1)
  )[0] ?? null;

  const now = Math.floor(Date.now() / 1000);
  await db
    .update(videoModerationCases)
    .set({
      status: status as (typeof videoModerationCases.$inferInsert)["status"],
      private_note: note || current.private_note,
      resolved_by_user_id: u.id,
      resolved_at: now,
    })
    .where(eq(videoModerationCases.id, id));

  let videoStatusChanged: string | null = null;
  if (nextVideoStatus && nextVideoStatus !== target?.visibility_status) {
    await db
      .update(videos)
      .set({
        visibility_status: nextVideoStatus,
        updated_at: now,
      })
      .where(eq(videos.id, current.video_id));
    videoStatusChanged = nextVideoStatus;

    await auditAction(db, {
      table_name: "videos",
      record_id: current.video_id,
      action: "UPDATE",
      before_data: JSON.stringify({ visibility_status: target?.visibility_status ?? null }),
      after_data: JSON.stringify({
        visibility_status: nextVideoStatus,
        moderation_case_id: id,
        case_status: status,
      }),
      operator_discord_id: u.id,
      retention_class: nextVideoStatus === "voided" ? "long_audit" : "normal",
    });
  }

  await auditAction(db, {
    table_name: "video_moderation_cases",
    record_id: id,
    action: "UPDATE",
    before_data: JSON.stringify({ status: current.status }),
    after_data: JSON.stringify({
      status,
      note: note || null,
      video_status: videoStatusChanged,
    }),
    operator_discord_id: u.id,
    retention_class: "long_audit",
  });

  await notifyVideoSubmitter(db, target, {
    type: `moderation_${status}`,
    content: `作品「${target?.title ?? current.video_id}」の運営確認ケースが ${status} になりました。`,
    payload: {
      video_id: current.video_id,
      case_id: id,
      case_type: current.case_type,
      status,
      note: note || undefined,
      video_status: videoStatusChanged ?? undefined,
    },
  });

  revalidatePath("/admin/moderation");
  revalidatePath(`/admin/videos/${current.video_id}`);
  revalidatePath("/admin");
  if (videoStatusChanged) {
    revalidatePath("/admin/videos");
    revalidatePath(`/${target?.youtube_video_id ?? current.video_id}`);
    revalidatePath("/list");
  }
  return { ok: true, message: "case を更新しました。" };
}
