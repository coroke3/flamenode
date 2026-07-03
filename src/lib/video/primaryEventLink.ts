import { eq } from "drizzle-orm";
import type { getDatabase } from "@/lib/cloudflare";
import { videoEvents } from "@/lib/db/schema";

type DB = NonNullable<ReturnType<typeof getDatabase>>;

/** primary_event_id がある作品は video_events に必ず含める。 */
export async function ensurePrimaryEventInVideoEvents(
  db: DB,
  videoId: string,
  primaryEventId: string | null | undefined,
): Promise<void> {
  const eventId = primaryEventId?.trim();
  if (!eventId) return;
  await db
    .insert(videoEvents)
    .values({ video_id: videoId, event_id: eventId })
    .onConflictDoNothing();
}
