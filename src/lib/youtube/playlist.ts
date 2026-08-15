export type PlaylistSyncMode = "off" | "append_only" | "mirror";

const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{10,100}$/;

function isYoutubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return (
    host === "youtu.be" ||
    host === "youtube.com" ||
    host.endsWith(".youtube.com")
  );
}

export function extractYoutubePlaylistId(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (PLAYLIST_ID_PATTERN.test(value)) return value;

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !isYoutubeHost(url.hostname)
    ) {
      return null;
    }
    const playlistId = url.searchParams.get("list")?.trim() ?? "";
    return PLAYLIST_ID_PATTERN.test(playlistId) ? playlistId : null;
  } catch {
    return null;
  }
}

export function parsePlaylistSyncMode(raw: string | null | undefined): PlaylistSyncMode {
  return raw === "append_only" || raw === "mirror" ? raw : "off";
}

export function parsePlaylistSyncInterval(raw: string | null | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value)) return 720;
  return Math.min(10080, Math.max(60, value));
}
