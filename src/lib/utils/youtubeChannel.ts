import { normalizeHttpUrl } from "./url";

const MAX_CHANNEL_URL_LENGTH = 500;

/** YouTube チャンネル URL を正規化する。チャンネル形式でなければ null。 */
export function normalizeYoutubeChannelUrl(
  raw: string | null | undefined,
): string | null {
  const http = normalizeHttpUrl(raw, { maxLength: MAX_CHANNEL_URL_LENGTH });
  if (!http) return null;

  try {
    const url = new URL(http);
    const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (host !== "youtube.com") return null;

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;

    const head = segments[0]!;
    let channelPath: string;
    if (head.startsWith("@")) {
      // A bare "@" is not a channel handle.
      if (head.length === 1) return null;
      channelPath = head;
    } else if (head === "channel" || head === "c" || head === "user") {
      const id = segments[1];
      if (!id) return null;
      channelPath = `${head}/${id}`;
    } else {
      return null;
    }

    // Canonicalization expands http://youtube.com into https://www.youtube.com.
    // Enforce the same storage limit on the final URL, not just on the input.
    const canonical = `https://www.youtube.com/${channelPath}`;
    return canonical.length <= MAX_CHANNEL_URL_LENGTH ? canonical : null;
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
