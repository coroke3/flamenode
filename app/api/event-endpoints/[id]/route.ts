import { NextResponse } from "next/server";
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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const eventId = id.trim();
  if (!eventId) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const db = getDatabase();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const event = (
    await db
      .select({
        id: eventsTable.id,
        title: eventsTable.title,
        explanation: eventsTable.explanation,
        visibility_status: eventsTable.visibility_status,
        is_active: eventsTable.is_active,
        is_entry_open: eventsTable.is_entry_open,
        is_archived: eventsTable.is_archived,
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
    return NextResponse.json({ error: "not_found" }, { status: 404 });
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

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=600, stale-while-revalidate=600",
    },
  });
}
