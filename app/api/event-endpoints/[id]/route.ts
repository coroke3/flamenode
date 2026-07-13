export const runtime = "edge";

import { and, desc, eq } from "drizzle-orm";
import { getDatabase, getEnv } from "@/lib/cloudflare";
import {
  events as eventsTable,
  videoEvents as videoEventsTable,
  videos as videosTable,
} from "@/lib/db/schema";
import {
  buildEventApiPayload,
  EVENT_API_VIDEO_LIMIT,
} from "@/lib/api/eventEndpointPayload";
import { loadEventExportSnapshot } from "@/lib/api/eventExportData";
import {
  buildEventExportPayload,
  type EventExportFormat,
  type EventExportUpdateMode,
} from "@/lib/api/eventExportPayload";
import { isPublicEventVisible } from "@/lib/utils/eventStatus";
import { checkPublicApiRateLimit, publicJsonResponse } from "@/lib/api/publicApi";

const SCHEDULED_REFRESH_MINUTES = new Set([15, 60, 360, 1440]);
const EXPORT_CACHE_VERSION = 1;

function parseExportFormat(value: string | null): EventExportFormat | null {
  if (value === "legacy") return "legacy";
  if (value === "new" || value === "v2") return "new";
  return null;
}

function parseUpdateMode(value: string | null): EventExportUpdateMode | null {
  if (value === "realtime") return "realtime";
  if (value === "scheduled" || value === "economy") return "scheduled";
  return null;
}

function parseRefreshMinutes(value: string | null): number | null {
  if (value == null || value === "") return 60;
  const parsed = Number(value);
  return Number.isInteger(parsed) && SCHEDULED_REFRESH_MINUTES.has(parsed)
    ? parsed
    : null;
}

function isKvAvailable(value: unknown): value is KVNamespace {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { get?: unknown }).get === "function" &&
    typeof (value as { put?: unknown }).put === "function"
  );
}

async function exportResponse(
  req: Request,
  payload: unknown,
  updateMode: EventExportUpdateMode,
  refreshMinutes: number,
  cacheState: "HIT" | "MISS" | "BYPASS",
): Promise<Response> {
  const cacheControl =
    updateMode === "realtime"
      ? "no-store"
      : `public, max-age=60, s-maxage=${refreshMinutes * 60}, stale-while-revalidate=${refreshMinutes * 60}`;
  const response = await publicJsonResponse(req, payload, cacheControl);
  response.headers.set("X-FlameNode-Update-Mode", updateMode);
  response.headers.set("X-FlameNode-Cache", cacheState);
  return response;
}

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

  const url = new URL(req.url);
  const formatParam = url.searchParams.get("format");
  const updateParam = url.searchParams.get("update");
  const refreshParam = url.searchParams.get("refresh");
  const explicitExport =
    formatParam !== null || updateParam !== null || refreshParam !== null;

  if (!explicitExport) {
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

    return publicJsonResponse(
      req,
      buildEventApiPayload(event, videoRows),
      "public, max-age=300, s-maxage=600, stale-while-revalidate=600",
    );
  }

  const format = parseExportFormat(formatParam ?? "new");
  const updateMode = parseUpdateMode(updateParam ?? "realtime");
  const refreshMinutes = parseRefreshMinutes(refreshParam);
  if (!format || !updateMode || refreshMinutes == null) {
    return publicJsonResponse(
      req,
      {
        error: "invalid_export_options",
        allowed: {
          format: ["legacy", "new"],
          update: ["realtime", "scheduled"],
          refresh: [15, 60, 360, 1440],
        },
      },
      "no-store",
      400,
    );
  }

  const access = (
    await db
      .select({
        id: eventsTable.id,
        visibility_status: eventsTable.visibility_status,
        public_api_enabled: eventsTable.public_api_enabled,
        public_api_updated_at: eventsTable.public_api_updated_at,
      })
      .from(eventsTable)
      .where(eq(eventsTable.id, eventId))
      .limit(1)
  )[0];

  if (
    !access ||
    access.public_api_enabled !== 1 ||
    access.visibility_status !== "public"
  ) {
    return publicJsonResponse(req, { error: "not_found" }, "public, max-age=60", 404);
  }

  const env = getEnv();
  const cacheKey = [
    "public-event-export",
    EXPORT_CACHE_VERSION,
    eventId,
    access.public_api_updated_at ?? 0,
    format,
    refreshMinutes,
  ].join(":");

  if (updateMode === "scheduled" && isKvAvailable(env.KV)) {
    try {
      const cached = await env.KV.get(cacheKey);
      if (cached) {
        return exportResponse(
          req,
          JSON.parse(cached) as unknown,
          updateMode,
          refreshMinutes,
          "HIT",
        );
      }
    } catch (error) {
      console.warn("[event-export-api] KV read failed", { eventId, error });
    }
  }

  const snapshot = await loadEventExportSnapshot(db, eventId);
  if (!snapshot) {
    return publicJsonResponse(req, { error: "not_found" }, "public, max-age=60", 404);
  }

  const generatedAt = Math.floor(Date.now() / 1000);
  const payload = buildEventExportPayload(
    snapshot,
    format,
    generatedAt,
    updateMode,
  );

  if (updateMode === "scheduled" && isKvAvailable(env.KV)) {
    try {
      await env.KV.put(cacheKey, JSON.stringify(payload), {
        expirationTtl: refreshMinutes * 60,
      });
    } catch (error) {
      console.warn("[event-export-api] KV write failed", { eventId, error });
    }
  }

  return exportResponse(
    req,
    payload,
    updateMode,
    refreshMinutes,
    updateMode === "scheduled" ? "MISS" : "BYPASS",
  );
}
