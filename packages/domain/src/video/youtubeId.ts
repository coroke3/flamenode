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

