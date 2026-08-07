import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { videoEvents } from "@/lib/db/schema";
import { MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS } from "@/lib/staticRebuild/hooks";

export const SAME_VIDEO_STATUS_MESSAGE = "すでに同じ状態へ更新されています。";

export function monotonicVideoUpdatedAt(
  videoUpdatedAt: number,
  nowSec = Math.floor(Date.now() / 1000),
): number {
  return Math.max(nowSec, videoUpdatedAt + 1);
}

export function mergeVideoRebuildEventIds(
  primaryEventId: string | null | undefined,
  linkedEventIds: readonly string[],
): string[] {
  return Array.from(
    new Set(
      [primaryEventId, ...linkedEventIds].filter((id): id is string => Boolean(id)),
    ),
  );
}

export async function loadVideoRebuildEventIds(
  db: DB,
  videoId: string,
  primaryEventId: string | null | undefined,
): Promise<{ ok: true; eventIds: string[] } | { ok: false; message: string }> {
  const eventRows = await db
    .select({ event_id: videoEvents.event_id })
    .from(videoEvents)
    .where(eq(videoEvents.video_id, videoId))
    .limit(MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS + 1);
  const eventIds = mergeVideoRebuildEventIds(
    primaryEventId,
    eventRows.map((row) => row.event_id),
  );
  if (eventIds.length > MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS) {
    return {
      ok: false,
      message: "関連イベント数が処理上限を超えています。",
    };
  }
  return { ok: true, eventIds };
}
