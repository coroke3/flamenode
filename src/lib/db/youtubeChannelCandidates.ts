import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
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
/**
 * 過去作品スナップショットから候補テーブルへ不足分を補完する (冪等)。
 */
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
