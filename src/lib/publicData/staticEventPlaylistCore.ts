export const EVENT_PLAYLIST_SCHEMA_VERSION = 1;
export const EVENT_PLAYLIST_MAX_ITEMS = 500;
export const EVENT_PLAYLIST_MAX_OBJECT_BYTES = 8 * 1024 * 1024;

export type StaticEventPlaylistItem = {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  scheduled_time: number | null;
};

export type StaticEventPlaylistPayload = {
  schema_version?: unknown;
  generated_at?: unknown;
  event_id?: unknown;
  complete?: unknown;
  items?: unknown;
};

export type StaticEventPlaylist = {
  generatedAt: number | null;
  eventId: string;
  complete: boolean;
  items: StaticEventPlaylistItem[];
};

export function eventPlaylistObjectKey(eventId: string): string {
  return `events/${eventId}/playlist.v1.json`;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeUnix(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeItem(value: unknown): StaticEventPlaylistItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = normalizeString(row.id);
  const title = normalizeString(row.title);
  const displayName = normalizeString(row.display_name);
  if (!id || !title || !displayName) return null;
  return {
    id,
    title,
    youtube_video_id: normalizeString(row.youtube_video_id),
    display_name: displayName,
    scheduled_time: normalizeUnix(row.scheduled_time),
  };
}

export function normalizeStaticEventPlaylist(
  payload: StaticEventPlaylistPayload,
  expectedEventId?: string,
): StaticEventPlaylist | null {
  if (Number(payload.schema_version) !== EVENT_PLAYLIST_SCHEMA_VERSION) return null;
  const eventId = normalizeString(payload.event_id);
  if (!eventId || (expectedEventId && eventId !== expectedEventId)) return null;
  if (!Array.isArray(payload.items)) return null;
  // A duplicated video ID makes a `complete` artifact look healthy while the
  // consumer's final dedupe silently drops entries. Treat the projection as
  // corrupt so callers can use the authoritative D1 fallback instead.
  if (payload.items.length > EVENT_PLAYLIST_MAX_ITEMS) return null;
  const items = payload.items.map(normalizeItem);
  if (items.some((item) => item === null)) return null;
  const itemIds = new Set(
    items.map((item) => (item as StaticEventPlaylistItem).id),
  );
  if (itemIds.size !== items.length) return null;
  return {
    generatedAt: normalizeUnix(payload.generated_at),
    eventId,
    complete: payload.complete === true,
    items: items as StaticEventPlaylistItem[],
  };
}
