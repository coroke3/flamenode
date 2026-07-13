export const runtime = "edge";

import { getDatabase } from "@/lib/cloudflare";
import {
  loadEventExportEvent,
  loadEventExportSnapshot,
  type EventExportEventRow,
} from "@/lib/api/eventExportData";
import {
  buildEventExportPayloadForFormat,
  type EventExportFormat,
  type EventExportUpdateMode,
} from "@/lib/api/eventExportPayload";
import {
  EVENT_EXPORT_ACCESS_TTL_SECONDS,
  eventExportAccessCacheKey,
  eventExportPayloadCacheKey,
  getEventExportKv,
  isEventExportRefreshMinutes,
  type EventExportRefreshMinutes,
} from "@/lib/api/eventExportCache";
import { checkPublicApiRateLimit, publicJsonResponse } from "@/lib/api/publicApi";

const inFlightExports = new Map<string, Promise<unknown | null>>();

function parseFormat(value: string | null): EventExportFormat | null {
  if (value == null || value === "" || value === "new" || value === "v2" || value === "v3") {
    return "new";
  }
  if (value === "legacy" || value === "old" || value === "v1") {
    return "legacy";
  }
  return null;
}

function parseUpdateMode(value: string | null): EventExportUpdateMode | null {
  if (value === "realtime") return "realtime";
  if (value === "scheduled" || value === "economy") return "scheduled";
  return null;
}

function parseRefreshMinutes(value: string | null): EventExportRefreshMinutes | null {
  if (value == null || value === "") return 60;
  const parsed = Number(value);
  return Number.isInteger(parsed) && isEventExportRefreshMinutes(parsed)
    ? parsed
    : null;
}

function isPublicExportEvent(event: EventExportEventRow | null): boolean {
  return (
    !!event &&
    event.public_api_enabled === 1 &&
    event.visibility_status === "public"
  );
}

async function exportResponse(
  req: Request,
  payload: unknown,
  format: EventExportFormat,
  updateMode: EventExportUpdateMode,
  refreshMinutes: EventExportRefreshMinutes,
  cacheState: "HIT" | "MISS" | "BYPASS",
): Promise<Response> {
  const cacheControl =
    updateMode === "realtime"
      ? "no-store"
      : "public, max-age=60, s-maxage=60, stale-while-revalidate=60";
  const response = await publicJsonResponse(req, payload, cacheControl);
  response.headers.set(
    "X-FlameNode-Schema-Version",
    format === "legacy" ? "1" : "3",
  );
  response.headers.set("X-FlameNode-Format", format);
  response.headers.set("X-FlameNode-Update-Mode", updateMode);
  response.headers.set("X-FlameNode-Refresh-Minutes", String(refreshMinutes));
  response.headers.set("X-FlameNode-Cache", cacheState);
  return response;
}

async function readCachedPayload(
  kv: KVNamespace,
  cacheKey: string,
  eventId: string,
): Promise<unknown | null> {
  try {
    const cached = await kv.get(cacheKey);
    if (!cached) return null;
    return JSON.parse(cached) as unknown;
  } catch (error) {
    console.warn("[event-export-api] KV payload read failed", {
      eventId,
      cacheKey,
      error,
    });
    try {
      await kv.delete(cacheKey);
    } catch {
      // 壊れたキャッシュ削除の失敗はD1フォールバックを妨げない。
    }
    return null;
  }
}

async function buildPayloadOnce(
  key: string,
  factory: () => Promise<unknown | null>,
): Promise<unknown | null> {
  const current = inFlightExports.get(key);
  if (current) return current;

  const promise = factory();
  inFlightExports.set(key, promise);
  try {
    return await promise;
  } finally {
    if (inFlightExports.get(key) === promise) {
      inFlightExports.delete(key);
    }
  }
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
  const format = parseFormat(url.searchParams.get("format"));
  if (!format) {
    return publicJsonResponse(
      req,
      {
        error: "invalid_format",
        allowed: ["new", "legacy"],
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
          format: ["new", "legacy"],
          update: ["realtime", "scheduled"],
          refresh: [15, 60, 360, 1440],
        },
      },
      "no-store",
      400,
    );
  }

  const kv = updateMode === "scheduled" ? getEventExportKv() : null;
  const accessKey = eventExportAccessCacheKey(eventId);
  const payloadCacheKey = eventExportPayloadCacheKey(
    eventId,
    format,
    refreshMinutes,
  );
  let accessState: string | null = null;
  let prefetchedEvent: EventExportEventRow | null | undefined;

  if (kv) {
    try {
      accessState = await kv.get(accessKey);
    } catch (error) {
      console.warn("[event-export-api] KV access gate read failed", {
        eventId,
        error,
      });
    }

    if (accessState === "0") {
      return publicJsonResponse(req, { error: "not_found" }, "public, max-age=60", 404);
    }

    if (accessState === "1") {
      const cached = await readCachedPayload(kv, payloadCacheKey, eventId);
      if (cached !== null) {
        return exportResponse(
          req,
          cached,
          format,
          updateMode,
          refreshMinutes,
          "HIT",
        );
      }
    }
  }

  const db = getDatabase();
  if (!db) {
    return publicJsonResponse(req, { error: "db_unavailable" }, "no-store", 503);
  }

  if (kv && accessState !== "1") {
    prefetchedEvent = await loadEventExportEvent(db, eventId);
    const allowed = isPublicExportEvent(prefetchedEvent);
    try {
      await kv.put(accessKey, allowed ? "1" : "0", {
        expirationTtl: EVENT_EXPORT_ACCESS_TTL_SECONDS,
      });
    } catch (error) {
      console.warn("[event-export-api] KV access gate write failed", {
        eventId,
        error,
      });
    }
    if (!allowed) {
      return publicJsonResponse(req, { error: "not_found" }, "public, max-age=60", 404);
    }

    const cached = await readCachedPayload(kv, payloadCacheKey, eventId);
    if (cached !== null) {
      return exportResponse(
        req,
        cached,
        format,
        updateMode,
        refreshMinutes,
        "HIT",
      );
    }
  }

  const generatedAt = Math.floor(Date.now() / 1000);
  const payload = await buildPayloadOnce(
    [eventId, format, updateMode].join(":"),
    async () => {
      const snapshot = await loadEventExportSnapshot(db, eventId, prefetchedEvent);
      return snapshot
        ? buildEventExportPayloadForFormat(
            snapshot,
            format,
            generatedAt,
            updateMode,
          )
        : null;
    },
  );

  if (payload === null) {
    if (kv) {
      try {
        await kv.put(accessKey, "0", {
          expirationTtl: EVENT_EXPORT_ACCESS_TTL_SECONDS,
        });
      } catch {
        // 404応答を優先する。
      }
    }
    return publicJsonResponse(req, { error: "not_found" }, "public, max-age=60", 404);
  }

  if (kv) {
    const writes = await Promise.allSettled([
      kv.put(payloadCacheKey, JSON.stringify(payload), {
        expirationTtl: refreshMinutes * 60,
      }),
      kv.put(accessKey, "1", {
        expirationTtl: EVENT_EXPORT_ACCESS_TTL_SECONDS,
      }),
    ]);
    if (writes.some((result) => result.status === "rejected")) {
      console.warn("[event-export-api] KV write partially failed", {
        eventId,
        format,
        refreshMinutes,
      });
    }
  }

  return exportResponse(
    req,
    payload,
    format,
    updateMode,
    refreshMinutes,
    updateMode === "scheduled" ? "MISS" : "BYPASS",
  );
}
