export const PLAYLIST_SYNC_INTERVALS = [60, 180, 360, 720, 1440, 10080] as const;

export type PlaylistSyncMode = "off" | "append_only" | "mirror";

const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{10,100}$/;

export function extractYoutubePlaylistId(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (PLAYLIST_ID_PATTERN.test(value)) return value;

  try {
    const url = new URL(value);
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

export function playlistSyncModeLabel(mode: PlaylistSyncMode): string {
  if (mode === "append_only") return "追加のみ";
  if (mode === "mirror") return "完全同期";
  return "同期しない";
}
