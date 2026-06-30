import { normalizeHttpUrl } from "./url";

/** YouTube チャンネル URL を正規化する。チャンネル形式でなければ null。 */
export function normalizeYoutubeChannelUrl(
  raw: string | null | undefined,
): string | null {
  const http = normalizeHttpUrl(raw, { maxLength: 500 });
  if (!http) return null;

  try {
    const url = new URL(http);
    const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (host !== "youtube.com") return null;

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;

    const head = segments[0]!;
    if (head.startsWith("@")) {
      return `https://www.youtube.com/${head}`;
    }
    if (
      head === "channel" ||
      head === "c" ||
      head === "user"
    ) {
      const id = segments[1];
      if (!id) return null;
      return `https://www.youtube.com/${head}/${id}`;
    }
    return null;
  } catch {
    return null;
  }
}

/** 設定保存用: チャンネル URL 優先、それ以外は http(s) URL を許可。 */
export function normalizeYoutubeChannelInput(
  raw: string | null | undefined,
): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  return (
    normalizeYoutubeChannelUrl(trimmed) ??
    normalizeHttpUrl(trimmed, { maxLength: 500 })
  );
}

export function formatYoutubeChannelLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").replace(/^m\./, "");
    const site = host === "youtube.com" ? "youtube.com" : host;
    const path = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .join("/");
    if (!path) return site;
    return `${site}/${path}`;
  } catch {
    return url;
  }
}
