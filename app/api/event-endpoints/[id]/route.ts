export const runtime = "edge";

import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  videoEvents as videoEventsTable,
  videos as videosTable,
} from "@/lib/db/schema";
import {
  buildEventApiPayload,
  EVENT_API_VIDEO_LIMIT,
} from "@/lib/api/eventEndpointPayload";
import { isPublicEventVisible } from "@/lib/utils/eventStatus";
import { checkPublicApiRateLimit, publicJsonResponse } from "@/lib/api/publicApi";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const limited = checkPublicApiRateLimit(req, "/api/event-endpoints/:id");
  if (limited) return limited;
  const { id } = await params;
  const eventId = id.trim();
  if (!eventId) {
    return publicJsonResponse(req, { error: "not_found" }, "public, max-age=60", 404);
  }

  const db = getDatabase();
  if (!db) {
    return publicJsonResponse(req, { error: "db_unavailable" }, "no-store", 503);
  }

  const event = (
    await db
      .select({
        id: eventsTable.id,
        title: eventsTable.title,
        explanation: eventsTable.explanation,
        visibility_status: eventsTable.visibility_status,
        public_api_enabled: eventsTable.public_api_enabled,
        start_time: eventsTable.start_time,
        end_time: eventsTable.end_time,
        entry_start_time: eventsTable.entry_start_time,
        entry_end_time: eventsTable.entry_end_time,
      })
      .from(eventsTable)
      .where(eq(eventsTable.id, eventId))
      .limit(1)
  )[0];

  if (!event || event.public_api_enabled !== 1 || !isPublicEventVisible(event)) {
    return publicJsonResponse(req, { error: "not_found" }, "public, max-age=60", 404);
  }

  const videoRows = await db
    .select({
      id: videosTable.id,
      title: videosTable.title,
      scheduled_time: videosTable.scheduled_time,
      creator_display_name: videosTable.creator_display_name,
      youtube_video_id: videosTable.youtube_video_id,
    })
    .from(videoEventsTable)
    .innerJoin(videosTable, eq(videosTable.id, videoEventsTable.video_id))
    .where(
      and(
        eq(videoEventsTable.event_id, event.id),
        eq(videosTable.visibility_status, "public"),
      ),
    )
    .orderBy(desc(videosTable.scheduled_time))
    .limit(EVENT_API_VIDEO_LIMIT);

  const payload = buildEventApiPayload(event, videoRows);

  return publicJsonResponse(req, payload, "public, max-age=300, s-maxage=600, stale-while-revalidate=600");
}
