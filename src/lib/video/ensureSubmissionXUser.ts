import { and, eq } from "drizzle-orm";
import { xUsers } from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { normalizeSocialLinksForStorage } from "@/lib/socialLinks";
import {
  emptyVideoAtomicWritePlan,
  type VideoAtomicWritePlan,
} from "@/lib/video/atomicWritePlan";
import { expectedRowCondition } from "@/lib/audit/adapters";

/** Submission profile mutation plan. The caller must merge it into the video D1 batch. */
export async function buildSubmissionXUserPlan(
  db: DB,
  args: {
    xId: string;
    displayName: string;
    profileText?: string | null;
    youtubeChannelUrl?: string | null;
    socialLinks?: string | null;
    allowProfileUpdate?: boolean;
    actorUserId: string;
  },
): Promise<VideoAtomicWritePlan> {
  if (!args.xId || args.allowProfileUpdate === false) {
    return emptyVideoAtomicWritePlan();
  }
  const now = Math.floor(Date.now() / 1000);
  const hasSocialLinksInput = args.socialLinks != null;
  const socialLinks = hasSocialLinksInput
    ? normalizeSocialLinksForStorage(args.socialLinks)
    : null;
  const existing = (
    await db.select().from(xUsers).where(eq(xUsers.id, args.xId)).limit(1)
  )[0];

  if (!existing) {
    const after: typeof xUsers.$inferSelect = {
      id: args.xId,
      x_name: args.displayName || `@${args.xId}`,
      icon_url: null,
      profile_text: args.profileText || null,
      portfolio_contact: null,
      youtube_channel_url: args.youtubeChannelUrl || null,
      other_social_links: socialLinks,
      creative_start_date: null,
      linked_user_id: null,
      verification_token: null,
      token_expires_at: null,
      approval_status: "pending",
      approval_requested_at: now,
    };
    return {
      statements: [db.insert(xUsers).values(after)],
      expectedChanges: [1],
      audits: [{
        table_name: "x_users",
        target_id: after.id,
        operation: "CREATE",
        before: null,
        after: { ...after },
        actor_user_id: args.actorUserId,
        context: "video-save:profile",
        retention_class: "normal",
        strict: true,
      }],
    };
  }

  const after: typeof xUsers.$inferSelect = {
    ...existing,
    x_name: args.displayName || existing.x_name,
    profile_text: args.profileText ?? existing.profile_text,
    youtube_channel_url:
      args.youtubeChannelUrl ?? existing.youtube_channel_url,
    other_social_links: hasSocialLinksInput
      ? socialLinks
      : existing.other_social_links,
  };
  return {
    statements: [
      db
        .update(xUsers)
        .set({
          x_name: after.x_name,
          profile_text: after.profile_text,
          youtube_channel_url: after.youtube_channel_url,
          other_social_links: after.other_social_links,
        })
        .where(and(
          eq(xUsers.id, existing.id),
          expectedRowCondition({ expectedCurrent: existing }),
        )!),
    ],
    expectedChanges: [1],
    audits: [{
      table_name: "x_users",
      target_id: existing.id,
      operation: "UPDATE",
      before: { ...existing },
      after: { ...after },
      actor_user_id: args.actorUserId,
      context: "video-save:profile",
      retention_class: "normal",
      strict: true,
    }],
  };
}
