export const runtime = "edge";

import { eq } from "drizzle-orm";
import { getDatabase, getEnv } from "@/lib/cloudflare";
import { events as eventsTable } from "@/lib/db/schema";
import { loadEventExportSnapshot } from "@/lib/api/eventExportData";
import {
  buildEventExportPayload,
  type EventExportUpdateMode,
} from "@/lib/api/eventExportPayload";
import { checkPublicApiRateLimit, publicJsonResponse } from "@/lib/api/publicApi";

const SCHEDULED_REFRESH_MINUTES = new Set([15, 60, 360, 1440]);
const EXPORT_CACHE_VERSION = 3;

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
  response.headers.set("X-FlameNode-Schema-Version", "3");
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

  const url = new URL(req.url);
  const formatParam = url.searchParams.get("format");
  if (formatParam === "legacy") {
    return publicJsonResponse(
      req,
      {
        error: "legacy_format_removed",
        schema_version: 3,
        replacement: `/api/event-endpoints/${encodeURIComponent(eventId)}`,
      },
      "public, max-age=3600",
      410,
    );
  }
  if (
    formatParam !== null &&
    formatParam !== "new" &&
    formatParam !== "v2" &&
    formatParam !== "v3"
  ) {
    return publicJsonResponse(
      req,
      {
        error: "invalid_format",
        allowed: ["v3"],
      },
      "no-store",
      400,
    );
  }

  const updateMode = parseUpdateMode(url.searchParams.get("update") ?? "realtime");
  const refreshMinutes = parseRefreshMinutes(url.searchParams.get("refresh"));
  if (!updateMode || refreshMinutes == null) {
    return publicJsonResponse(
      req,
      {
        error: "invalid_export_options",
        allowed: {
          update: ["realtime", "scheduled"],
          refresh: [15, 60, 360, 1440],
        },
      },
      "no-store",
      400,
    );
  }

  const db = getDatabase();
  if (!db) {
    return publicJsonResponse(req, { error: "db_unavailable" }, "no-store", 503);
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
  const payload = buildEventExportPayload(snapshot, generatedAt, updateMode);

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
