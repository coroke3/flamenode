import { Hono, type Context } from "hono";
import type { AppEnv } from "../../env.ts";
import { dbMiddleware } from "../../middleware/db.ts";
import { checkPublicApiRateLimit, publicJsonBodyResponse, publicJsonResponse } from "@flamenode/server-core/publicData/publicApi";
import { assertNoForbiddenKeys } from "@flamenode/server-core/publicData/publicDto";
import { loadEventExportEvent, loadEventExportSnapshot, type EventExportEventRow } from "@flamenode/server-core/eventExport/data";
import { buildEventExportPayloadForFormat, type EventExportFormat, type EventExportUpdateMode } from "@flamenode/server-core/eventExport/payload";
import { EVENT_EXPORT_REFRESH_MINUTES, eventExportPayloadCacheKey, isEventExportRefreshMinutes, type EventExportRefreshMinutes } from "@flamenode/server-core/publicCache/eventExportKeys";
import {
  readPublicJsonCache, writePublicJsonCacheBestEffort, deletePublicJsonCacheBestEffort,
  coercePublicJsonCacheEnvelope, type PublicJsonCacheHost,
} from "@flamenode/server-core/publicCache/readWrite";
import { isolateMicroCacheGet, isolateMicroCacheSet } from "../live/microCache.ts";

export const eventExportRoutes = new Hono<AppEnv>();
// No session guard on public GET; the shared host constructs the injected DB handle.
eventExportRoutes.use("*", async (c, next) => {
  if (!c.env.DB) return next();
  return dbMiddleware(c, next);
});
const NOT_FOUND_CACHE_CONTROL = "public, max-age=60";
const EVENT_EXPORT_CACHE_METADATA_MARKER = "public-export-validated-v1";
type EventExportCacheMetadata = {
  marker: typeof EVENT_EXPORT_CACHE_METADATA_MARKER;
  format: EventExportFormat;
  schema_version: 1 | 5;
};
type EventExportCachedPayload = { body: string; metadata?: unknown };

function cacheMetadataForFormat(format: EventExportFormat): EventExportCacheMetadata {
  return { marker: EVENT_EXPORT_CACHE_METADATA_MARKER, format, schema_version: format === "legacy" ? 1 : 5 };
}
function isTrustedCacheMetadata(value: unknown, format: EventExportFormat): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const metadata = value as Partial<EventExportCacheMetadata>;
  return metadata.marker === EVENT_EXPORT_CACHE_METADATA_MARKER &&
    metadata.format === format && metadata.schema_version === (format === "legacy" ? 1 : 5);
}
function parseFormat(value: string | null): EventExportFormat | null {
  if (value == null || value === "" || value === "v5" || value === "new") return "v5";
  if (value === "legacy" || value === "old" || value === "v1") return "legacy";
  return null;
}
function parseUpdateMode(value: string | null): EventExportUpdateMode | null {
  if (value === "realtime") return "realtime";
  if (value === "scheduled" || value === "economy") return "scheduled";
  return null;
}
function parseRefreshMinutes(value: string | null): EventExportRefreshMinutes | null {
  if (value == null || value === "") return 60;
  const n = Number(value);
  return Number.isInteger(n) && isEventExportRefreshMinutes(n) ? n : null;
}
function decodePathSegment(value: string | undefined): string | null {
  try { return decodeURIComponent(value ?? "").trim(); }
  catch { return null; }
}
function isPublicExportEvent(row: EventExportEventRow | null): boolean {
  return !!row && row.public_api_enabled === 1 && row.visibility_status === "public";
}
function cacheHost(c: Context<AppEnv>): PublicJsonCacheHost | null {
  try {
    const cache = (caches as unknown as { default: Cache }).default;
    const ctx = c.executionCtx;
    return { cache, waitUntil: typeof ctx?.waitUntil === "function" ? ctx.waitUntil.bind(ctx) : undefined };
  } catch {
    return null;
  }
}
async function notFound(req: Request): Promise<Response> {
  return publicJsonResponse(req, { error: "not_found" }, NOT_FOUND_CACHE_CONTROL, 404);
}
async function exportResponse(
  req: Request, body: string, format: EventExportFormat, updateMode: EventExportUpdateMode,
  refreshMinutes: EventExportRefreshMinutes, cacheState: "HIT" | "MISS" | "BYPASS",
): Promise<Response> {
  const cacheControl = updateMode === "realtime"
    ? "no-store" : "public, max-age=60, s-maxage=60, stale-while-revalidate=60";
  const response = await publicJsonBodyResponse(req, body, cacheControl);
  response.headers.set("X-FlameNode-Schema-Version", format === "legacy" ? "1" : "5");
  response.headers.set("X-FlameNode-Format", format === "legacy" ? "legacy" : "flamenode-event-export");
  response.headers.set("X-FlameNode-Update-Mode", updateMode);
  response.headers.set("X-FlameNode-Refresh-Minutes", String(refreshMinutes));
  response.headers.set("X-FlameNode-Cache", cacheState);
  return response;
}

/** Cache entry validation is a defense, not an authorization decision. */
async function readCachedPayload(
  cacheKey: string, eventId: string, format: EventExportFormat, ttlSeconds: number,
  host: PublicJsonCacheHost | null,
): Promise<string | null> {
  if (!host) return null;
  const value = await readPublicJsonCache<unknown>(cacheKey, host);
  const envelope = coercePublicJsonCacheEnvelope<EventExportCachedPayload>(value, 0, { requireStoredAt: true });
  if (!envelope || !envelope.payload || typeof envelope.payload !== "object" ||
    typeof envelope.payload.body !== "string") return null;
  const ageSeconds = Math.floor(Date.now() / 1000) - envelope.stored_at;
  if (ageSeconds < 0 || ageSeconds >= ttlSeconds) return null;
  const { body, metadata } = envelope.payload;
  if (!body) return null;
  try {
    // Metadata is only a cache hint. Never trust it in place of body validation.
    // Legacy entries without metadata remain readable after full DTO validation.
    if (metadata != null && !isTrustedCacheMetadata(metadata, format)) {
      throw new Error("stale_cache_metadata");
    }
    const parsed = JSON.parse(body) as unknown;
    if (format === "legacy") {
      if (!Array.isArray(parsed)) throw new Error("stale_legacy_schema");
    } else if (!parsed || typeof parsed !== "object" ||
      (parsed as { schema_version?: unknown }).schema_version !== 5) {
      throw new Error("stale_schema");
    }
    assertNoForbiddenKeys(parsed);
    return body;
  } catch {
    // No sensitive body or cache key in logs.
    console.warn("[event-export-api] invalid cached payload evicted", { eventId, format });
    await deletePublicJsonCacheBestEffort(cacheKey, host);
    return null;
  }
}

eventExportRoutes.get("/:id", async (c) => {
  const req = c.req.raw;
  const limited = checkPublicApiRateLimit(req, "/api/event-endpoints/:id");
  if (limited) return limited;
  const eventId = decodePathSegment(c.req.param("id"));
  if (!eventId) return notFound(req);
  const url = new URL(req.url);
  const format = parseFormat(url.searchParams.get("format"));
  if (!format) {
    return publicJsonResponse(req, { error: "invalid_format", allowed: ["v5", "legacy"] }, "no-store", 400);
  }
  const updateMode = parseUpdateMode(url.searchParams.get("update") ?? "realtime");
  const refreshMinutes = parseRefreshMinutes(url.searchParams.get("refresh"));
  if (!updateMode || refreshMinutes == null) {
    return publicJsonResponse(req, {
      error: "invalid_export_options",
      allowed: { format: ["v5", "legacy"], update: ["realtime", "scheduled"], refresh: EVENT_EXPORT_REFRESH_MINUTES },
    }, "no-store", 400);
  }
  if (!c.env.DB) return publicJsonResponse(req, { error: "db_unavailable" }, "no-store", 503);
  const db = c.get("db");
  const key = eventExportPayloadCacheKey(eventId, format, refreshMinutes);
  const usePayloadCache = updateMode === "scheduled";
  const host = usePayloadCache ? cacheHost(c) : null;

  // Mandatory fresh D1 public-status gate before *either* Cache API or isolate cache.
  let prefetchedEvent: EventExportEventRow | null;
  try { prefetchedEvent = await loadEventExportEvent(db, eventId); }
  catch {
    return publicJsonResponse(req, { error: "database_unavailable" }, "no-store", 503);
  }
  if (!isPublicExportEvent(prefetchedEvent)) return notFound(req);
  if (usePayloadCache) {
    const cached = await readCachedPayload(key, eventId, format, refreshMinutes * 60, host);
    if (cached !== null) return exportResponse(req, cached, format, updateMode, refreshMinutes, "HIT");
  }

  const microCacheKey = updateMode === "realtime"
    ? `export:${eventId}:${format}:${prefetchedEvent?.updated_at ?? ""}` : null;
  if (microCacheKey) {
    const coalesced = isolateMicroCacheGet(microCacheKey);
    if (coalesced !== null) return exportResponse(req, coalesced, format, updateMode, refreshMinutes, "BYPASS");
  }

  const generatedAt = Math.floor(Date.now() / 1000);
  let snapshot: Awaited<ReturnType<typeof loadEventExportSnapshot>>;
  try { snapshot = await loadEventExportSnapshot(db, eventId, prefetchedEvent); }
  catch {
    return publicJsonResponse(req, { error: "database_unavailable" }, "no-store", 503);
  }
  if (!snapshot) return notFound(req);
  const payload = buildEventExportPayloadForFormat(snapshot, format, generatedAt, updateMode);
  try { assertNoForbiddenKeys(payload); }
  catch { return publicJsonResponse(req, { error: "public_payload_unavailable" }, "no-store", 503); }
  const body = JSON.stringify(payload);
  if (usePayloadCache && host) {
    writePublicJsonCacheBestEffort(key, {
      payload: { body, metadata: cacheMetadataForFormat(format) }, stored_at: generatedAt,
    }, refreshMinutes * 60, host);
  }
  if (microCacheKey) isolateMicroCacheSet(microCacheKey, body);
  return exportResponse(req, body, format, updateMode, refreshMinutes,
    updateMode === "scheduled" ? "MISS" : "BYPASS");
});
