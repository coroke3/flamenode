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
  buildEventExportPayload,
  type EventExportUpdateMode,
} from "@/lib/api/eventExportPayload";
import {
  EVENT_EXPORT_ACCESS_TTL_SECONDS,
  EVENT_EXPORT_REFRESH_MINUTES,
  eventExportAccessCacheKey,
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

const NOT_FOUND_CACHE_CONTROL = "public, max-age=60";
const inFlightExports = new Map<string, Promise<string | null>>();

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
  updateMode: EventExportUpdateMode,
  refreshMinutes: EventExportRefreshMinutes,
  cacheState: "HIT" | "MISS" | "BYPASS",
): Promise<Response> {
  const cacheControl =
    updateMode === "realtime"
      ? "no-store"
      : "public, max-age=60, s-maxage=60, stale-while-revalidate=60";
  const response = await publicJsonBodyResponse(req, body, cacheControl);
  response.headers.set("X-FlameNode-Schema-Version", "5");
  response.headers.set("X-FlameNode-Format", "flamenode-event-export");
  response.headers.set("X-FlameNode-Update-Mode", updateMode);
  response.headers.set("X-FlameNode-Refresh-Minutes", String(refreshMinutes));
  response.headers.set("X-FlameNode-Cache", cacheState);
  return response;
}

async function readCachedPayload(
  kv: KVNamespace,
  cacheKey: string,
  eventId: string,
): Promise<string | null> {
  let cached: string | null;
  try {
    cached = await kv.get(cacheKey);
  } catch (error) {
    console.warn("[event-export-api] KV payload read failed", {
      eventId,
      cacheKey,
      error,
    });
    return null;
  }
  if (!cached) return null;
  try {
    const parsed = JSON.parse(cached) as { schema_version?: unknown };
    if (parsed.schema_version !== 5) throw new Error("stale_schema");
    return cached;
  } catch (error) {
    console.warn("[event-export-api] invalid KV payload evicted", {
      eventId,
      cacheKey,
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

async function buildPayloadOnce(
  key: string,
  factory: () => Promise<string | null>,
): Promise<string | null> {
  const current = inFlightExports.get(key);
  if (current) return current;

  const promise = factory();
  inFlightExports.set(key, promise);
  try {
    return await promise;
  } finally {
    if (inFlightExports.get(key) === promise) inFlightExports.delete(key);
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
  if (!eventId) return notFoundResponse(req);

  const url = new URL(req.url);
  if (url.searchParams.has("format")) {
    return publicJsonResponse(
      req,
      {
        error: "format_parameter_removed",
        schema_version: 5,
        message:
          "旧形式は廃止されました。formatパラメータを削除し、v5形式を利用してください。",
      },
      "no-store",
      410,
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

  const accessKey = eventExportAccessCacheKey(eventId);
  const payloadCacheKey = eventExportPayloadCacheKey(
    eventId,
    refreshMinutes,
  );
  const cachedResponse = async (): Promise<Response | null> => {
    if (!kv) return null;
    const cached = await readCachedPayload(kv, payloadCacheKey, eventId);
    return cached === null
      ? null
      : exportResponse(
          req,
          cached,
          updateMode,
          refreshMinutes,
          "HIT",
        );
  };

  // KVのpositive cacheを公開認可の正本にしない。payload HIT前にも必ずD1を確認する。
  const prefetchedEvent: EventExportEventRow | null =
    await loadEventExportEvent(db, eventId);
  const allowed = isPublicExportEvent(prefetchedEvent);
  if (!allowed) {
    if (kv) {
      try {
        await kv.put(accessKey, "0", {
          expirationTtl: EVENT_EXPORT_ACCESS_TTL_SECONDS,
        });
      } catch {
        // D1の404判定を優先する。
      }
    }
    return notFoundResponse(req);
  }

  if (kv) {
    const accessWrite = kv
      .put(accessKey, "1", {
        expirationTtl: EVENT_EXPORT_ACCESS_TTL_SECONDS,
      })
      .catch((error) => {
        console.warn("[event-export-api] KV access gate write failed", {
          eventId,
          error,
        });
      });
    const [response] = await Promise.all([cachedResponse(), accessWrite]);
    if (response) return response;
  }

  const generatedAt = Math.floor(Date.now() / 1000);
  const body = await buildPayloadOnce(
    [eventId, updateMode].join(":"),
    async () => {
      const snapshot = await loadEventExportSnapshot(
        db,
        eventId,
        prefetchedEvent,
      );
      return snapshot
        ? JSON.stringify(
            buildEventExportPayload(snapshot, generatedAt, updateMode),
          )
        : null;
    },
  );

  if (body === null) {
    if (kv) {
      try {
        await kv.put(accessKey, "0", {
          expirationTtl: EVENT_EXPORT_ACCESS_TTL_SECONDS,
        });
      } catch {
        // 404応答を優先する。
      }
    }
    return notFoundResponse(req);
  }

  if (kv) {
    const writes = await Promise.allSettled([
      kv.put(payloadCacheKey, body, {
        expirationTtl: refreshMinutes * 60,
      }),
      kv.put(accessKey, "1", {
        expirationTtl: EVENT_EXPORT_ACCESS_TTL_SECONDS,
      }),
    ]);
    if (writes.some((result) => result.status === "rejected")) {
      console.warn("[event-export-api] KV write partially failed", {
        eventId,
        refreshMinutes,
      });
    }
  }

  return exportResponse(
    req,
    body,
    updateMode,
    refreshMinutes,
    updateMode === "scheduled" ? "MISS" : "BYPASS",
  );
}
