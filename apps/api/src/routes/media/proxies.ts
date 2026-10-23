/**
 * MIG-0605 U03 (part): RH-016 GET /api/google-drive-image/:id and
 * RH-033 GET /api/youtube-thumbnail/:id/:size.
 * CURRENT: app/api/google-drive-image/[id]/route.ts and
 * app/api/youtube-thumbnail/[id]/[size]/route.ts.
 *
 * SSRF (T02): the upstream URL is built only from a fixed https host plus a
 * strictly validated id (and a fixed size allowlist); no request-supplied URL
 * is ever fetched. Invalid ids/sizes -> 404 "Not found" before any fetch.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import { proxyExternalImage } from "./externalImageProxy.ts";

const GOOGLE_DRIVE_ID_RE = /^[A-Za-z0-9_-]{6,}$/;
const DRIVE_MAX_OBJECT_BYTES = 8 * 1024 * 1024;
const DRIVE_FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-label="Image unavailable"><rect width="160" height="160" fill="#15181d"/><circle cx="80" cy="64" r="28" fill="#c9ff00"/><path d="M36 132c7-26 24-42 44-42s37 16 44 42H36Z" fill="#f4f7ef"/></svg>`;

export const googleDriveImageRoutes = new Hono<AppEnv>();

googleDriveImageRoutes.get("/:id", async (c) => {
  const id = (c.req.param("id") ?? "").trim();
  if (!GOOGLE_DRIVE_ID_RE.test(id)) {
    return new Response("Not found", { status: 404 });
  }
  return await proxyExternalImage({
    namespace: "google-drive-image",
    cacheKey: id,
    upstreamUrl: `https://lh3.googleusercontent.com/d/${id}`,
    fallbackSvg: DRIVE_FALLBACK_SVG,
    maxObjectBytes: DRIVE_MAX_OBJECT_BYTES,
  });
});

// src/lib/youtube/id.ts YOUTUBE_THUMB_SIZES (pinned against CURRENT by test).
export const YOUTUBE_THUMB_SIZES = [
  "default",
  "hqdefault",
  "mqdefault",
  "sddefault",
  "maxresdefault",
] as const;
type YoutubeThumbSize = (typeof YOUTUBE_THUMB_SIZES)[number];

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const MAX_OBJECT_BYTES_BY_SIZE: Record<YoutubeThumbSize, number> = {
  default: 96 * 1024,
  mqdefault: 160 * 1024,
  hqdefault: 256 * 1024,
  sddefault: 512 * 1024,
  maxresdefault: 1024 * 1024,
};
const YOUTUBE_FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="サムネイルを取得できません"><rect width="640" height="360" fill="#15181d"/><path d="M278 228V132l92 48-92 48Z" fill="#c9ff00"/><text x="320" y="284" text-anchor="middle" fill="#f4f7ef" font-family="Arial, sans-serif" font-size="24" font-weight="700">サムネイルを取得できません</text></svg>`;

function getEdgeCache(): Cache | null {
  try {
    if (typeof caches !== "undefined" && "default" in caches) {
      return (caches as unknown as { default: Cache }).default ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeSize(raw: string | undefined): YoutubeThumbSize | null {
  const value = (raw ?? "").replace(/\.jpg$/i, "");
  return (YOUTUBE_THUMB_SIZES as readonly string[]).includes(value)
    ? (value as YoutubeThumbSize)
    : null;
}

function decodePathSegment(raw: string | undefined): string | null {
  try {
    return decodeURIComponent(raw ?? "").trim();
  } catch {
    return null;
  }
}

export const youtubeThumbnailRoutes = new Hono<AppEnv>();

youtubeThumbnailRoutes.get("/:id/:size", async (c) => {
  const id = decodePathSegment(c.req.param("id"));
  const size = normalizeSize(decodePathSegment(c.req.param("size")) ?? undefined);
  if (!id || !YOUTUBE_ID_RE.test(id) || !size) {
    return new Response("Not found", { status: 404 });
  }

  const cache = getEdgeCache();
  const cacheKey = new Request(
    `${new URL(c.req.url).origin}/api/youtube-thumbnail/${id}/${size}`,
    { method: "GET" },
  );

  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    } catch {
      // cache match failed
    }
  }

  const response = await proxyExternalImage({
    namespace: "youtube-thumbnail",
    cacheKey: `${id}:${size}`,
    upstreamUrl: `https://i.ytimg.com/vi/${id}/${size}.jpg`,
    fallbackSvg: YOUTUBE_FALLBACK_SVG,
    maxObjectBytes: MAX_OBJECT_BYTES_BY_SIZE[size],
  });

  if (cache && response.ok) {
    try {
      const putPromise = cache.put(cacheKey, response.clone()).catch(() => undefined);
      let waitUntil: ((promise: Promise<unknown>) => void) | null = null;
      try {
        waitUntil = c.executionCtx.waitUntil.bind(c.executionCtx);
      } catch {
        waitUntil = null;
      }
      if (waitUntil) {
        waitUntil(putPromise);
      } else {
        await putPromise;
      }
    } catch {
      // cache put failed (best effort)
    }
  }

  return response;
});
