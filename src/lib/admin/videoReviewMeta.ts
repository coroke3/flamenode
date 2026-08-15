import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  eventCustomQuestions,
  videoCustomAnswers,
  videoEvents,
} from "@/lib/db/schema";
import { batchReadStagePermissionCustomAnswers } from "@/lib/video/stagePermissionAnswers";

const D1_SAFE_VIDEO_ID_CHUNK_SIZE = 80;

function chunkIds(ids: readonly string[]): string[][] {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += D1_SAFE_VIDEO_ID_CHUNK_SIZE) {
    chunks.push(unique.slice(index, index + D1_SAFE_VIDEO_ID_CHUNK_SIZE));
  }
  return chunks;
}

export type VideoReviewSummary = {
  stage_permission_summary: string;
  required_unanswered_count: number;
};

function summarizeStagePermission(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return "未入力";
  if (text.length <= 24) return text;
  return `${text.slice(0, 23)}…`;
}

export async function fetchVideoReviewSummaries(
  db: DB,
  videoIds: readonly string[],
  eventId?: string,
): Promise<Map<string, VideoReviewSummary>> {
  const out = new Map<string, VideoReviewSummary>();
  const uniqueVideoIds = Array.from(new Set(videoIds.filter(Boolean)));
  if (uniqueVideoIds.length === 0) return out;

  const eventIdsByVideo = new Map<string, string[]>();
  if (eventId) {
    // The caller already has an event-scoped result set. Re-reading
    // video_events here only to rediscover the same event adds one D1 read.
    for (const videoId of uniqueVideoIds) {
      eventIdsByVideo.set(videoId, [eventId]);
    }
  } else {
    for (const videoIdChunk of chunkIds(uniqueVideoIds)) {
      const eventLinks = await db
        .select({
          video_id: videoEvents.video_id,
          event_id: videoEvents.event_id,
        })
        .from(videoEvents)
        .where(inArray(videoEvents.video_id, videoIdChunk));
      for (const row of eventLinks) {
        const list = eventIdsByVideo.get(row.video_id) ?? [];
        list.push(row.event_id);
        eventIdsByVideo.set(row.video_id, list);
      }
    }
  }

  const stagePermissions = new Map<string, string | null>();
  // Keep video_id + event_id + question_id binds below D1's 100 parameter
  // limit. The stage reader enforces the per-event question limit, so 80
  // videos leaves headroom for event/question binds and fixed predicates.
  for (const videoIdChunk of chunkIds(uniqueVideoIds)) {
    const chunkPermissions = await batchReadStagePermissionCustomAnswers(
      db,
      videoIdChunk.map((videoId) => ({
        videoId,
        eventIds: eventIdsByVideo.get(videoId) ?? [],
      })),
    );
    for (const [videoId, value] of chunkPermissions) {
      stagePermissions.set(videoId, value);
    }
  }

  for (const videoId of uniqueVideoIds) {
    const stagePermission = stagePermissions.get(videoId) ?? null;
    out.set(videoId, {
      stage_permission_summary: summarizeStagePermission(stagePermission),
      required_unanswered_count: 0,
    });
  }

  for (const videoIdChunk of chunkIds(uniqueVideoIds)) {
    const missingRows = await db
      .select({
        video_id: videoEvents.video_id,
        missing_count: sql<number>`COUNT(DISTINCT ${eventCustomQuestions.id})`,
      })
      .from(videoEvents)
      .innerJoin(
        eventCustomQuestions,
        and(
          eq(eventCustomQuestions.event_id, videoEvents.event_id),
          eq(eventCustomQuestions.is_active, 1),
          eq(eventCustomQuestions.required, 1),
        )!,
      )
      .leftJoin(
        videoCustomAnswers,
        and(
          eq(videoCustomAnswers.video_id, videoEvents.video_id),
          eq(videoCustomAnswers.question_id, eventCustomQuestions.id),
          sql`trim(coalesce(${videoCustomAnswers.answer_text}, '')) <> ''`,
        )!,
      )
      .where(
        and(
          inArray(videoEvents.video_id, videoIdChunk),
          eventId ? eq(videoEvents.event_id, eventId) : undefined,
          sql`${videoCustomAnswers.video_id} IS NULL`,
        )!,
      )
      .groupBy(videoEvents.video_id);

    for (const row of missingRows) {
      const current = out.get(row.video_id) ?? {
        stage_permission_summary: "—",
        required_unanswered_count: 0,
      };
      out.set(row.video_id, {
        ...current,
        required_unanswered_count: Number(row.missing_count ?? 0),
      });
    }
  }

  return out;
}
