import {
  CloudflareBindingsUnavailableError,
  getDatabase,
} from "@/lib/cloudflare";
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
  EVENT_EXPORT_REFRESH_MINUTES,
  eventExportPayloadCacheKey,
  getEventExportKv,
  isEventExportRefreshMinutes,
  type EventExportRefreshMinutes,
} from "@/lib/api/eventExportCache";
import {
  checkPublicApiRateLimit,
  publicJsonBodyResponse,
  publicJsonResponse,
} from "@/lib/api/publicApi";
import { assertNoForbiddenKeys } from "@/lib/api/publicDto";

const NOT_FOUND_CACHE_CONTROL = "public, max-age=60";

function parseFormat(value: string | null): EventExportFormat | null {
  if (value == null || value === "" || value === "v5") return "v5";
  if (value === "legacy") return "legacy";
  return null;
}

function parseUpdateMode(value: string | null): EventExportUpdateMode | null {
  if (value === "realtime") return "realtime";
  if (value === "scheduled") return "scheduled";
  return null;
}

function parseRefreshMinutes(
  value: string | null,
): EventExportRefreshMinutes | null {
  if (value == null || value === "") return 60;
  const parsed = Number(value);
  return Number.isInteger(parsed) && isEventExportRefreshMinutes(parsed)
    ? parsed
    : null;
}

function decodePathSegment(raw: string | undefined): string | null {
  try {
    return decodeURIComponent(raw ?? "").trim();
  } catch {
    return null;
  }
}

function isPublicExportEvent(event: EventExportEventRow | null): boolean {
  return (
    !!event &&
    event.public_api_enabled === 1 &&
    event.visibility_status === "public"
  );
}

function notFoundResponse(req: Request): Promise<Response> {
  return publicJsonResponse(
    req,
    { error: "not_found" },
    NOT_FOUND_CACHE_CONTROL,
    404,
  );
}

async function exportResponse(
  req: Request,
  body: string,
  format: EventExportFormat,
  updateMode: EventExportUpdateMode,
  refreshMinutes: EventExportRefreshMinutes,
  cacheState: "HIT" | "MISS" | "BYPASS",
): Promise<Response> {
  const cacheControl =
    updateMode === "realtime"
      ? "no-store"
      : "public, max-age=60, s-maxage=60, stale-while-revalidate=60";
  const response = await publicJsonBodyResponse(req, body, cacheControl);
  response.headers.set(
    "X-FlameNode-Schema-Version",
    format === "legacy" ? "1" : "5",
  );
  response.headers.set(
    "X-FlameNode-Format",
    format === "legacy" ? "legacy" : "flamenode-event-export",
  );
  response.headers.set("X-FlameNode-Update-Mode", updateMode);
  response.headers.set("X-FlameNode-Refresh-Minutes", String(refreshMinutes));
  response.headers.set("X-FlameNode-Cache", cacheState);
  return response;
}

async function readCachedPayload(
  kv: KVNamespace,
  cacheKey: string,
  eventId: string,
  format: EventExportFormat,
  cacheTtlSeconds: number,
): Promise<string | null> {
  let cached: string | null;
  try {
    cached = await kv.get(cacheKey, { cacheTtl: cacheTtlSeconds });
  } catch (error) {
    console.warn("[event-export-api] KV payload read failed", {
      eventId,
      cacheKey,
      format,
      error,
    });
    return null;
  }
  if (!cached) return null;
  try {
    const parsed = JSON.parse(cached) as unknown;
    if (format === "legacy") {
      if (!Array.isArray(parsed)) throw new Error("stale_legacy_schema");
    } else {
      if (
        !parsed ||
        typeof parsed !== "object" ||
        (parsed as { schema_version?: unknown }).schema_version !== 5
      ) {
        throw new Error("stale_schema");
      }
    }
    return cached;
  } catch (error) {
    console.warn("[event-export-api] invalid KV payload evicted", {
      eventId,
      cacheKey,
      format,
      error,
    });
    try {
      await kv.delete(cacheKey);
    } catch {
      // D1からの再生成を優先する。
    }
    return null;
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const limited = checkPublicApiRateLimit(req, "/api/event-endpoints/:id");
  if (limited) return limited;

  const { id } = await params;
  const eventId = decodePathSegment(id);
  if (!eventId) return notFoundResponse(req);

  const url = new URL(req.url);
  const format = parseFormat(url.searchParams.get("format"));
  if (!format) {
    return publicJsonResponse(
      req,
      {
        error: "invalid_format",
        allowed: ["v5", "legacy"],
      },
      "no-store",
      400,
    );
  }

  const updateMode = parseUpdateMode(
    url.searchParams.get("update") ?? "realtime",
  );
  const refreshMinutes = parseRefreshMinutes(url.searchParams.get("refresh"));
  if (!updateMode || refreshMinutes == null) {
    return publicJsonResponse(
      req,
      {
        error: "invalid_export_options",
        allowed: {
          format: ["v5", "legacy"],
          update: ["realtime", "scheduled"],
          refresh: EVENT_EXPORT_REFRESH_MINUTES,
        },
      },
      "no-store",
      400,
    );
  }

  let db: ReturnType<typeof getDatabase>;
  let kv: KVNamespace | null;
  try {
    db = getDatabase();
    kv = updateMode === "scheduled" ? getEventExportKv() : null;
  } catch (error) {
    if (!(error instanceof CloudflareBindingsUnavailableError)) throw error;
    console.error("[event-export-api] runtime bindings unavailable", {
      eventId,
      missing: error.missing,
    });
    return publicJsonResponse(
      req,
      { error: "runtime_bindings_unavailable" },
      "no-store",
      503,
    );
  }
  if (!db) {
    return publicJsonResponse(
      req,
      { error: "db_unavailable" },
      "no-store",
      503,
    );
  }

  const payloadCacheKey = eventExportPayloadCacheKey(
    eventId,
    format,
    refreshMinutes,
  );
  const cachedResponse = async (): Promise<Response | null> => {
    if (!kv) return null;
    const cached = await readCachedPayload(
      kv,
      payloadCacheKey,
      eventId,
      format,
      refreshMinutes * 60,
    );
    return cached === null
      ? null
      : exportResponse(
          req,
          cached,
          format,
          updateMode,
          refreshMinutes,
          "HIT",
        );
  };

  // KVのpositive cacheを公開認可の正本にしない。payload HIT前にも必ずD1を確認する。
  let prefetchedEvent: EventExportEventRow | null;
  try {
    prefetchedEvent = await loadEventExportEvent(db, eventId);
  } catch (error) {
    console.error("[event-export-api] event lookup failed", {
      eventId,
      error,
    });
    return publicJsonResponse(
      req,
      { error: "database_unavailable" },
      "no-store",
      503,
    );
  }
  const allowed = isPublicExportEvent(prefetchedEvent);
  if (!allowed) {
    return notFoundResponse(req);
  }

  if (kv) {
    const response = await cachedResponse();
    if (response) return response;
  }

  const generatedAt = Math.floor(Date.now() / 1000);
  let snapshot: Awaited<ReturnType<typeof loadEventExportSnapshot>>;
  try {
    snapshot = await loadEventExportSnapshot(
      db,
      eventId,
      prefetchedEvent,
    );
  } catch (error) {
    console.error("[event-export-api] snapshot query failed", {
      eventId,
      error,
    });
    return publicJsonResponse(
      req,
      { error: "database_unavailable" },
      "no-store",
      503,
    );
  }
  let body: string | null = null;
  if (snapshot) {
    const payload = buildEventExportPayloadForFormat(
      snapshot,
      format,
      generatedAt,
      updateMode,
    );
    try {
      assertNoForbiddenKeys(payload);
    } catch (error) {
      console.error("[event-export-api] public payload boundary failed", {
        eventId,
        format,
        error,
      });
      return publicJsonResponse(
        req,
        { error: "public_payload_unavailable" },
        "no-store",
        503,
      );
    }
    body = JSON.stringify(payload);
  }

  if (body === null) {
    return notFoundResponse(req);
  }

  if (kv) {
    const writes = await Promise.allSettled([
      kv.put(payloadCacheKey, body, {
        expirationTtl: refreshMinutes * 60,
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
    body,
    format,
    updateMode,
    refreshMinutes,
    updateMode === "scheduled" ? "MISS" : "BYPASS",
  );
}
