"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNull, or } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { canEditVideo } from "@/lib/auth/ownership";
import { writeGuard } from "@/lib/auth/writeGuard";
import {
  historyLogs,
  slots,
  videos,
  videoInteractions,
  videoMembers,
  xUsers,
} from "@/lib/db/schema";
import { extractYoutubeId } from "@/lib/youtube/id";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "@/lib/utils/xid";

const videoFormSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
  contact_x_id: z.string().trim().min(1).max(32),
  icon_url: z.string().trim().max(500).optional().nullable(),
  profile_text: z.string().trim().max(1000).optional().nullable(),
  youtube_channel_url: z.string().trim().max(500).optional().nullable(),
  other_social_links: z.string().trim().max(1000).optional().nullable(),
  title: z.string().trim().min(1).max(120),
  youtube_url: z.string().trim().url(),
  music: z.string().trim().max(200).optional().nullable(),
  credit: z.string().trim().max(200).optional().nullable(),
  intro_comment: z.string().trim().max(500).optional().nullable(),
  highlights: z.string().trim().max(1000).optional().nullable(),
  production_story: z.string().trim().max(1000).optional().nullable(),
  used_software: z.string().trim().max(200).optional().nullable(),
  closing_comment: z.string().trim().max(500).optional().nullable(),
  is_collab: z
    .union([z.literal("on"), z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "on" || v === "true"),
});

export interface VideoActionResult {
  ok: boolean;
  message?: string;
  videoId?: string;
}

interface MemberInput {
  name: string;
  x_user_id: string;
  role: string;
  comment: string;
}

function parseMembersJson(raw: FormDataEntryValue | null): MemberInput[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: MemberInput[] = [];
    for (const item of data) {
      if (typeof item !== "object" || item === null) continue;
      const o = item as Record<string, unknown>;
      const name = String(o.name ?? "").trim();
      const xid = normalizeXId(String(o.x_user_id ?? ""));
      const role = String(o.role ?? "").trim();
      const comment = String(o.comment ?? "").trim();
      if (!name && !xid) continue;
      out.push({ name: name || `@${xid}`, x_user_id: xid, role, comment });
    }
    return out;
  } catch {
    return [];
  }
}

async function ensureSubmissionXUser(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  args: {
    xId: string;
    displayName: string;
    iconUrl?: string | null;
    profileText?: string | null;
    youtubeChannelUrl?: string | null;
    socialLinks?: string | null;
    allowProfileUpdate?: boolean;
  },
): Promise<void> {
  if (!args.xId) return;
  const now = Math.floor(Date.now() / 1000);
  const existing = (
    await db.select().from(xUsers).where(eq(xUsers.id, args.xId)).limit(1)
  )[0];
  if (!existing) {
    if (args.allowProfileUpdate === false) return;
    await db.insert(xUsers).values({
      id: args.xId,
      x_name: args.displayName || `@${args.xId}`,
      icon_url: args.iconUrl || null,
      profile_text: args.profileText || null,
      youtube_channel_url: args.youtubeChannelUrl || null,
      other_social_links: args.socialLinks || null,
      approval_status: "pending",
      approval_requested_at: now,
    });
    return;
  }
  if (args.allowProfileUpdate === false) return;
  await db
    .update(xUsers)
    .set({
      x_name: args.displayName || existing.x_name,
      icon_url: args.iconUrl || existing.icon_url,
      profile_text: args.profileText ?? existing.profile_text,
      youtube_channel_url: args.youtubeChannelUrl ?? existing.youtube_channel_url,
      other_social_links: args.socialLinks ?? existing.other_social_links,
    })
    .where(eq(xUsers.id, args.xId));
}

/**
 * 作品の合作メンバーを総入れ替えする。
 * X ID が指定されているが xUsers に存在しない場合は pending で自動作成。
 */
async function replaceVideoMembers(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  videoId: string,
  members: MemberInput[],
): Promise<void> {
  await db.delete(videoMembers).where(eq(videoMembers.video_id, videoId));
  if (members.length === 0) return;
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    const xid = m.x_user_id || null;
    if (xid) {
      const existing = (
        await db.select().from(xUsers).where(eq(xUsers.id, xid)).limit(1)
      )[0];
      if (!existing) {
        await db.insert(xUsers).values({
          id: xid,
          x_name: m.name || `@${xid}`,
          approval_status: "pending",
          approval_requested_at: now,
        });
      }
    }
    await db.insert(videoMembers).values({
      id: generateId("vm"),
      video_id: videoId,
      x_user_id: xid,
      name: m.name,
      role: m.role || null,
      comment: m.comment || null,
      order_index: i,
    });
  }
}

/**
 * 自由投稿: イベントに紐づかない作品を新規登録する。
 * 設計の post/page.md および post/slotted/page.md に基づく簡易版。
 */
export async function createFreeVideo(
  formData: FormData,
): Promise<VideoActionResult> {
  const guard = await writeGuard({
    requireApprovedActiveXId: true,
    feature: "post_video_unslotted",
  });
  if (!guard.ok) return { ok: false, message: guard.message };
  const sessionUser = guard.user;
  const userId = sessionUser.id;
  const approvedXIds = guard.approvedXIds;

  const parsed = videoFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const youtubeId = extractYoutubeId(parsed.data.youtube_url);
  if (!youtubeId) {
    return { ok: false, message: "YouTube URL が解析できません。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const id = generateId("v");
  const now = Math.floor(Date.now() / 1000);
  const activeX = normalizeXId(parsed.data.contact_x_id || sessionUser.active_x_user_id);
  if (!activeX || !approvedXIds.includes(activeX)) {
    return { ok: false, message: "承認済みの X ID を選択してください。" };
  }
  const displayName = parsed.data.display_name;
  const iconUrl = parsed.data.icon_url || sessionUser.image || null;
  await ensureSubmissionXUser(db, {
    xId: activeX,
    displayName,
    iconUrl,
    profileText: parsed.data.profile_text ?? null,
    youtubeChannelUrl: parsed.data.youtube_channel_url ?? null,
    socialLinks: parsed.data.other_social_links ?? null,
    allowProfileUpdate: true,
  });

  await db.insert(videos).values({
    id,
    owner_discord_user_id: userId,
    creator_id: activeX || null,
    submission_type: parsed.data.is_collab ? "collab" : "individual",
    display_name: displayName,
    contact_x_id: activeX || "anonymous",
    title: parsed.data.title,
    youtube_video_id: youtubeId,
    icon_url: iconUrl,
    status: "public",
    music: parsed.data.music ?? null,
    credit: parsed.data.credit ?? null,
    intro_comment: parsed.data.intro_comment ?? null,
    highlights: parsed.data.highlights ?? null,
    production_story: parsed.data.production_story ?? null,
    used_software: parsed.data.used_software ?? null,
    closing_comment: parsed.data.closing_comment ?? null,
    is_deleted: 0,
    is_manual_hidden: 0,
    like_count: 0,
    youtube_view_count: 0,
    video_score: 0,
    scheduling_type: "manual",
    scheduled_time: now,
    created_at: now,
    updated_at: now,
  });

  const members = parsed.data.is_collab
    ? parseMembersJson(formData.get("members_json"))
    : [];
  await replaceVideoMembers(db, id, members);

  await db.insert(historyLogs).values({
    table_name: "videos",
    record_id: id,
    action: "CREATE",
    after_data: JSON.stringify({ title: parsed.data.title, youtube_video_id: youtubeId }),
    operator_discord_id: userId,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath("/");
  revalidatePath("/list");
  revalidatePath("/dashboard");
  return { ok: true, videoId: id };
}

/**
 * スロット提出: スロットを `submitted` に更新し、紐づく動画を登録 / 更新する。
 */
export async function submitSlotVideo(
  formData: FormData,
): Promise<VideoActionResult> {
  const guard = await writeGuard({
    requireApprovedActiveXId: true,
    feature: "post_video_slotted",
  });
  if (!guard.ok) return { ok: false, message: guard.message };
  const sessionUser = guard.user;
  const userId = sessionUser.id;
  const approvedXIds = guard.approvedXIds;

  const slotId = String(formData.get("slot_id") ?? "");
  if (!slotId) return { ok: false, message: "スロット ID がありません。" };

  const parsed = videoFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "入力エラー" };
  }
  const youtubeId = extractYoutubeId(parsed.data.youtube_url);
  if (!youtubeId) return { ok: false, message: "YouTube URL が解析できません。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const requestedX = normalizeXId(
    parsed.data.contact_x_id || sessionUser.active_x_user_id,
  );
  const slotOwnerWhere = requestedX
    ? or(
        eq(slots.x_user_id, requestedX),
        and(eq(slots.discord_user_id, userId), isNull(slots.x_user_id))!,
      )
    : eq(slots.discord_user_id, userId);
  const slotRow = (
    await db
      .select()
      .from(slots)
      .where(and(eq(slots.id, slotId), slotOwnerWhere)!)
      .limit(1)
  )[0];
  if (!slotRow) return { ok: false, message: "スロットが見つかりません。" };

  const now = Math.floor(Date.now() / 1000);
  const videoId = slotRow.video_id ?? generateId("v");
  const exists = !!slotRow.video_id;
  const slotX = normalizeXId(slotRow.x_user_id);
  const finalRequestedX = normalizeXId(requestedX || slotRow.x_user_id);
  if (!finalRequestedX) {
    return { ok: false, message: "承認済みの X ID を選択してください。" };
  }
  if (slotX && slotX !== finalRequestedX) {
    return {
      ok: false,
      message: "提出主体の X ID は確保時の ID に固定されます。",
    };
  }
  const activeX = slotX || finalRequestedX;
  if (!approvedXIds.includes(activeX)) {
    return { ok: false, message: "承認済みの X ID を選択してください。" };
  }
  await ensureSubmissionXUser(db, {
    xId: activeX,
    displayName: parsed.data.display_name,
    iconUrl: parsed.data.icon_url || sessionUser.image || null,
    profileText: parsed.data.profile_text ?? null,
    youtubeChannelUrl: parsed.data.youtube_channel_url ?? null,
    socialLinks: parsed.data.other_social_links ?? null,
    allowProfileUpdate: true,
  });

  if (exists) {
    await db
      .update(videos)
      .set({
        title: parsed.data.title,
        youtube_video_id: youtubeId,
        creator_id: activeX || null,
        contact_x_id: activeX || "anonymous",
        display_name: parsed.data.display_name,
        icon_url: parsed.data.icon_url || null,
        music: parsed.data.music ?? null,
        credit: parsed.data.credit ?? null,
        intro_comment: parsed.data.intro_comment ?? null,
        highlights: parsed.data.highlights ?? null,
        production_story: parsed.data.production_story ?? null,
        used_software: parsed.data.used_software ?? null,
        closing_comment: parsed.data.closing_comment ?? null,
        submission_type: parsed.data.is_collab ? "collab" : "individual",
        updated_at: now,
      })
      .where(eq(videos.id, videoId));
  } else {
    let displayName = parsed.data.display_name || slotRow.display_name || sessionUser.name || "anonymous";
    let iconUrl: string | null = parsed.data.icon_url || sessionUser.image || null;
    if (activeX) {
      const xRow = (
        await db.select().from(xUsers).where(eq(xUsers.id, activeX)).limit(1)
      )[0];
      if (xRow) {
        // スロットの display_name が空なら X の表示名で補完
        if (!slotRow.display_name) displayName = xRow.x_name || displayName;
        iconUrl = xRow.icon_url ?? iconUrl;
      }
    }

    await db.insert(videos).values({
      id: videoId,
      owner_discord_user_id: userId,
      creator_id: activeX || null,
      submission_type: parsed.data.is_collab ? "collab" : "individual",
      display_name: displayName,
      contact_x_id: activeX || "anonymous",
      title: parsed.data.title,
      youtube_video_id: youtubeId,
      icon_url: iconUrl,
      status: "pending",
      primary_event_id: slotRow.event_id,
      scheduling_type: "slotted",
      scheduled_time: slotRow.start_time ?? now,
      music: parsed.data.music ?? null,
      credit: parsed.data.credit ?? null,
      intro_comment: parsed.data.intro_comment ?? null,
      highlights: parsed.data.highlights ?? null,
      production_story: parsed.data.production_story ?? null,
      used_software: parsed.data.used_software ?? null,
      closing_comment: parsed.data.closing_comment ?? null,
      is_deleted: 0,
      is_manual_hidden: 0,
      like_count: 0,
      youtube_view_count: 0,
      video_score: 0,
      created_at: now,
      updated_at: now,
    });
  }

  const members = parsed.data.is_collab
    ? parseMembersJson(formData.get("members_json"))
    : [];
  await replaceVideoMembers(db, videoId, members);

  const slotUpdateWhere = slotRow.reservation_group_id
    ? and(
        eq(slots.reservation_group_id, slotRow.reservation_group_id),
        eq(slots.discord_user_id, userId),
      )!
    : eq(slots.id, slotRow.id);
  await db
    .update(slots)
    .set({ status: "submitted", video_id: videoId, updated_at: now })
    .where(slotUpdateWhere);

  await db.insert(historyLogs).values({
    table_name: "slots",
    record_id: slotRow.id,
    action: "UPDATE",
    after_data: JSON.stringify({ status: "submitted", video_id: videoId }),
    operator_discord_id: userId,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath("/");
  revalidatePath(`/event/${slotRow.event_id}`);
  revalidatePath("/dashboard");
  return { ok: true, videoId };
}

/**
 * 既存作品の編集保存。作者本人または管理者のみ可。
 * VideoForm の `mode = "edit"` 経由で呼ばれる。
 *
 * writeGuard では Active X ID を強制しない (admin が他者作品を編集する場合に
 * 自分の active X が無くてもよい)。実際の編集権限は canEditVideo で section
 * 別に判定する。
 */
export async function updateVideo(
  formData: FormData,
): Promise<VideoActionResult> {
  const guard = await writeGuard({ feature: "edit_video" });
  if (!guard.ok) return { ok: false, message: guard.message };
  const sessionUser = guard.user;
  const approvedXIds = guard.approvedXIds;

  const videoId = String(formData.get("video_id") ?? "").trim();
  if (!videoId) return { ok: false, message: "video_id が空です。" };

  const parsed = videoFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const youtubeId = extractYoutubeId(parsed.data.youtube_url);
  if (!youtubeId) return { ok: false, message: "YouTube URL が解析できません。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const target = (
    await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "対象作品が見つかりません。" };

  // Batch A 暫定: section 分割は次PR。requiredKey は "video.basics" 一本で運用する。
  const canEdit = await canEditVideo({
    db,
    user: { id: sessionUser.id, role: sessionUser.role ?? null },
    video: target,
    requiredKey: "video.basics",
  });
  if (!canEdit) {
    return { ok: false, message: "編集権限がありません。" };
  }

  const now = Math.floor(Date.now() / 1000);
  const requestedX = normalizeXId(parsed.data.contact_x_id);
  const existingX = normalizeXId(target.contact_x_id || target.creator_id);
  let nextCreatorX = existingX || requestedX;
  if (requestedX && requestedX !== existingX) {
    if (sessionUser.role === "admin" || approvedXIds.includes(requestedX)) {
      nextCreatorX = requestedX;
    } else {
      return { ok: false, message: "提出主体の X ID を変更する権限がありません。" };
    }
  }
  if (!nextCreatorX) {
    return { ok: false, message: "提出主体 X ID が必要です。" };
  }
  await ensureSubmissionXUser(db, {
    xId: nextCreatorX,
    displayName: parsed.data.display_name,
    iconUrl: parsed.data.icon_url ?? null,
    profileText: parsed.data.profile_text ?? null,
    youtubeChannelUrl: parsed.data.youtube_channel_url ?? null,
    socialLinks: parsed.data.other_social_links ?? null,
    allowProfileUpdate:
      sessionUser.role === "admin" || approvedXIds.includes(nextCreatorX),
  });
  await db
    .update(videos)
    .set({
      title: parsed.data.title,
      youtube_video_id: youtubeId,
      creator_id: nextCreatorX || null,
      contact_x_id: nextCreatorX || "anonymous",
      display_name: parsed.data.display_name,
      icon_url: parsed.data.icon_url || null,
      music: parsed.data.music ?? null,
      credit: parsed.data.credit ?? null,
      intro_comment: parsed.data.intro_comment ?? null,
      highlights: parsed.data.highlights ?? null,
      production_story: parsed.data.production_story ?? null,
      used_software: parsed.data.used_software ?? null,
      closing_comment: parsed.data.closing_comment ?? null,
      submission_type: parsed.data.is_collab ? "collab" : "individual",
      updated_at: now,
    })
    .where(eq(videos.id, videoId));

  const members = parsed.data.is_collab
    ? parseMembersJson(formData.get("members_json"))
    : [];
  await replaceVideoMembers(db, videoId, members);

  await db.insert(historyLogs).values({
    table_name: "videos",
    record_id: videoId,
    action: "UPDATE",
    after_data: JSON.stringify({
      title: parsed.data.title,
      youtube_video_id: youtubeId,
    }),
    operator_discord_id: sessionUser.id,
    retention_class: "normal",
    created_at: now,
  });

  revalidatePath("/");
  revalidatePath(`/${target.youtube_video_id ?? videoId}`);
  revalidatePath(`/${youtubeId}`);
  revalidatePath("/dashboard");
  return { ok: true, videoId };
}

/**
 * 作品にいいね or ブックマークを toggle する。
 * 既存の interaction があれば削除、無ければ追加する (TOGGLE 動作)。
 * 主体は writeGuard が保証する承認済み Active X ID。
 * 未承認 X ID で許可されるのは枠確保のみ、という方針に従い approved を必須とする。
 */
export async function toggleVideoInteraction(
  formData: FormData,
): Promise<VideoActionResult & { active?: boolean }> {
  const guard = await writeGuard({
    requireApprovedActiveXId: true,
    feature: "like_or_bookmark",
  });
  if (!guard.ok) return { ok: false, message: guard.message };
  const activeX = guard.activeXId;
  if (!activeX) {
    return { ok: false, message: "X ID を選択してから操作してください。" };
  }

  const videoId = String(formData.get("video_id") ?? "").trim();
  const kind = String(formData.get("kind") ?? "");
  if (!videoId) return { ok: false, message: "対象が指定されていません。" };
  if (kind !== "like" && kind !== "bookmark") {
    return { ok: false, message: "不正な操作種別です。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const target = (
    await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "作品が見つかりません。" };

  const existing = (
    await db
      .select()
      .from(videoInteractions)
      .where(
        and(
          eq(videoInteractions.x_user_id, activeX),
          eq(videoInteractions.video_id, videoId),
          eq(videoInteractions.interaction_type, kind),
        )!,
      )
      .limit(1)
  )[0];

  const now = Math.floor(Date.now() / 1000);

  if (existing) {
    await db
      .delete(videoInteractions)
      .where(eq(videoInteractions.id, existing.id));
    if (kind === "like") {
      await db
        .update(videos)
        .set({
          like_count: Math.max(0, (target.like_count ?? 0) - 1),
          updated_at: now,
        })
        .where(eq(videos.id, videoId));
    }
    revalidatePath(`/${target.youtube_video_id ?? videoId}`);
    return { ok: true, active: false, videoId };
  }

  try {
    await db.insert(videoInteractions).values({
      id: generateId("vi"),
      x_user_id: activeX,
      video_id: videoId,
      interaction_type: kind,
      source: "app",
      created_at: now,
    });
  } catch {
    return { ok: true, active: true, videoId };
  }
  if (kind === "like") {
    await db
      .update(videos)
      .set({
        like_count: (target.like_count ?? 0) + 1,
        updated_at: now,
      })
      .where(eq(videos.id, videoId));
  }
  revalidatePath(`/${target.youtube_video_id ?? videoId}`);
  return { ok: true, active: true, videoId };
}
