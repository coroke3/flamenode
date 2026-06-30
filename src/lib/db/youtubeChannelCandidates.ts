import { and, eq, isNotNull } from "drizzle-orm";
import { parseSocialLinks } from "@/lib/socialLinks";
import type { DB } from "./client";
import { xUsers } from "./schema";
import { normalizeYoutubeChannelInput } from "@/lib/utils/youtubeChannel";

/**
 * 設定画面の YouTube チャンネル選択用候補。
 *
 * 候補ソース (重複除去):
 *   1. x_users.youtube_channel_url (当該 X ID)
 *   2. 同一 Discord に紐づく他 X ID の youtube_channel_url
 *   3. other_social_links 内の YouTube 系 URL
 */
export async function getYoutubeChannelCandidates(
  db: DB,
  xId: string,
  limit = 12,
): Promise<string[]> {
  if (!xId) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string | null | undefined) => {
    const normalized = normalizeYoutubeChannelInput(raw);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  const row = (
    await db
      .select({
        youtube_channel_url: xUsers.youtube_channel_url,
        other_social_links: xUsers.other_social_links,
        linked_discord_user_id: xUsers.linked_discord_user_id,
      })
      .from(xUsers)
      .where(eq(xUsers.id, xId))
      .limit(1)
  )[0];

  push(row?.youtube_channel_url);

  if (row?.other_social_links) {
    for (const link of parseSocialLinks(row.other_social_links)) {
      const url = link.url.trim();
      if (!/youtube\.com|youtu\.be/i.test(url)) continue;
      push(url);
    }
  }

  if (row?.linked_discord_user_id) {
    const siblings = await db
      .select({ youtube_channel_url: xUsers.youtube_channel_url })
      .from(xUsers)
      .where(
        and(
          eq(xUsers.linked_discord_user_id, row.linked_discord_user_id),
          isNotNull(xUsers.youtube_channel_url),
        )!,
      );
    for (const sibling of siblings) {
      push(sibling.youtube_channel_url);
    }
  }

  return out.slice(0, limit);
}
