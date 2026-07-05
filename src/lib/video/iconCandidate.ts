import { xUserIcons } from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { generateId } from "@/lib/utils/id";

export async function recordXIconCandidateFromVideo(
  db: DB,
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
