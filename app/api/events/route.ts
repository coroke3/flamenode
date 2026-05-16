import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { events as eventsTable } from "@/lib/db/schema";
import { getDatabase } from "@/lib/cloudflare";
import {
  MAX_PUBLIC_EVENT_LIMIT,
  PUBLIC_EVENT_KEYS,
  PublicEventDto,
  pickKeys,
} from "@/lib/api/publicDto";

/** イベント一覧 JSON。 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(
    MAX_PUBLIC_EVENT_LIMIT,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "60", 10) || 60),
  );

  const db = getDatabase();
  if (!db) return NextResponse.json({ items: [], page, limit });

  const rows = await db
    .select({
      id: eventsTable.id,
      title: eventsTable.title,
      event_type: eventsTable.event_type,
      explanation: eventsTable.explanation,
      icon_url: eventsTable.icon_url,
      img_url: eventsTable.img_url,
      accent_color: eventsTable.accent_color,
      is_active: eventsTable.is_active,
      is_entry_open: eventsTable.is_entry_open,
      is_archived: eventsTable.is_archived,
      event_group_id: eventsTable.event_group_id,
      slot_type: eventsTable.slot_type,
      slot_visibility_mode: eventsTable.slot_visibility_mode,
      start_time: eventsTable.start_time,
      end_time: eventsTable.end_time,
      max_slots_per_video: eventsTable.max_slots_per_video,
      max_consecutive_slots_per_entry: eventsTable.max_consecutive_slots_per_entry,
    })
    .from(eventsTable)
    .orderBy(desc(eventsTable.start_time))
    .limit(limit)
    .offset((page - 1) * limit);

  // DB 側で明示列を絞り込んでいるが、二重防御として pickKeys も通す。
  const items: PublicEventDto[] = rows.map((row) =>
    pickKeys(row, PUBLIC_EVENT_KEYS) as PublicEventDto,
  );

  return NextResponse.json(
    { items, page, limit },
    {
      headers: {
        "Cache-Control":
          "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
      },
    },
  );
}
