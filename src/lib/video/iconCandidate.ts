import { and, eq } from "drizzle-orm";
import { xUserIcons } from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { generateId } from "@/lib/utils/id";
import {
  emptyVideoAtomicWritePlan,
  type VideoAtomicWritePlan,
} from "@/lib/video/atomicWritePlan";

export async function buildXIconCandidatePlan(
  db: DB,
  args: {
    xUserId: string;
    iconUrl: string | null | undefined;
    videoId: string;
    actorUserId: string;
  },
): Promise<VideoAtomicWritePlan> {
  if (!args.xUserId || !args.iconUrl) return emptyVideoAtomicWritePlan();
  const existing = (
    await db
      .select({ id: xUserIcons.id })
      .from(xUserIcons)
      .where(and(
        eq(xUserIcons.x_user_id, args.xUserId),
        eq(xUserIcons.icon_url, args.iconUrl),
      )!)
      .limit(1)
  )[0];
  if (existing) return emptyVideoAtomicWritePlan();
  const after: typeof xUserIcons.$inferSelect = {
    id: generateId("xicon"),
    x_user_id: args.xUserId,
    icon_url: args.iconUrl,
    source_video_id: args.videoId,
    source_type: "video",
    created_at: Math.floor(Date.now() / 1000),
  };
  return {
    statements: [db.insert(xUserIcons).values(after)],
    expectedChanges: [1],
    audits: [{
      table_name: "x_user_icons",
      target_id: after.id,
      operation: "CREATE",
      before: null,
      after: { ...after },
      actor_user_id: args.actorUserId,
      context: "video-save:icon-candidate",
      retention_class: "normal",
      strict: true,
    }],
  };
}
