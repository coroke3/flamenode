export type YoutubeRelatedBlockReason =
  | "private"
  | "missing_or_private";

export interface YoutubeRelatedBlocklistPayload {
  schema_version: 1;
  generated_at: number;
  blocked: Record<string, YoutubeRelatedBlockReason>;
}

export interface YoutubeRelatedBlocklist {
  generatedAt: number | null;
  blockedIds: ReadonlySet<string>;
  reasons: ReadonlyMap<string, YoutubeRelatedBlockReason>;
}

export const YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY =
  "youtube/related-blocklist.v1.json";
export const YOUTUBE_RELATED_BLOCKLIST_SCHEMA_VERSION = 1 as const;
export const YOUTUBE_RELATED_BLOCKLIST_MAX_OBJECT_BYTES = 2 * 1024 * 1024;
export const YOUTUBE_RELATED_BLOCKLIST_STALE_MAX_AGE_SEC = 24 * 60 * 60;

export const EMPTY_YOUTUBE_RELATED_BLOCKLIST: YoutubeRelatedBlocklist = {
  generatedAt: null,
  blockedIds: new Set(),
  reasons: new Map(),
};

export function normalizeYoutubeRelatedBlocklist(
  value: unknown,
): YoutubeRelatedBlocklist | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as {
    schema_version?: unknown;
    generated_at?: unknown;
    blocked?: unknown;
  };
  if (Number(payload.schema_version) !== 1) return null;
  if (!payload.blocked || typeof payload.blocked !== "object") return null;

  const reasons = new Map<string, YoutubeRelatedBlockReason>();
  for (const [rawId, rawReason] of Object.entries(
    payload.blocked as Record<string, unknown>,
  )) {
    const id = rawId.trim();
    if (!id) continue;
    if (rawReason !== "private" && rawReason !== "missing_or_private") {
      continue;
    }
    reasons.set(id, rawReason);
  }

  const generated = Number(payload.generated_at);
  if (!Number.isFinite(generated) || generated <= 0) {
    return null;
  }

  return {
    generatedAt: Math.floor(generated),
    blockedIds: new Set(reasons.keys()),
    reasons,
  };
}

export function buildYoutubeRelatedBlocklistPayload(
  blocked: ReadonlyMap<string, YoutubeRelatedBlockReason>,
  generatedAt: number,
): YoutubeRelatedBlocklistPayload {
  const blockedRecord: Record<string, YoutubeRelatedBlockReason> = {};
  for (const [id, reason] of blocked) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    blockedRecord[trimmed] = reason;
  }
  return {
    schema_version: YOUTUBE_RELATED_BLOCKLIST_SCHEMA_VERSION,
    generated_at: generatedAt,
    blocked: blockedRecord,
  };
}
