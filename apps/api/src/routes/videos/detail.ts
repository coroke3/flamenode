/**
 * MIG-0603 U01 (RH-030): GET /api/videos/:id on Hono.
 * CURRENT: app/api/videos/[id]/route.ts + src/lib/api/publicApi.ts (rate limit,
 * ETag/304, 503) + src/lib/api/publicDto.ts (PUBLIC_VIDEO_KEYS allowlist) +
 * src/lib/db/listQueries.ts fetchPublicVideoByIdOrYoutube /
 * src/lib/db/videoIdLookup.ts resolveVideoPrimaryKey.
 * Public cacheable DTO: stays Cache-Control public (CURRENT parity); the
 * private viewer overlay is a separate route/DTO. D1: <= 3 bounded reads.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";

const RATE_LIMIT_ENDPOINT = "/api/videos/:id";
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 60;
const MAX_RATE_LIMIT_KEYS = 2048;
const DETAIL_CACHE_CONTROL =
  "public, max-age=30, s-maxage=60, stale-while-revalidate=120";

// Reachable subset of CURRENT FORBIDDEN_PUBLIC_KEYS; guards column drift.
const FORBIDDEN_KEYS = new Set([
  "submitted_by_user_id", "creator_x_user_id", "user_id", "actor_user_id",
  "role", "is_banned", "internal_note", "private_note", "void_detail_private",
  "audit_logs", "history_logs", "email", "discord_id", "active_x_user_id",
]);

// CURRENT src/lib/video/internalId.ts
const PREFIXED_INTERNAL_VIDEO_ID_RE =
  /^[a-z][a-z0-9_]*_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BARE_INTERNAL_VIDEO_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isConfirmedInternalVideoId(id: string): boolean {
  const t = id.trim();
  return PREFIXED_INTERNAL_VIDEO_ID_RE.test(t) || BARE_INTERNAL_VIDEO_ID_RE.test(t);
}

type RateLimitBucket = { windowStart: number; count: number };
const rateLimitBuckets = new Map<string, RateLimitBucket>();
let nextRateLimitCleanupAt = 0;

export function clearVideoDetailRateLimitForTests(): void {
  rateLimitBuckets.clear();
  nextRateLimitCleanupAt = 0;
}

function rateLimitedResponse(retryAfter: number): Response {
  return new Response(JSON.stringify({ error: "rate_limited" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
      "Cache-Control": "no-store",
    },
  });
}

function checkRateLimit(
  request: Request,
  now = Math.floor(Date.now() / 1000),
): Response | null {
  if (now >= nextRateLimitCleanupAt) {
    nextRateLimitCleanupAt = now + RATE_LIMIT_WINDOW_SECONDS;
    for (const [key, bucket] of rateLimitBuckets) {
      if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_SECONDS) {
        rateLimitBuckets.delete(key);
      }
    }
  }
  const connectingIp = request.headers.get("CF-Connecting-IP")?.trim();
  const forwarded = request.headers.get("X-Forwarded-For")?.split(",", 1)[0]?.trim();
  const key = `${RATE_LIMIT_ENDPOINT}:${(connectingIp || forwarded || "unknown").slice(0, 128)}`;
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_SECONDS) {
    if (!bucket && rateLimitBuckets.size >= MAX_RATE_LIMIT_KEYS) {
      return rateLimitedResponse(RATE_LIMIT_WINDOW_SECONDS);
    }
    bucket = { windowStart: now, count: 0 };
    rateLimitBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count <= RATE_LIMIT_MAX_REQUESTS) return null;
  return rateLimitedResponse(
    Math.max(1, RATE_LIMIT_WINDOW_SECONDS - (now - bucket.windowStart)),
  );
}

async function bodyEtag(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `"${hex}"`;
}

function etagMatches(value: string | undefined, etag: string): boolean {
  if (!value) return false;
  return value.split(",").some((candidate) => {
    const n = candidate.trim();
    return n === "*" || n.replace(/^W\//, "") === etag;
  });
}

async function jsonResponse(
  ifNoneMatch: string | undefined,
  payload: unknown,
  cacheControl: string,
  status = 200,
): Promise<Response> {
  const body = JSON.stringify(payload);
  const etag = await bodyEtag(body);
  const headers = { "Cache-Control": cacheControl, ETag: etag };
  if (status === 200 && etagMatches(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function unavailable(code = "database_unavailable"): Response {
  return new Response(JSON.stringify({ error: code }), {
    status: 503,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "30" },
  });
}

// CURRENT decodes the (already framework-decoded) param once more.
function decodePathSegment(raw: string | undefined): string | null {
  try {
    return decodeURIComponent(raw ?? "").trim();
  } catch {
    return null;
  }
}

type PublicVideoRow = {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string | null;
  icon_url: string | null;
  primary_event_id: string | null;
  scheduled_time: number | null;
};

// resolveVideoPrimaryKey: PK first; YouTube ID only when PK misses and the id
// is not a confirmed internal id. Public-only in both lookups.
async function resolvePublicVideoId(db: D1Database, key: string): Promise<string | null> {
  const byPk = await db
    .prepare(`SELECT id FROM videos WHERE id = ? AND visibility_status = 'public' LIMIT 1`)
    .bind(key)
    .first<{ id: string }>();
  if (byPk?.id) return byPk.id;
  if (isConfirmedInternalVideoId(key)) return null;
  const byYoutube = await db
    .prepare(`SELECT id FROM videos WHERE youtube_video_id = ? AND visibility_status = 'public' LIMIT 1`)
    .bind(key)
    .first<{ id: string }>();
  return byYoutube?.id ?? null;
}

async function fetchPublicVideo(db: D1Database, key: string): Promise<PublicVideoRow | null> {
  const id = await resolvePublicVideoId(db, key);
  if (!id) return null;
  // creatorNameExpr / creatorIconExpr (displayExpr.ts): snapshot columns only.
  return db
    .prepare(
      `SELECT id, title, youtube_video_id,
              COALESCE(NULLIF(TRIM(creator_display_name), ''), creator_x_user_id, '') AS display_name,
              creator_icon_url AS icon_url,
              primary_event_id, scheduled_time
       FROM videos WHERE visibility_status = 'public' AND id = ? LIMIT 1`,
    )
    .bind(id)
    .first<PublicVideoRow>();
}

function assertNoForbiddenKeys(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(k)) throw new Error(`Public API leak: forbidden key "${k}"`);
    assertNoForbiddenKeys(v);
  }
}

export const videoDetailRoutes = new Hono<AppEnv>();

// RH-030: GET /api/videos/:id
videoDetailRoutes.get("/:id", async (c) => {
  const limited = checkRateLimit(c.req.raw);
  if (limited) return limited;
  const inm = c.req.header("If-None-Match");
  const key = decodePathSegment(c.req.param("id"));
  if (!key) return jsonResponse(inm, { error: "not_found" }, "no-store", 404);

  const db = c.env?.DB;
  if (!db) return unavailable();

  let row: PublicVideoRow | null;
  try {
    row = await fetchPublicVideo(db, key);
  } catch (error) {
    console.error("[public-videos] detail query failed", error);
    return unavailable();
  }
  if (!row) return jsonResponse(inm, { error: "not_found" }, "no-store", 404);

  const payload = {
    item: {
      id: row.id,
      title: row.title,
      youtube_video_id: row.youtube_video_id,
      display_name: row.display_name,
      icon_url: row.icon_url,
      primary_event_id: row.primary_event_id,
      scheduled_time: row.scheduled_time,
      status: "public" as const,
    },
  };
  assertNoForbiddenKeys(payload);
  return jsonResponse(inm, payload, DETAIL_CACHE_CONTROL);
});
