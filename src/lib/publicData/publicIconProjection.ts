import { normalizeXId } from "../utils/xid.ts";

export const PUBLIC_X_ICON_MAP_OBJECT_KEY =
  "users/public-x-icon-map.v1.json";
export const PUBLIC_X_ICON_MAP_SCHEMA_VERSION = 1 as const;
export const PUBLIC_X_ICON_MAP_MAX_OBJECT_BYTES = 8 * 1024 * 1024;

export type PublicXIconSource = "registered" | "video" | "none";

export interface PublicXIconEntry {
  icon_url: string | null;
  source: PublicXIconSource;
}

export interface PublicXIconMapPayload {
  schema_version: 1;
  generated_at: number;
  entries: Record<string, PublicXIconEntry>;
}

export function normalizePublicIconUrl(value: unknown): string | null {
  if (value == null) return null;
  const url = String(value).trim();
  return url || null;
}

/**
 * mapにキーがある: entry.icon_urlを採用（nullなら汎用＝呼び出し側）。
 * mapにキーがない: legacyIconUrlを後方互換として採用。
 */
export function resolveProjectedIcon(args: {
  xUserId: string | null | undefined;
  iconMap: ReadonlyMap<string, PublicXIconEntry> | null | undefined;
  legacyIconUrl?: unknown;
}): string | null {
  const xId = normalizeXId(args.xUserId ?? "");
  if (!xId) {
    return normalizePublicIconUrl(args.legacyIconUrl);
  }
  const entry = args.iconMap?.get(xId);
  if (entry) {
    return normalizePublicIconUrl(entry.icon_url);
  }
  return normalizePublicIconUrl(args.legacyIconUrl);
}

export function buildPublicXIconMapPayloadFromProjection(
  sources: {
    registeredUsers: ReadonlyArray<{
      id: string;
      icon_url: string | null;
    }>;
    iconUrls: ReadonlyMap<string, string>;
    orphans?: ReadonlyArray<{ x_id: string }>;
  },
  generatedAt: number,
): PublicXIconMapPayload {
  const entries: Record<string, PublicXIconEntry> = {};

  for (const user of sources.registeredUsers) {
    const xId = normalizeXId(user.id);
    if (!xId) continue;
    const registered = normalizePublicIconUrl(user.icon_url);
    const historical =
      normalizePublicIconUrl(sources.iconUrls.get(user.id)) ??
      normalizePublicIconUrl(sources.iconUrls.get(xId));
    entries[xId] = registered
      ? { icon_url: registered, source: "registered" }
      : historical
        ? { icon_url: historical, source: "video" }
        : { icon_url: null, source: "none" };
  }

  for (const orphan of sources.orphans ?? []) {
    const xId = normalizeXId(orphan.x_id);
    if (!xId || entries[xId]) continue;
    const historical =
      normalizePublicIconUrl(sources.iconUrls.get(orphan.x_id)) ??
      normalizePublicIconUrl(sources.iconUrls.get(xId));
    if (!historical) continue;
    entries[xId] = { icon_url: historical, source: "video" };
  }

  return {
    schema_version: PUBLIC_X_ICON_MAP_SCHEMA_VERSION,
    generated_at: generatedAt,
    entries,
  };
}

export function normalizePublicXIconMap(
  value: unknown,
): PublicXIconMapPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as {
    schema_version?: unknown;
    generated_at?: unknown;
    entries?: unknown;
  };
  if (Number(payload.schema_version) !== 1) return null;
  if (!payload.entries || typeof payload.entries !== "object") return null;

  const entries: Record<string, PublicXIconEntry> = {};
  for (const [rawXId, rawEntry] of Object.entries(
    payload.entries as Record<string, unknown>,
  )) {
    const xId = normalizeXId(rawXId);
    if (!xId || !rawEntry || typeof rawEntry !== "object") continue;
    const entry = rawEntry as { icon_url?: unknown; source?: unknown };
    const source = entry.source;
    if (source !== "registered" && source !== "video" && source !== "none") {
      continue;
    }
    entries[xId] = {
      icon_url: normalizePublicIconUrl(entry.icon_url),
      source,
    };
  }

  const generated = Number(payload.generated_at);
  return {
    schema_version: 1,
    generated_at: Number.isFinite(generated) ? Math.floor(generated) : 0,
    entries,
  };
}

export function publicXIconEntriesToMap(
  payload: PublicXIconMapPayload | null | undefined,
): Map<string, PublicXIconEntry> {
  const map = new Map<string, PublicXIconEntry>();
  if (!payload) return map;
  for (const [xId, entry] of Object.entries(payload.entries)) {
    map.set(xId, entry);
  }
  return map;
}

export function publicXIconMapByteLength(
  payload: PublicXIconMapPayload,
): number {
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
}
