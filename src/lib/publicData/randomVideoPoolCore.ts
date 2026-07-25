import type { StaticRelatedVideo } from "./staticVideoDetailCore";
import {
  normalizeCoercedString as normalizeNullableString,
  normalizeNullableUnix,
  normalizeTrimmedString,
} from "./normalize";

export const RANDOM_VIDEO_POOL_OBJECT_KEY = "videos/random-pool.v1.json";
export const RANDOM_VIDEO_POOL_SCHEMA_VERSION = 1 as const;
export const RANDOM_VIDEO_POOL_MAX_OBJECT_BYTES = 8 * 1024 * 1024;

export interface RandomVideoPoolPayload {
  schema_version: 1;
  generated_at: number;
  generation_key: string;
  items: StaticRelatedVideo[];
}

export interface RandomVideoPool {
  generatedAt: number | null;
  generationKey: string | null;
  items: StaticRelatedVideo[];
}

export const EMPTY_RANDOM_VIDEO_POOL: RandomVideoPool = {
  generatedAt: null,
  generationKey: null,
  items: [],
};

function normalizeRelatedItem(value: unknown): StaticRelatedVideo | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = normalizeTrimmedString(row.id);
  const title = normalizeTrimmedString(row.title);
  const displayName = normalizeTrimmedString(row.display_name);
  if (!id || !title || !displayName) return null;
  return {
    id,
    title,
    youtube_video_id: normalizeNullableString(row.youtube_video_id),
    display_name: displayName,
    icon_url: normalizeNullableString(row.icon_url),
    primary_event_id: normalizeNullableString(row.primary_event_id),
    scheduled_time: normalizeNullableUnix(row.scheduled_time),
  };
}

export function normalizeRandomVideoPool(
  value: unknown,
): RandomVideoPool | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as {
    schema_version?: unknown;
    generated_at?: unknown;
    generation_key?: unknown;
    items?: unknown;
  };
  if (Number(payload.schema_version) !== 1) return null;
  if (!Array.isArray(payload.items)) return null;

  const seen = new Set<string>();
  const items: StaticRelatedVideo[] = [];
  for (const entry of payload.items) {
    const item = normalizeRelatedItem(entry);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }

  const generated = Number(payload.generated_at);
  const generationKey =
    typeof payload.generation_key === "string" &&
    payload.generation_key.trim()
      ? payload.generation_key.trim()
      : null;

  return {
    generatedAt: Number.isFinite(generated) ? Math.floor(generated) : null,
    generationKey,
    items,
  };
}

/** generated_atを含めず、ソート済みmeaningful itemsだけからkey材料を作る。 */
export function buildRandomPoolGenerationMaterial(
  items: readonly StaticRelatedVideo[],
): string {
  return items
    .map((item) => item.id)
    .filter(Boolean)
    .sort()
    .join("\n");
}
