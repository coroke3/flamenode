/**
 * YouTube URL / ID 関連のユーティリティ。
 *  - 11桁の動画 ID へ正規化
 *  - サムネイル URL 生成
 *  - 共有 URL / Shorts URL / 通常 URL の判別
 */

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const YOUTUBE_THUMB_SIZES = [
  "default",
  "hqdefault",
  "mqdefault",
  "sddefault",
  "maxresdefault",
] as const;

export type YoutubeThumbSize = (typeof YOUTUBE_THUMB_SIZES)[number];

/**
 * 入力値から YouTube 動画 ID を抽出する。
 * 不正値の場合は null を返す。
 */
export function extractYoutubeId(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (YOUTUBE_ID_RE.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && YOUTUBE_ID_RE.test(id) ? id : null;
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      const v = url.searchParams.get("v");
      if (v && YOUTUBE_ID_RE.test(v)) return v;
      // /shorts/ID, /embed/ID, /live/ID
      const parts = url.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((p) =>
        ["shorts", "embed", "live", "v"].includes(p),
      );
      if (idx >= 0 && parts[idx + 1] && YOUTUBE_ID_RE.test(parts[idx + 1])) {
        return parts[idx + 1];
      }
    }
  } catch {
    /* not a URL */
  }
  return null;
}

/**
 * Same-origin video detail route for CURRENT Next and Astro cards.
 *
 * Even if a legacy/corrupt youtube_video_id begins with "/", it must not
 * create a protocol-relative //host link when prepended to a slash.
 * Valid internal IDs use the same safe alphabet as public video snapshots.
 */
const SAFE_INTERNAL_VIDEO_ID = /^[A-Za-z0-9_-]{1,128}$/;
export function videoPageHref(video: { id: string; youtube_video_id?: string | null }): string {
  const youtubeId = extractYoutubeId(video.youtube_video_id);
  if (youtubeId) return `/${youtubeId}`;
  return SAFE_INTERNAL_VIDEO_ID.test(video.id) ? `/${video.id}` : "/list";
}

/** Keep event playlist links on the same origin even with corrupted video IDs. */
export function eventVideoPageHref(
  video: { id: string; youtube_video_id?: string | null },
  eventId: string,
): string {
  const href = videoPageHref(video);
  return href === "/list" ? href : `${href}?playlist=${encodeURIComponent(eventId)}`;
}

/** YouTube サムネイル URL (高画質)。 */
export function youtubeThumbUrl(
  id: string | null | undefined,
  size: YoutubeThumbSize = "hqdefault",
): string {
  const youtubeId = extractYoutubeId(id);
  if (!youtubeId) return "";
  return `/api/youtube-thumbnail/${youtubeId}/${size}`;
}

/** Preserve one URL component even if a legacy ID is malformed.
 * YouTube IDs are ASCII; replacement characters only affect invalid inputs.
 * A literal dot segment would otherwise be normalized out of an iframe path.
 */
function encodeYoutubeIdComponent(id: string): string {
  const encoded = encodeURIComponent(id.replace(/[\uD800-\uDFFF]/g, "\uFFFD"));
  return encoded === "." || encoded === ".." ? "_" : encoded;
}

/** YouTube 動画ページ URL。 */
export function youtubeWatchUrl(id: string): string {
  // An invalid/legacy ID must never become another query parameter or fragment.
  return `https://www.youtube.com/watch?v=${encodeYoutubeIdComponent(id)}`;
}

/** YouTube iframe 埋め込み URL。 */
export function youtubeEmbedUrl(
  id: string,
  opts: {
    autoplay?: boolean;
    start?: number;
    mute?: boolean;
    enableJsApi?: boolean;
    origin?: string;
  } = {},
): string {
  const params = new URLSearchParams();
  params.set("rel", "0");
  params.set("modestbranding", "1");
  params.set("playsinline", "1");
  if (opts.enableJsApi) params.set("enablejsapi", "1");
  if (opts.origin) params.set("origin", opts.origin);
  if (opts.autoplay) params.set("autoplay", "1");
  if (opts.mute) params.set("mute", "1");
  if (opts.start && opts.start > 0) params.set("start", String(Math.floor(opts.start)));
  // Preserve the iframe path and our query options even for corrupted IDs.
  return `https://www.youtube.com/embed/${encodeYoutubeIdComponent(id)}?${params.toString()}`;
}
