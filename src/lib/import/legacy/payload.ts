import { detectLegacyKind } from "./normalizeCore.ts";
import type { LegacyEventInput, LegacyVideoInput } from "./normalize.ts";

/**
 * 任意の JSON から events / videos の配列を抽出する。
 *
 * - 配列形式: `[{ eventid, ... }, ...]` / `[{ tlink, ... }, ...]`
 * - オブジェクト形式: `{ events: [...], videos: [...] }` 等
 */
export function splitLegacyPayload(raw: unknown): {
  eventInputs: LegacyEventInput[];
  videoInputs: LegacyVideoInput[];
} {
  const eventInputs: LegacyEventInput[] = [];
  const videoInputs: LegacyVideoInput[] = [];

  const pushArray = (arr: unknown[]) => {
    for (const row of arr) {
      if (!row || typeof row !== "object") continue;
      const kind = detectLegacyKind([row]);
      if (kind === "events") {
        eventInputs.push(row as LegacyEventInput);
      } else if (kind === "videos") {
        videoInputs.push(row as LegacyVideoInput);
      }
    }
  };

  if (Array.isArray(raw)) {
    pushArray(raw);
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.events)) pushArray(obj.events);
    if (Array.isArray(obj.videos)) pushArray(obj.videos);
    if (Array.isArray(obj.eventinfo)) pushArray(obj.eventinfo);
    if (Array.isArray(obj.video)) pushArray(obj.video);
    if (
      eventInputs.length === 0 &&
      videoInputs.length === 0 &&
      Array.isArray(obj.data)
    ) {
      pushArray(obj.data);
    }
  }

  return { eventInputs, videoInputs };
}
