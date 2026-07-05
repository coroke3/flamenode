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
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && YOUTUBE_ID_RE.test(id) ? id : null;
    }
    if (host.endsWith("youtube.com")) {
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

/** YouTube サムネイル URL (高画質)。 */
export function youtubeThumbUrl(
  id: string | null | undefined,
  size: YoutubeThumbSize = "hqdefault",
): string {
  const youtubeId = extractYoutubeId(id);
  if (!youtubeId) return "";
  return `/api/youtube-thumbnail/${youtubeId}/${size}`;
}

/** YouTube 動画ページ URL。 */
export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** YouTube iframe 埋め込み URL。 */
export function youtubeEmbedUrl(id: string, opts: { autoplay?: boolean; start?: number; mute?: boolean } = {}): string {
  const params = new URLSearchParams();
  params.set("rel", "0");
  params.set("modestbranding", "1");
  params.set("playsinline", "1");
  if (opts.autoplay) params.set("autoplay", "1");
  if (opts.mute) params.set("mute", "1");
  if (opts.start && opts.start > 0) params.set("start", String(Math.floor(opts.start)));
  return `https://www.youtube.com/embed/${id}?${params.toString()}`;
}
