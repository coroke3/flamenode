import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { generateId } from "@/lib/utils/id";
import { normalizeYoutubeChannelInput } from "@/lib/utils/youtubeChannel";
import type { DB } from "./client";
import { videos, xUserYoutubeChannels, xUsers } from "./schema";

function xUserIdLower(xId: string): string {
  return xId.trim().toLowerCase();
}

function creatorXUserIdMatches(xId: string) {
  return sql`lower(${videos.creator_x_user_id}) = ${xUserIdLower(xId)}`;
}

function xUserYoutubeChannelUserMatches(xId: string) {
  return sql`lower(${xUserYoutubeChannels.x_user_id}) = ${xUserIdLower(xId)}`;
}

/** 作品スナップショット用にチャンネル URL を正規化する。 */
export function snapshotYoutubeChannelUrl(
  raw: string | null | undefined,
): string | null {
  return normalizeYoutubeChannelInput(raw);
}

/**
 * 作品保存時に使った YouTube チャンネル URL を候補として記録する。
 * x_users.youtube_channel_url (プロフィール正本) は変更しない。
 * 紐づけ先は引数の xUserId ではなく、当該作品の creator_x_user_id を優先する。
 */
export async function recordYoutubeChannelCandidateFromVideo(
  db: DB,
  args: {
    xUserId: string;
    youtubeChannelUrl: string | null | undefined;
    videoId: string;
  },
): Promise<void> {
  const normalized = snapshotYoutubeChannelUrl(args.youtubeChannelUrl);
  if (!normalized) return;

  const creatorFromVideo = args.videoId
    ? (
        await db
          .select({ creator_x_user_id: videos.creator_x_user_id })
          .from(videos)
          .where(eq(videos.id, args.videoId))
          .limit(1)
      )[0]?.creator_x_user_id
    : null;
  const xUserId = creatorFromVideo?.trim() || args.xUserId.trim();
  if (!xUserId) return;

  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(xUserYoutubeChannels)
    .values({
      id: generateId("xuch"),
      x_user_id: xUserId,
      youtube_channel_url: normalized,
      source_video_id: args.videoId,
      source_type: "video",
      created_at: now,
    })
    .onConflictDoNothing();
}

/**
 * 過去作品スナップショットから候補テーブルへ不足分を補完する (冪等)。
 */
async function reconcileYoutubeChannelCandidatesFromVideos(
  db: DB,
  xId: string,
  limit = 32,
): Promise<void> {
  const rows = await db
    .select({
      video_id: videos.id,
      channel_url: videos.creator_youtube_channel_url,
    })
    .from(videos)
    .where(
      and(
        creatorXUserIdMatches(xId),
        isNotNull(videos.creator_youtube_channel_url),
      )!,
    )
    .orderBy(desc(videos.created_at))
    .limit(limit);

  for (const row of rows) {
    if (!row.channel_url) continue;
    await recordYoutubeChannelCandidateFromVideo(db, {
      xUserId: xId,
      youtubeChannelUrl: row.channel_url,
      videoId: row.video_id,
    });
  }
}

/**
 * YouTube チャンネル選択用候補。
 *
 * 候補ソース (指定 X ID のみ、重複除去・新しい順):
 *   1. x_users.youtube_channel_url (プロフィール正本)
 *   2. x_user_youtube_channels (投稿・手動記録履歴)
 *   3. videos.creator_youtube_channel_url (過去作品スナップショット)
 */
export async function getYoutubeChannelCandidates(
  db: DB,
  xId: string,
  limit = 24,
): Promise<string[]> {
  if (!xId) return [];

  const lowerXId = xUserIdLower(xId);
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string | null | undefined) => {
    const normalized = snapshotYoutubeChannelUrl(raw);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  await reconcileYoutubeChannelCandidatesFromVideos(db, xId);

  const row = (
    await db
      .select({ youtube_channel_url: xUsers.youtube_channel_url })
      .from(xUsers)
      .where(sql`lower(${xUsers.id}) = ${lowerXId}`)
      .limit(1)
  )[0];
  push(row?.youtube_channel_url);

  const historyRows = await db
    .select({ youtube_channel_url: xUserYoutubeChannels.youtube_channel_url })
    .from(xUserYoutubeChannels)
    .where(xUserYoutubeChannelUserMatches(xId))
    .orderBy(desc(xUserYoutubeChannels.created_at))
    .limit(limit * 2);
  for (const historyRow of historyRows) {
    push(historyRow.youtube_channel_url);
    if (out.length >= limit) return out;
  }

  const videoRows = await db
    .select({ youtube_channel_url: videos.creator_youtube_channel_url })
    .from(videos)
    .where(
      and(
        creatorXUserIdMatches(xId),
        isNotNull(videos.creator_youtube_channel_url),
      )!,
    )
    .orderBy(desc(videos.created_at))
    .limit(limit * 2);
  for (const videoRow of videoRows) {
    push(videoRow.youtube_channel_url);
    if (out.length >= limit) return out;
  }

  return out.slice(0, limit);
}
