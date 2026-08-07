import type { HomeIntroSlotStat } from "@/components/layout/HomeIntroBand";
import {
  normalizeCount,
  normalizePresentString as normalizeString,
} from "./normalize.ts";
import type { StaticTopData } from "./staticTopCore";

export const TOP_SLOT_STATS_OBJECT_KEY = "top/slot-stats.v1.json";
export const TOP_SLOT_STATS_SCHEMA_VERSION = 1 as const;
export const TOP_SLOT_STATS_MAX_OBJECT_BYTES = 64 * 1024;

export interface StaticTopSlotStatsPayload {
  schema_version?: unknown;
  generated_at?: unknown;
  items?: unknown;
}

export interface StaticTopSlotStats {
  generatedAt: number;
  items: Map<string, HomeIntroSlotStat>;
}

function normalizeSlotStatItems(value: unknown): Map<string, HomeIntroSlotStat> {
  const result = new Map<string, HomeIntroSlotStat>();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const eventId = normalizeString(row.event_id);
    if (!eventId) continue;
    result.set(eventId, {
      available: normalizeCount(row.available) ?? 0,
      total: normalizeCount(row.total) ?? 0,
    });
  }
  return result;
}

export function normalizeStaticTopSlotStats(value: unknown): StaticTopSlotStats | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as StaticTopSlotStatsPayload;
  if (Number(payload.schema_version) !== TOP_SLOT_STATS_SCHEMA_VERSION) return null;
  if (!Array.isArray(payload.items)) return null;
  const generated = Number(payload.generated_at);
  if (!Number.isFinite(generated) || generated <= 0) return null;
  return {
    generatedAt: generated,
    items: normalizeSlotStatItems(payload.items),
  };
}

/** 補助 artifact が有効なとき topSlotStats を置換する。無効時は top をそのまま返す。 */
export function applyTopSlotStatsOverride(
  top: StaticTopData,
  artifact: StaticTopSlotStats | null,
): StaticTopData {
  if (!artifact) return top;
  return { ...top, topSlotStats: artifact.items };
}

export function topSlotStatsArtifactByteLength(body: unknown): number {
  return new TextEncoder().encode(JSON.stringify(body)).byteLength;
}
