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
  isEventExportRefreshMinutes,
  type EventExportRefreshMinutes,
} from "@/lib/api/eventExportCache";
import {
  isolateMicroCacheGet,
  isolateMicroCacheSet,
} from "@/lib/api/isolateMicroCache";
import {
  checkPublicApiRateLimit,
  publicJsonBodyResponse,
  publicJsonResponse,
} from "@/lib/api/publicApi";
import { assertNoForbiddenKeys } from "@/lib/api/publicDto";
import {
  coercePublicJsonCacheEnvelope,
  deletePublicJsonCaches,
  readPublicJsonCache,
  writePublicJsonCacheBestEffort,
} from "@/lib/publicData/publicCache";
import { safeErrorSummary } from "../../../../workers/shared/safeLog.ts";

function safeEventExportErrorSummary(error: unknown): string {
  return safeErrorSummary(error)
    .replace(/https?:\/\/\S+/gi, "[REDACTED_URL]")
    .replace(
      /\b(?:select|insert|update|delete|pragma|from|where)\b[\s\S]*/gi,
      "[REDACTED_SQL]",
    );
}

const NOT_FOUND_CACHE_CONTROL = "public, max-age=60";
const EVENT_EXPORT_CACHE_METADATA_MARKER = "public-export-validated-v1";

type EventExportCacheMetadata = {
  marker: typeof EVENT_EXPORT_CACHE_METADATA_MARKER;
  format: EventExportFormat;
  schema_version: 1 | 5;
};

function cacheMetadataForFormat(
  format: EventExportFormat,
): EventExportCacheMetadata {
  return {
    marker: EVENT_EXPORT_CACHE_METADATA_MARKER,
    format,
    schema_version: format === "legacy" ? 1 : 5,
  };
}

function isTrustedCacheMetadata(
  metadata: unknown,
  format: EventExportFormat,
): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  const value = metadata as Partial<EventExportCacheMetadata>;
  return (
    value.marker === EVENT_EXPORT_CACHE_METADATA_MARKER &&
    value.format === format &&
    value.schema_version === (format === "legacy" ? 1 : 5)
  );
}

function parseFormat(value: string | null): EventExportFormat | null {
  if (value == null || value === "" || value === "v5" || value === "new") {
    return "v5";
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

type EventExportCachedPayload = {
  body: string;
  metadata?: unknown;
};

function isEventExportCachedPayload(
  value: unknown,
): value is EventExportCachedPayload {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { body?: unknown }).body === "string"
  );
}

/**
 * scheduled snapshot は colo ごとの Cache API（KV write なし）から読む。
 * isolate 層は bypass し、`stored_at` が refresh 窓を超えた entry は miss にする。
 */
async function readCachedPayload(
  cacheKey: string,
  eventId: string,
  format: EventExportFormat,
  cacheTtlSeconds: number,
): Promise<string | null> {
  const envelope = coercePublicJsonCacheEnvelope(
    await readPublicJsonCache<unknown>(cacheKey, { bypassIsolate: true }),
    0,
    { requireStoredAt: true },
  );
  if (!envelope || !isEventExportCachedPayload(envelope.payload)) return null;

  const ageSeconds = Math.floor(Date.now() / 1000) - envelope.stored_at;
  if (ageSeconds < 0 || ageSeconds >= cacheTtlSeconds) return null;

  const cached = envelope.payload.body;
  const metadata = envelope.payload.metadata;
  if (!cached) return null;

  // New cache entries are validated before write and carry an immutable format
  // marker in the envelope. Avoid JSON.parse + recursive leak scanning on every
  // hot cache hit; entries without the marker still take the safe fallback.
  if (isTrustedCacheMetadata(metadata, format)) return cached;

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
    // Old/manual cache entries have no trusted metadata. Validate them fully
    // before returning so a stale key can never bypass the public DTO fence.
    assertNoForbiddenKeys(parsed);
    return cached;
  } catch (error) {
    console.warn("[event-export-api] invalid cached payload evicted", {
      eventId,
      cacheKey,
      format,
      error: safeEventExportErrorSummary(error),
    });
    // D1からの再生成を優先する（deletePublicJsonCaches は失敗を握りつぶす）。
    await deletePublicJsonCaches([cacheKey]);
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
  try {
    db = getDatabase();
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
  const usePayloadCache = updateMode === "scheduled";
  const cachedResponse = async (): Promise<Response | null> => {
    if (!usePayloadCache) return null;
    const cached = await readCachedPayload(
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

  // Cache APIのpositive cacheを公開認可の正本にしない。payload HIT前にも必ずD1を確認する。
  let prefetchedEvent: EventExportEventRow | null;
  try {
    prefetchedEvent = await loadEventExportEvent(db, eventId);
  } catch (error) {
    console.error("[event-export-api] event lookup failed", {
      eventId,
      error: safeEventExportErrorSummary(error),
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

  if (usePayloadCache) {
    const response = await cachedResponse();
    if (response) return response;
  }

  // realtimeはD1公開判定を毎request行った後に限り、同一isolate内の5秒間だけ
  // 直前に組み立て済みのbody(string)を再利用する。Cache-Control/BYPASSは不変。
  const microCacheKey =
    updateMode === "realtime"
      ? `export:${eventId}:${format}:${prefetchedEvent?.updated_at ?? ""}`
      : null;
  if (microCacheKey) {
    const coalesced = isolateMicroCacheGet(microCacheKey);
    if (coalesced !== null) {
      return exportResponse(
        req,
        coalesced,
        format,
        updateMode,
        refreshMinutes,
        "BYPASS",
      );
    }
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
      error: safeEventExportErrorSummary(error),
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
        error: safeEventExportErrorSummary(error),
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

  if (usePayloadCache) {
    // best-effort（waitUntil）。失敗しても応答は D1 由来の body を返す。KV は使わない。
    const cachedPayload: EventExportCachedPayload = {
      body,
      metadata: cacheMetadataForFormat(format),
    };
    writePublicJsonCacheBestEffort(
      payloadCacheKey,
      { payload: cachedPayload, stored_at: generatedAt },
      refreshMinutes * 60,
      { bypassIsolate: true },
    );
  }

  if (microCacheKey) isolateMicroCacheSet(microCacheKey, body);

  return exportResponse(
    req,
    body,
    format,
    updateMode,
    refreshMinutes,
    updateMode === "scheduled" ? "MISS" : "BYPASS",
  );
}
