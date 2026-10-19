import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import {
  normalizeSoftwareCatalogName,
  normalizeSoftwareKey,
} from "@flamenode/domain/software/labels";

const DEFAULT_SOFTWARE_SUGGESTION_LIMIT = 20;
const MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT = 50;
const MAX_QUERY_LENGTH = 64;

// Rate limiting state (best-effort isolate-level)
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 60;
const rateLimitBuckets = new Map<string, { windowStart: number; count: number }>();

function checkRateLimit(request: Request): Response | null {
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  const now = Math.floor(Date.now() / 1000);
  const key = `suggestions:${ip.slice(0, 128)}`;

  let bucket = rateLimitBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_SECONDS) {
    bucket = { windowStart: now, count: 0 };
    rateLimitBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count <= RATE_LIMIT_MAX_REQUESTS) return null;

  return new Response(JSON.stringify({ error: "rate_limited" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(Math.max(1, RATE_LIMIT_WINDOW_SECONDS - (now - bucket.windowStart))),
      "Cache-Control": "no-store",
    },
  });
}

function parseBoundedPositiveInt(
  value: string | null | undefined,
  fallback: number,
  min = 1,
  max = 50,
): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

async function bodyEtag(body: string): Promise<string> {
  const bytes = new TextEncoder().encode(body);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `"${hex}"`;
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
  const limit = parseBoundedPositiveInt(
    url.searchParams.get("limit"),
    DEFAULT_SOFTWARE_SUGGESTION_LIMIT,
    1,
    MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT,
  );

  const db = c.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "database_unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "30" },
    });
  }

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
    return new Response(JSON.stringify({ error: "database_unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "30" },
    });
  }

  if (!rows) {
    return new Response(JSON.stringify({ error: "database_unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "30" },
    });
  }

  const payload = rows
    .filter((r) => r.is_active === 1)
    .map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category ?? null,
      usage_count: Number(r.usage_count) || 0,
      is_verified: r.is_verified === 1 ? 1 : 0,
    }));

  const body = JSON.stringify(payload);
  const etag = await bodyEtag(body);
  const ifNoneMatch = c.req.header("If-None-Match");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
    ETag: etag,
  };

  if (ifNoneMatch && (ifNoneMatch === "*" || ifNoneMatch.replace(/^W\//, "") === etag)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(body, { status: 200, headers });
});
