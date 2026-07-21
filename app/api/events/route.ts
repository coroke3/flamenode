
import { desc } from "drizzle-orm";
import { events as eventsTable } from "@/lib/db/schema";
import { getDatabase } from "@/lib/cloudflare";
import { publicListableEventWhere } from "@/lib/utils/eventStatus";
import {
  MAX_PUBLIC_EVENT_LIMIT,
  PUBLIC_EVENT_KEYS,
  type PublicEventDto,
  assertNoForbiddenKeys,
  pickKeys,
} from "@/lib/api/publicDto";
import { loadStaticEventsIndex } from "@/lib/publicData/loader";
import {
  checkPublicApiRateLimit,
  parseBoundedPositiveInt,
  publicJsonResponse,
  publicServiceUnavailableResponse,
} from "@/lib/api/publicApi";

/** 明示DTOだけを返すイベント一覧 JSON。 */
export async function GET(req: Request): Promise<Response> {
  const limited = checkPublicApiRateLimit(req, "/api/events");
  if (limited) return limited;
  const url = new URL(req.url);
  const page = parseBoundedPositiveInt(url.searchParams.get("page"), 1);
  const limit = parseBoundedPositiveInt(
    url.searchParams.get("limit"),
    60,
    MAX_PUBLIC_EVENT_LIMIT,
  );

  const staticIndex = await loadStaticEventsIndex();
  if (staticIndex.strategy === "static_json_only" && staticIndex.index) {
    const offset = (page - 1) * limit;
    const items: PublicEventDto[] = staticIndex.index.events
      .slice(offset, offset + limit)
      .map((row) => pickKeys(row, PUBLIC_EVENT_KEYS) as PublicEventDto);
    const payload = { items, page, limit };
    assertNoForbiddenKeys(payload);
    return publicJsonResponse(
      req,
      payload,
      "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
    );
  }

  const db = getDatabase();
  if (!db) return publicServiceUnavailableResponse("database_unavailable");

  const rows = await db
    .select({
      id: eventsTable.id,
      title: eventsTable.title,
      event_type: eventsTable.event_type,
      explanation: eventsTable.explanation,
      icon_url: eventsTable.icon_url,
      img_url: eventsTable.img_url,
      accent_color: eventsTable.accent_color,
      visibility_status: eventsTable.visibility_status,
      entry_start_time: eventsTable.entry_start_time,
      entry_end_time: eventsTable.entry_end_time,
      slot_type: eventsTable.slot_type,
      slot_visibility_mode: eventsTable.slot_visibility_mode,
      start_time: eventsTable.start_time,
      end_time: eventsTable.end_time,
      max_slots_per_video: eventsTable.max_slots_per_video,
    })
    .from(eventsTable)
    .where(publicListableEventWhere())
    .orderBy(desc(eventsTable.start_time), desc(eventsTable.created_at))
    .limit(limit)
    .offset((page - 1) * limit);

  const items: PublicEventDto[] = rows.map(
    (row) => pickKeys(row, PUBLIC_EVENT_KEYS) as PublicEventDto,
  );
  const payload = { items, page, limit };
  assertNoForbiddenKeys(payload);
  return publicJsonResponse(
    req,
    payload,
    "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
  );
}
