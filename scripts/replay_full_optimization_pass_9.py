from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:100]!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


route = "app/api/event-endpoints/[id]/route.ts"
replace_once(
    route,
    '''  EVENT_EXPORT_ACCESS_TTL_SECONDS,
  eventExportAccessCacheKey,
''',
    '''  EVENT_EXPORT_ACCESS_TTL_SECONDS,
  EVENT_EXPORT_REFRESH_MINUTES,
  eventExportAccessCacheKey,
''',
)
replace_once(
    route,
    '''import { checkPublicApiRateLimit, publicJsonResponse } from "@/lib/api/publicApi";

const NOT_FOUND_CACHE_CONTROL = "public, max-age=60";
const inFlightExports = new Map<string, Promise<unknown | null>>();
''',
    '''import {
  checkPublicApiRateLimit,
  publicJsonBodyResponse,
  publicJsonResponse,
} from "@/lib/api/publicApi";

const NOT_FOUND_CACHE_CONTROL = "public, max-age=60";
const inFlightExports = new Map<string, Promise<string | null>>();
''',
)
replace_once(route, '''  payload: unknown,
''', '''  body: string,
''')
replace_once(
    route,
    '''  const response = await publicJsonResponse(req, payload, cacheControl);
''',
    '''  const response = await publicJsonBodyResponse(req, body, cacheControl);
''',
)
replace_once(
    route,
    '''async function readCachedPayload(
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
''',
    '''async function readCachedPayload(
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
    JSON.parse(cached);
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
      // 壊れたキャッシュ削除の失敗はD1フォールバックを妨げない。
    }
    return null;
  }
}
''',
)
replace_once(
    route,
    '''async function buildPayloadOnce(
  key: string,
  factory: () => Promise<unknown | null>,
): Promise<unknown | null> {
''',
    '''async function buildPayloadOnce(
  key: string,
  factory: () => Promise<string | null>,
): Promise<string | null> {
''',
)
replace_once(
    route,
    '''          refresh: [15, 60, 360, 1440],
''',
    '''          refresh: EVENT_EXPORT_REFRESH_MINUTES,
''',
)
replace_once(
    route,
    '''  const payload = await buildPayloadOnce(
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
''',
    '''  const body = await buildPayloadOnce(
    [eventId, format, updateMode].join(":"),
    async () => {
      const snapshot = await loadEventExportSnapshot(db, eventId, prefetchedEvent);
      return snapshot
        ? JSON.stringify(
            buildEventExportPayloadForFormat(
              snapshot,
              format,
              generatedAt,
              updateMode,
            ),
          )
        : null;
    },
  );

  if (body === null) {
''',
)
replace_once(
    route,
    '''      kv.put(payloadCacheKey, JSON.stringify(payload), {
''',
    '''      kv.put(payloadCacheKey, body, {
''',
)
replace_once(
    route,
    '''    payload,
    format,
''',
    '''    body,
    format,
''',
)

Path("scripts/replay_full_optimization_pass_9.py").unlink()
Path(".github/workflows/replay-full-optimization-pass-9.yml").unlink()
print("replayed optimization pass 9 onto latest main")
