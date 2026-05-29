import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  apiEndpoints,
  events as eventsTable,
  videoEvents as videoEventsTable,
  videos as videosTable,
} from "@/lib/db/schema";
import {
  buildEventApiPayload,
  EVENT_API_VIDEO_LIMIT,
} from "@/lib/api/eventEndpointPayload";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const endpointId = id.trim();
  if (!endpointId) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const db = getDatabase();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const endpoint = (
    await db
      .select({
        id: apiEndpoints.id,
        event_id: apiEndpoints.event_id,
        is_active: apiEndpoints.is_active,
        event_title: eventsTable.title,
        explanation: eventsTable.explanation,
        is_event_active: eventsTable.is_active,
        is_entry_open: eventsTable.is_entry_open,
        is_archived: eventsTable.is_archived,
      })
      .from(apiEndpoints)
      .leftJoin(eventsTable, eq(eventsTable.id, apiEndpoints.event_id))
      .where(eq(apiEndpoints.id, endpointId))
      .limit(1)
  )[0];

  if (!endpoint || endpoint.is_active !== 1 || !endpoint.event_title) {
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
        eq(videoEventsTable.event_id, endpoint.event_id),
        eq(videosTable.visibility_status, "public"),
      ),
    )
    .orderBy(desc(videosTable.scheduled_time))
    .limit(EVENT_API_VIDEO_LIMIT);

  const payload = buildEventApiPayload(
    {
      id: endpoint.event_id,
      title: endpoint.event_title,
      explanation: endpoint.explanation,
      is_active: endpoint.is_event_active,
      is_entry_open: endpoint.is_entry_open,
      is_archived: endpoint.is_archived,
    },
    videoRows,
  );

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=600, stale-while-revalidate=600",
    },
  });
}
