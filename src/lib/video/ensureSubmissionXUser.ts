import { eq } from "drizzle-orm";
import { xUsers } from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { normalizeSocialLinksForStorage } from "@/lib/socialLinks";

/**
 * 提出時の X ID プロフィール upsert。
 * `x_users.icon_url` は変更しない。
 */
export async function ensureSubmissionXUser(
  db: DB,
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
  const hasSocialLinksInput = args.socialLinks != null;
  const socialLinks = hasSocialLinksInput
    ? normalizeSocialLinksForStorage(args.socialLinks)
    : null;
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
      other_social_links: socialLinks,
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
      other_social_links: hasSocialLinksInput
        ? socialLinks
        : existing.other_social_links,
    })
    .where(eq(xUsers.id, args.xId));
}
