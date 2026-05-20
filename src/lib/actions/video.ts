"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { getDatabase, getEnv } from "@/lib/cloudflare";
import { canEditVideo } from "@/lib/auth/ownership";
import { writeGuard, type WriteGuardDenyReason } from "@/lib/auth/writeGuard";
import {
  historyLogs,
  slots,
  videos,
  videoEvents,
  videoInteractions,
  videoMembers,
  xUsers,
  xUserIcons,
} from "@/lib/db/schema";
import { extractYoutubeId } from "@/lib/youtube/id";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "@/lib/utils/xid";
import { normalizeHttpUrl } from "@/lib/utils/url";

/**
 * 作品アイコン URL の正規化。
 *
 * 受け入れる:
 *   - http/https な URL (外部画像)
 *   - 内部アップロード URL `/api/media/...` (uploadVideoIconCandidate の返却値)
 *
 * 上記以外は null。
 */
function normalizeIconUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  if (s.length > 500) return null;
  if (s.startsWith("/api/media/")) return s;
  return normalizeHttpUrl(s, { maxLength: 500 });
}

// posting/youtube-id-and-active-x:
// contact_x_id は server 側では Active X ID から導出するため、
// form 入力は optional として受け取り、投稿主体としては信頼しない。
const videoFormSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
  contact_x_id: z.string().trim().max(32).optional().nullable(),
  icon_url: z.preprocess(
    (val) => normalizeIconUrl(val),
    z.string().trim().max(500).optional().nullable(),
  ),
  profile_text: z.string().trim().max(1000).optional().nullable(),
  youtube_channel_url: z.preprocess(
    (val) => (typeof val === "string" ? normalizeHttpUrl(val, { maxLength: 500 }) : val),
    z.string().trim().max(500).optional().nullable(),
  ),
  other_social_links: z.string().trim().max(1000).optional().nullable(),
  title: z.string().trim().min(1).max(120),
  youtube_url: z.preprocess(
    (val) => (typeof val === "string" ? normalizeHttpUrl(val, { maxLength: 500 }) ?? val : val),
    z.string().trim().url(),
  ),
  music: z.string().trim().max(200).optional().nullable(),
  // 楽曲リンク URL。空文字は null として扱い、http/https 以外は弾く。
  music_reference_url: z.preprocess(
    (val) => (typeof val === "string" ? normalizeHttpUrl(val, { maxLength: 500 }) : val),
    z.string().trim().max(500).optional().nullable(),
  ),
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
  /** 公開ページへの遷移用 (YouTube video id があれば優先される)。 */
  youtubeVideoId?: string;
  /** イベントへ戻る用 (slotted 提出の場合に slot.event_id をセット)。 */
  eventId?: string;
  reason?: WriteGuardDenyReason;
}

/**
 * D1 (SQLite) の unique constraint 違反かを判定する。
 * partial unique index `videos_youtube_id_active_uniq` 等で投稿レースを検出するために使う。
 */
function isYoutubeIdUniqueConstraintError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (!message) return false;
  if (!/UNIQUE constraint failed/i.test(message)) return false;
  return (
    /videos\.youtube_video_id/i.test(message) ||
    /videos_youtube_id_active_uniq/i.test(message)
  );
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

/**
 * 提出時の X ID プロフィール upsert。
 *
 * 注意: ここでは `x_users.icon_url` を**変更しない**。
 * 作品ごとのアイコンは `videos.icon_url` に保存し、ユーザー既定アイコン
 * (`x_users.icon_url`) は設定画面の `setXIdIcon` / `uploadXIdIcon` でのみ更新する。
 * 投稿フォームから渡されたアイコンが X ID 全体のアイコンを書き換える、という
 * 旧挙動 (作品アイコンを変えたつもりが全作品のアイコンに反映される) を防ぐ。
 *
 * 新規 xUsers レコードでも icon_url は null 固定にする。表示側では
 * `videos.icon_url` または過去作品からのフォールバックで解決される。
 */
async function ensureSubmissionXUser(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  args: {
    xId: string;
    displayName: string;
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
      icon_url: null,
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
      profile_text: args.profileText ?? existing.profile_text,
      youtube_channel_url: args.youtubeChannelUrl ?? existing.youtube_channel_url,
      other_social_links: args.socialLinks ?? existing.other_social_links,
    })
    .where(eq(xUsers.id, args.xId));
}

/**
 * formData から `event_ids` (カンマ区切り) を取り出し、有効な event_id 配列を返す。
 * 空文字 / 重複 / 不正値は除去する (実在チェックは syncVideoEvents 側ではしない)。
 */
function parseEventIdsFromForm(formData: FormData): string[] {
  const raw = formData.get("event_ids");
  if (typeof raw !== "string") return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 64),
    ),
  );
}

/**
 * `video_events` を differential に同期する。
 *
 * - `alwaysInclude`: スロット提出時の slot.event_id 等、UI で外せないイベント。
 * - `requested`: ユーザーが選択したイベント。
 * - 合算した集合を target として、現在の所属イベントとの差分で
 *   不要行を delete、未追加行を insert する。
 */
async function syncVideoEvents(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  videoId: string,
  requested: string[],
  alwaysInclude: string[] = [],
): Promise<void> {
  const target = Array.from(new Set([...alwaysInclude, ...requested]));
  const current = await db
    .select({ event_id: videoEvents.event_id })
    .from(videoEvents)
    .where(eq(videoEvents.video_id, videoId));
  const currentSet = new Set(current.map((r) => r.event_id));
  const targetSet = new Set(target);
  for (const r of current) {
    if (!targetSet.has(r.event_id)) {
      await db
        .delete(videoEvents)
        .where(
          and(
            eq(videoEvents.video_id, videoId),
            eq(videoEvents.event_id, r.event_id),
          )!,
        );
    }
  }
  for (const eventId of target) {
    if (!currentSet.has(eventId)) {
      await db
        .insert(videoEvents)
        .values({ video_id: videoId, event_id: eventId })
        .onConflictDoNothing();
    }
  }
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
      name_for_sort: m.name?.toLowerCase() ?? null,
      role: m.role || null,
      comment: m.comment || null,
      order_index: i,
    });
  }
}

/**
 * 作品保存時に videos.icon_url を x_user_icons の候補として記録する。
 *
 * 表示時のフォールバック (resolveXUserIcon / resolveMemberIcons) も同じ X ID の
 * 過去作品アイコンを使うが、本関数は明示的に「設定画面の候補リスト」に登録する。
 * これにより、別の作品を投稿するときに過去作品のアイコンを素早く再利用できる。
 *
 * 注意:
 *   - x_users.icon_url (ユーザー既定アイコン) は変更しない。
 *   - 同 X ID で同 URL の候補が既にあれば onConflictDoNothing。
 *     (x_user_icons_user_url_uniq に依存)
 */
async function recordXIconCandidateFromVideo(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  args: {
    xUserId: string;
    iconUrl: string | null | undefined;
    videoId: string;
  },
): Promise<void> {
  if (!args.xUserId || !args.iconUrl) return;
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(xUserIcons)
    .values({
      id: generateId("xicon"),
      x_user_id: args.xUserId,
      icon_url: args.iconUrl,
      source_video_id: args.videoId,
      source_type: "video",
      created_at: now,
    })
    .onConflictDoNothing();
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
  if (!guard.ok) return { ok: false, reason: guard.reason, message: guard.message };
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
  // posting/youtube-id-and-active-x: 投稿主体は Active X ID のみ。
  // form 入力の contact_x_id は信頼せず、セッションの active_x_user_id だけを使う。
  const activeX = normalizeXId(sessionUser.active_x_user_id);
  if (!activeX || !approvedXIds.includes(activeX)) {
    return { ok: false, message: "承認済みの X ID を選択してください。" };
  }

  // YouTube ID 重複チェック: 同じ youtube_video_id を持つ非削除・非 voided な動画が
  // 既に存在する場合は拒否する。
  const duplicateVideo = (
    await db
      .select({ id: videos.id })
      .from(videos)
      .where(
        and(
          eq(videos.youtube_video_id, youtubeId),
          eq(videos.is_deleted, 0),
          ne(videos.status, "voided"),
        ),
      )
      .limit(1)
  )[0];
  if (duplicateVideo) {
    return { ok: false, message: "この YouTube 動画は既に登録されています。" };
  }

  const displayName = parsed.data.display_name;
  // 作品ごとアイコンは form 入力のみを採用する。
  // sessionUser.image (Discord アバター) や x_users.icon_url にはフォールバックさせない。
  // 表示側 (resolveVideoDisplayIcons など) が x_users.icon_url や過去作品から補完する。
  const iconUrl = parsed.data.icon_url || null;
  await ensureSubmissionXUser(db, {
    xId: activeX,
    displayName,
    profileText: parsed.data.profile_text ?? null,
    youtubeChannelUrl: parsed.data.youtube_channel_url ?? null,
    socialLinks: parsed.data.other_social_links ?? null,
    allowProfileUpdate: true,
  });

  try {
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
      music_reference_url: parsed.data.music_reference_url ?? null,
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
  } catch (err) {
    if (isYoutubeIdUniqueConstraintError(err)) {
      return { ok: false, message: "この YouTube 動画は既に登録されています。" };
    }
    throw err;
  }

  const members = parsed.data.is_collab
    ? parseMembersJson(formData.get("members_json"))
    : [];
  await replaceVideoMembers(db, id, members);

  // 所属イベント (video_events) を differential に同期する。
  // free 投稿でも複数イベントに紐付けできる。primary_event_id は別途扱う。
  const requestedEventIds = parseEventIdsFromForm(formData);
  await syncVideoEvents(db, id, requestedEventIds);

  // 投稿主体 X ID の作品アイコン候補に追加する (今回の作品アイコンが空でなければ)。
  // x_users.icon_url は変更しない。
  await recordXIconCandidateFromVideo(db, {
    xUserId: activeX,
    iconUrl,
    videoId: id,
  });

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
  return { ok: true, videoId: id, youtubeVideoId: youtubeId };
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
  if (!guard.ok) return { ok: false, reason: guard.reason, message: guard.message };
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

  // posting/youtube-id-and-active-x: 提出主体は Active X ID のみ。
  // form 入力の contact_x_id は信頼せず、セッションの active_x_user_id だけを使う。
  const requestedX = normalizeXId(sessionUser.active_x_user_id);
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

  // YouTube ID 重複チェック: 同じ youtube_video_id を持つ非削除・非 voided な動画が
  // 既に存在する場合は拒否する。update 経路では現在の video 自身を除外する。
  const youtubeIdDuplicateWhere = exists
    ? and(
        eq(videos.youtube_video_id, youtubeId),
        eq(videos.is_deleted, 0),
        ne(videos.status, "voided"),
        ne(videos.id, videoId),
      )
    : and(
        eq(videos.youtube_video_id, youtubeId),
        eq(videos.is_deleted, 0),
        ne(videos.status, "voided"),
      );
  const duplicateSlotVideo = (
    await db
      .select({ id: videos.id })
      .from(videos)
      .where(youtubeIdDuplicateWhere)
      .limit(1)
  )[0];
  if (duplicateSlotVideo) {
    return { ok: false, message: "この YouTube 動画は既に登録されています。" };
  }

  await ensureSubmissionXUser(db, {
    xId: activeX,
    displayName: parsed.data.display_name,
    profileText: parsed.data.profile_text ?? null,
    youtubeChannelUrl: parsed.data.youtube_channel_url ?? null,
    socialLinks: parsed.data.other_social_links ?? null,
    allowProfileUpdate: true,
  });

  try {
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
          music_reference_url: parsed.data.music_reference_url ?? null,
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
      // 作品ごとアイコンは form 入力のみを採用する。
      // 旧コードは xRow.icon_url で上書きしていたため、ユーザー既定アイコンが
      // 作品ごとの選択を打ち消してしまう問題があった。
      // 表示時に x_users.icon_url や過去作品から補完するのは表示側の責務。
      const iconUrl: string | null = parsed.data.icon_url || null;
      if (activeX) {
        const xRow = (
          await db.select().from(xUsers).where(eq(xUsers.id, activeX)).limit(1)
        )[0];
        if (xRow) {
          // スロットの display_name が空なら X の表示名で補完
          if (!slotRow.display_name) displayName = xRow.x_name || displayName;
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
  } catch (err) {
    if (isYoutubeIdUniqueConstraintError(err)) {
      return { ok: false, message: "この YouTube 動画は既に登録されています。" };
    }
    throw err;
  }

  // 所属イベントを同期する。スロットのイベントは alwaysInclude として固定。
  // フォームから event_ids が空で送られても slot.event_id は外れない。
  const requestedEventIds = parseEventIdsFromForm(formData);
  await syncVideoEvents(db, videoId, requestedEventIds, [slotRow.event_id]);

  const members = parsed.data.is_collab
    ? parseMembersJson(formData.get("members_json"))
    : [];
  await replaceVideoMembers(db, videoId, members);

  // 投稿主体 X ID の作品アイコン候補に追加する (今回の作品アイコンが空でなければ)。
  // x_users.icon_url は変更しない。
  await recordXIconCandidateFromVideo(db, {
    xUserId: activeX,
    iconUrl: parsed.data.icon_url ?? null,
    videoId,
  });

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
  return {
    ok: true,
    videoId,
    youtubeVideoId: youtubeId,
    eventId: slotRow.event_id,
  };
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
  if (!guard.ok) return { ok: false, reason: guard.reason, message: guard.message };
  const sessionUser = guard.user;
  const approvedXIds = guard.approvedXIds;

  const videoId = String(formData.get("video_id") ?? "").trim();
  if (!videoId) return { ok: false, message: "video_id が空です。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const target = (
    await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
  )[0];
  if (!target) return { ok: false, message: "対象作品が見つかりません。" };

  const raw = Object.fromEntries(formData);
  const setDefault = (key: string, value: string | null | undefined) => {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      raw[key] = value ?? "";
    }
  };
  setDefault(
    "display_name",
    target.display_name ?? target.contact_x_id ?? target.creator_id ?? "anonymous",
  );
  setDefault("title", target.title);
  if (!Object.prototype.hasOwnProperty.call(raw, "youtube_url") && target.youtube_video_id) {
    raw.youtube_url = `https://youtu.be/${target.youtube_video_id}`;
  }
  setDefault("contact_x_id", target.creator_id ?? target.contact_x_id);
  setDefault("icon_url", target.icon_url);
  setDefault("music", target.music);
  setDefault("music_reference_url", target.music_reference_url);
  setDefault("credit", target.credit);
  setDefault("intro_comment", target.intro_comment);
  setDefault("highlights", target.highlights);
  setDefault("production_story", target.production_story);
  setDefault("used_software", target.used_software);
  setDefault("closing_comment", target.closing_comment);
  if (!Object.prototype.hasOwnProperty.call(raw, "is_collab")) {
    raw.is_collab = target.submission_type === "collab" ? "true" : "false";
  }

  const parsed = videoFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "入力エラー",
    };
  }
  const youtubeId = extractYoutubeId(parsed.data.youtube_url);
  if (!youtubeId) return { ok: false, message: "YouTube URL が解析できません。" };

  const editUser = { id: sessionUser.id, role: sessionUser.role ?? null };
  const [
    canEditIdentity,
    canEditBasics,
    canEditYoutube,
    canEditCredits,
    canEditDescriptions,
    canEditMembers,
  ] = await Promise.all([
    canEditVideo({ db, user: editUser, video: target, requiredKey: "video.identity" }),
    canEditVideo({ db, user: editUser, video: target, requiredKey: "video.basics" }),
    canEditVideo({ db, user: editUser, video: target, requiredKey: "video.youtube_id" }),
    canEditVideo({ db, user: editUser, video: target, requiredKey: "video.credits" }),
    canEditVideo({ db, user: editUser, video: target, requiredKey: "video.descriptions" }),
    canEditVideo({ db, user: editUser, video: target, requiredKey: "video.members" }),
  ]);
  if (
    !canEditIdentity &&
    !canEditBasics &&
    !canEditYoutube &&
    !canEditCredits &&
    !canEditDescriptions &&
    !canEditMembers
  ) {
    return { ok: false, message: "編集権限がありません。" };
  }

  const now = Math.floor(Date.now() / 1000);
  const existingX = normalizeXId(target.creator_id || target.contact_x_id);
  let nextCreatorX: string;
  if (canEditIdentity && sessionUser.role === "admin") {
    // admin は form 入力の contact_x_id で変更可。未指定の場合は既存を維持。
    const requestedX = normalizeXId(parsed.data.contact_x_id);
    nextCreatorX = requestedX || existingX || "";
  } else {
    // 非 admin: 投稿主体の変更を許可しない。既存の creator_id / contact_x_id を維持する。
    nextCreatorX = existingX || "";
  }
  if (!nextCreatorX) {
    return { ok: false, message: "提出主体 X ID が必要です。" };
  }
  const requestedX = normalizeXId(parsed.data.contact_x_id);
  const changed = (a: string | null | undefined, b: string | null | undefined) =>
    (a || null) !== (b || null);

  if (
    !canEditIdentity &&
    ((requestedX && requestedX !== existingX) ||
      changed(parsed.data.display_name, target.display_name) ||
      changed(parsed.data.icon_url, target.icon_url))
  ) {
    return { ok: false, message: "提出者情報を編集する権限がありません。" };
  }
  if (!canEditBasics && parsed.data.title !== target.title) {
    return { ok: false, message: "作品タイトルを編集する権限がありません。" };
  }
  const youtubeChanged = youtubeId !== (target.youtube_video_id ?? "");
  if (!canEditYoutube && youtubeChanged) {
    return { ok: false, message: "YouTube ID を編集する権限がありません。" };
  }
  if (
    !canEditCredits &&
    (changed(parsed.data.music, target.music) ||
      changed(parsed.data.credit, target.credit) ||
      changed(parsed.data.music_reference_url, target.music_reference_url))
  ) {
    return { ok: false, message: "楽曲・クレジットを編集する権限がありません。" };
  }
  if (
    !canEditDescriptions &&
    (changed(parsed.data.intro_comment, target.intro_comment) ||
      changed(parsed.data.highlights, target.highlights) ||
      changed(parsed.data.production_story, target.production_story) ||
      changed(parsed.data.used_software, target.used_software) ||
      changed(parsed.data.closing_comment, target.closing_comment))
  ) {
    return { ok: false, message: "紹介文・振り返り項目を編集する権限がありません。" };
  }
  if (
    !canEditMembers &&
    parsed.data.is_collab !== (target.submission_type === "collab")
  ) {
    return { ok: false, message: "合作メンバーを編集する権限がありません。" };
  }

  // YouTube ID 重複チェック: 自身を除いた非削除・非 voided な動画に同じ ID が存在したら拒否。
  if (canEditYoutube && youtubeChanged) {
    const duplicateUpdateVideo = (
      await db
        .select({ id: videos.id })
        .from(videos)
        .where(
          and(
            eq(videos.youtube_video_id, youtubeId),
            eq(videos.is_deleted, 0),
            ne(videos.status, "voided"),
            ne(videos.id, videoId),
          ),
        )
        .limit(1)
    )[0];
    if (duplicateUpdateVideo) {
      return { ok: false, message: "この YouTube 動画は既に登録されています。" };
    }
  }

  // ensureSubmissionXUser に渡す X ID は必ず承認済みか admin 操作であること。
  // 作品ごとアイコンは下の videos.update で parsed.data.icon_url を直接保存する。
  // ここでは x_users.icon_url を変更しない。
  if (canEditIdentity) {
    await ensureSubmissionXUser(db, {
      xId: nextCreatorX,
      displayName: parsed.data.display_name,
      profileText: parsed.data.profile_text ?? null,
      youtubeChannelUrl: parsed.data.youtube_channel_url ?? null,
      socialLinks: parsed.data.other_social_links ?? null,
      allowProfileUpdate:
        sessionUser.role === "admin" || approvedXIds.includes(nextCreatorX),
    });
  }
  try {
    await db
      .update(videos)
      .set({
        title: canEditBasics ? parsed.data.title : target.title,
        youtube_video_id: canEditYoutube ? youtubeId : target.youtube_video_id,
        creator_id: canEditIdentity ? nextCreatorX || null : target.creator_id,
        contact_x_id: canEditIdentity ? nextCreatorX || "anonymous" : target.contact_x_id,
        display_name: canEditIdentity ? parsed.data.display_name : target.display_name,
        icon_url: canEditIdentity ? parsed.data.icon_url || null : target.icon_url,
        music: canEditCredits ? parsed.data.music ?? null : target.music,
        music_reference_url: canEditCredits
          ? parsed.data.music_reference_url ?? null
          : target.music_reference_url,
        credit: canEditCredits ? parsed.data.credit ?? null : target.credit,
        intro_comment: canEditDescriptions
          ? parsed.data.intro_comment ?? null
          : target.intro_comment,
        highlights: canEditDescriptions ? parsed.data.highlights ?? null : target.highlights,
        production_story: canEditDescriptions
          ? parsed.data.production_story ?? null
          : target.production_story,
        used_software: canEditDescriptions
          ? parsed.data.used_software ?? null
          : target.used_software,
        closing_comment: canEditDescriptions
          ? parsed.data.closing_comment ?? null
          : target.closing_comment,
        submission_type: canEditMembers
          ? parsed.data.is_collab
            ? "collab"
            : "individual"
          : target.submission_type,
        updated_at: now,
      })
      .where(eq(videos.id, videoId));
  } catch (err) {
    if (isYoutubeIdUniqueConstraintError(err)) {
      return { ok: false, message: "この YouTube 動画は既に登録されています。" };
    }
    throw err;
  }

  if (canEditMembers) {
    const members = parsed.data.is_collab
      ? parseMembersJson(formData.get("members_json"))
      : [];
    await replaceVideoMembers(db, videoId, members);
  }

  // 所属イベント (video_events) の編集。primary_event_id を変えられる権限と同じ
  // canEditPrimaryEvent (= videos.primary_event 相当) で制御するのが本来だが、
  // 当面は canEditIdentity で代用する。primary_event_id は alwaysInclude として固定。
  if (canEditIdentity && formData.has("event_ids")) {
    const requestedEventIds = parseEventIdsFromForm(formData);
    const alwaysInclude = target.primary_event_id ? [target.primary_event_id] : [];
    await syncVideoEvents(db, videoId, requestedEventIds, alwaysInclude);
  }

  // identity を編集できた場合、作品アイコン候補に追加する。
  // (x_users.icon_url 自体は ensureSubmissionXUser でも変更しない方針)
  if (canEditIdentity) {
    await recordXIconCandidateFromVideo(db, {
      xUserId: nextCreatorX,
      iconUrl: parsed.data.icon_url ?? null,
      videoId,
    });
  }

  await db.insert(historyLogs).values({
      table_name: "videos",
      record_id: videoId,
      action: "UPDATE",
      after_data: JSON.stringify({
        sections: {
          identity: canEditIdentity,
          basics: canEditBasics,
          youtube: canEditYoutube,
          credits: canEditCredits,
          descriptions: canEditDescriptions,
          members: canEditMembers,
        },
        title: canEditBasics ? parsed.data.title : target.title,
        youtube_video_id: canEditYoutube ? youtubeId : target.youtube_video_id,
      }),
      operator_discord_id: sessionUser.id,
      retention_class: "normal",
    created_at: now,
  });

  revalidatePath("/");
  revalidatePath(`/${target.youtube_video_id ?? videoId}`);
  if (canEditYoutube) revalidatePath(`/${youtubeId}`);
  revalidatePath("/dashboard");
  return {
    ok: true,
    videoId,
    youtubeVideoId: canEditYoutube ? youtubeId : (target.youtube_video_id ?? undefined),
    eventId: target.primary_event_id ?? undefined,
  };
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
      // 同時いいね・解除のレースを避けるため DB 側で atomic に減算する。
      // max(0, ...) で 0 未満に下がらないようにし、初期 NULL も coalesce で吸収する。
      await db
        .update(videos)
        .set({
          like_count: sql<number>`max(0, coalesce(${videos.like_count}, 0) - 1)`,
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
  } catch (err) {
    // 二重いいね (video_interactions_uniq) のみ既存扱いで成功とする。
    // 他の DB エラーは握り潰さず失敗にする (UI に異常を見せた方が安全)。
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE constraint failed/i.test(message)) {
      return { ok: true, active: true, videoId };
    }
    return { ok: false, message: "操作に失敗しました。時間をおいて再試行してください。" };
  }
  if (kind === "like") {
    // 同時いいねのレースを避けるため DB 側で atomic に加算する。
    await db
      .update(videos)
      .set({
        like_count: sql<number>`coalesce(${videos.like_count}, 0) + 1`,
        updated_at: now,
      })
      .where(eq(videos.id, videoId));
  }
  revalidatePath(`/${target.youtube_video_id ?? videoId}`);
  return { ok: true, active: true, videoId };
}

/**
 * 作品ごとアイコン用のアップロード Action。
 *
 * 設定画面の `uploadXIdIcon` と異なり、**`x_users.icon_url` を変更しない**。
 * 投稿フォームから呼ばれた場合、アップロードされたファイルは R2 に保存され、
 * `/api/media/...` URL が返却される。呼び出し側はこの URL を `videos.icon_url` の
 * 値としてフォームに反映する想定。同時に `x_user_icons` に source_type="manual"
 * の候補として保存し、次回以降の作品投稿時に再利用できるようにする。
 *
 * 認可:
 *   - writeGuard で承認済み Active X ID を要求する。
 *   - 対象 X ID は session の active_x_user_id (= 投稿主体) に固定。
 *     これにより、他人の X ID 候補に勝手に画像を流し込めない。
 */
export async function uploadVideoIconCandidate(
  formData: FormData,
): Promise<VideoActionResult & { iconUrl?: string }> {
  const guard = await writeGuard({
    requireApprovedActiveXId: true,
    feature: "post_video_unslotted",
  });
  if (!guard.ok) return { ok: false, reason: guard.reason, message: guard.message };
  const sessionUser = guard.user;
  const activeX = normalizeXId(sessionUser.active_x_user_id);
  if (!activeX || !guard.approvedXIds.includes(activeX)) {
    return { ok: false, message: "承認済みの X ID を選択してください。" };
  }

  const file = formData.get("icon_file");
  if (!(file instanceof File)) {
    return { ok: false, message: "画像ファイルが必要です。" };
  }
  const contentType = file.type || "image/png";
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!allowedTypes.has(contentType)) {
    return { ok: false, message: "PNG/JPEG/WEBP のみアップロードできます。" };
  }
  if (file.size > 2 * 1024 * 1024) {
    return { ok: false, message: "2MB 以内の画像を選んでください。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  // 候補上限: 同 X ID 当たり manual ソース 24 枚 (設定画面と同じ)。
  const manualIconCount = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(xUserIcons)
    .where(
      and(
        eq(xUserIcons.x_user_id, activeX),
        eq(xUserIcons.source_type, "manual"),
      )!,
    );
  if (Number(manualIconCount[0]?.count ?? 0) >= 24) {
    return {
      ok: false,
      message:
        "手動アップロードの候補が上限に達しています。既存候補から選択してください。",
    };
  }

  const env = getEnv();
  if (!env.BUCKET) {
    return { ok: false, message: "ストレージが利用できません。" };
  }

  const ext =
    contentType === "image/png"
      ? "png"
      : contentType === "image/webp"
        ? "webp"
        : "jpg";
  const key = `video-icons/${activeX}/${generateId("vicon")}.${ext}`;
  const buf = await file.arrayBuffer();
  await env.BUCKET.put(key, buf, { httpMetadata: { contentType } });
  const iconUrl = `/api/media/${key}`;

  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(xUserIcons)
    .values({
      id: generateId("xicon"),
      x_user_id: activeX,
      icon_url: iconUrl,
      source_video_id: null,
      source_type: "manual",
      created_at: now,
    })
    .onConflictDoNothing();

  await db.insert(historyLogs).values({
    table_name: "x_user_icons",
    record_id: activeX,
    action: "CREATE",
    after_data: JSON.stringify({ icon_url: iconUrl, source: "video_upload" }),
    operator_discord_id: sessionUser.id,
    retention_class: "normal",
    created_at: now,
  });

  return { ok: true, message: "アップロードしました。", iconUrl };
}
