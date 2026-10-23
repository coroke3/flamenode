import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import {
  normalizeSoftwareCatalogName,
  normalizeSoftwareKey,
} from "@flamenode/domain/software/labels";

// CURRENT: app/api/software/suggestions/route.ts + src/lib/api/publicApi.ts
// (rate limit, limit parsing, ETag/304, 503) + src/lib/api/publicDto.ts
// (active-only DTO allowlist). D1: at most 2 bounded reads per request.
const DEFAULT_SOFTWARE_SUGGESTION_LIMIT = 20;
const MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT = 50;
const MAX_QUERY_LENGTH = 64;
const RATE_LIMIT_ENDPOINT = "/api/software/suggestions";
const CACHE_CONTROL = "public, max-age=60, s-maxage=120, stale-while-revalidate=300";

// Isolate-level best-effort fixed window, same limits as CURRENT. The key
// count is capped so a spray of client IPs cannot grow isolate memory.
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 60;
const MAX_RATE_LIMIT_KEYS = 2048;
type RateLimitBucket = { windowStart: number; count: number };
const rateLimitBuckets = new Map<string, RateLimitBucket>();
let nextRateLimitCleanupAt = 0;

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

function checkRateLimit(request: Request, now = Math.floor(Date.now() / 1000)): Response | null {
  if (now >= nextRateLimitCleanupAt) {
    nextRateLimitCleanupAt = now + RATE_LIMIT_WINDOW_SECONDS;
    for (const [key, bucket] of rateLimitBuckets) {
      if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_SECONDS) rateLimitBuckets.delete(key);
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
  return rateLimitedResponse(Math.max(1, RATE_LIMIT_WINDOW_SECONDS - (now - bucket.windowStart)));
}

export function clearSoftwareSuggestionRateLimitForTests(): void {
  rateLimitBuckets.clear();
  nextRateLimitCleanupAt = 0;
}

/** CURRENT parseBoundedPositiveInt: 0 / non-numeric -> fallback, negative -> 1, over max -> max. */
function parseLimit(value: string | null | undefined): number {
  const parsed = Number.parseInt(value ?? String(DEFAULT_SOFTWARE_SUGGESTION_LIMIT), 10);
  const candidate = parsed || DEFAULT_SOFTWARE_SUGGESTION_LIMIT;
  if (!Number.isFinite(candidate)) return DEFAULT_SOFTWARE_SUGGESTION_LIMIT;
  return Math.min(MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT, Math.max(1, Math.floor(candidate)));
}

async function bodyEtag(body: string): Promise<string> {
  const bytes = new TextEncoder().encode(body);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `"${hex}"`;
}

function etagMatches(value: string | undefined, etag: string): boolean {
  if (!value) return false;
  return value.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized.replace(/^W\//, "") === etag;
  });
}

function databaseUnavailable(): Response {
  return new Response(JSON.stringify({ error: "database_unavailable" }), {
    status: 503,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "30" },
  });
}

type SoftwareSuggestionRow = {
  id: string;
  name: string;
  category: string | null;
  usage_count: number;
  is_verified: number;
  is_active: number;
};

export const softwareSuggestionsRoutes = new Hono<AppEnv>();

// RH-029: GET /api/software/suggestions
softwareSuggestionsRoutes.get("/", async (c) => {
  const limited = checkRateLimit(c.req.raw);
  if (limited) return limited;

  const url = new URL(c.req.url);
  const q = (url.searchParams.get("q")?.trim() ?? "").slice(0, MAX_QUERY_LENGTH);
  const limit = parseLimit(url.searchParams.get("limit"));

  const db = c.env?.DB;
  if (!db) return databaseUnavailable();

  let rows: SoftwareSuggestionRow[] | null = null;

  try {
    if (!q) {
      const stmt = db.prepare(`
        SELECT 
          sc.id,
          sc.name,
          sc.category,
          (SELECT COUNT(*) FROM video_softwares vs WHERE vs.software_id = sc.id) AS usage_count,
          sc.is_verified,
          sc.is_active
        FROM software_catalog sc
        WHERE sc.is_active = 1
        ORDER BY sc.is_verified DESC, usage_count DESC, sc.name ASC
        LIMIT ?
      `);
      const res = await stmt.bind(limit).all<SoftwareSuggestionRow>();
      rows = res.results;
    } else {
      const aliasKey = normalizeSoftwareKey(q);
      const catalogQuery = normalizeSoftwareCatalogName(q);

      const aliasStmt = db.prepare(`
        SELECT software_id 
        FROM software_aliases 
        WHERE normalized_alias = ? 
        LIMIT 5
      `);
      const aliasRes = await aliasStmt.bind(aliasKey).all<{ software_id: string }>();

      if (aliasRes.results && aliasRes.results.length > 0) {
        const ids = aliasRes.results.map((r) => r.software_id);
        const placeholders = ids.map(() => "?").join(",");
        const stmt = db.prepare(`
          SELECT 
            sc.id,
            sc.name,
            sc.category,
            (SELECT COUNT(*) FROM video_softwares vs WHERE vs.software_id = sc.id) AS usage_count,
            sc.is_verified,
            sc.is_active
          FROM software_catalog sc
          WHERE sc.is_active = 1 AND sc.id IN (${placeholders})
          ORDER BY sc.is_verified DESC, usage_count DESC
          LIMIT ?
        `);
        const res = await stmt.bind(...ids, limit).all<SoftwareSuggestionRow>();
        rows = res.results;
      } else {
        const stmt = db.prepare(`
          SELECT 
            sc.id,
            sc.name,
            sc.category,
            (SELECT COUNT(*) FROM video_softwares vs WHERE vs.software_id = sc.id) AS usage_count,
            sc.is_verified,
            sc.is_active
          FROM software_catalog sc
          WHERE sc.is_active = 1 AND (
            sc.name LIKE '%' || ? || '%' OR
            sc.normalized_name LIKE '%' || ? || '%'
          )
          ORDER BY 
            CASE 
              WHEN sc.normalized_name LIKE ? || '%' THEN 0 
              WHEN sc.normalized_name LIKE '%' || ? THEN 1 
              ELSE 2 
            END,
            sc.is_verified DESC,
            usage_count DESC,
            sc.name ASC
          LIMIT ?
        `);
        const res = await stmt
          .bind(q, catalogQuery, catalogQuery, catalogQuery, limit)
          .all<SoftwareSuggestionRow>();
        rows = res.results;
      }
    }
  } catch (error) {
    console.error("[software-suggestions] query failed", error);
    return databaseUnavailable();
  }

  if (!rows) return databaseUnavailable();

  // DTO allowlist: inactive rows never leave even if a SQL branch regresses.
  const payload = rows
    .filter((r) => r.is_active === 1)
    .map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      usage_count: r.usage_count,
      is_verified: r.is_verified,
    }));

  const body = JSON.stringify(payload);
  const etag = await bodyEtag(body);
  const headers = { "Cache-Control": CACHE_CONTROL, ETag: etag };
  if (etagMatches(c.req.header("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json" },
  });
});
