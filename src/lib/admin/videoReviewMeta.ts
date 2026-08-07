import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  eventCustomQuestions,
  videoCustomAnswers,
  videoEvents,
} from "@/lib/db/schema";
import { batchReadStagePermissionCustomAnswers } from "@/lib/video/stagePermissionAnswers";

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
  if (videoIds.length === 0) return out;

  const eventLinks = await db
    .select({
      video_id: videoEvents.video_id,
      event_id: videoEvents.event_id,
    })
    .from(videoEvents)
    .where(
      and(
        inArray(videoEvents.video_id, [...videoIds]),
        eventId ? eq(videoEvents.event_id, eventId) : undefined,
      )!,
    );

  const eventIdsByVideo = new Map<string, string[]>();
  for (const row of eventLinks) {
    const list = eventIdsByVideo.get(row.video_id) ?? [];
    list.push(row.event_id);
    eventIdsByVideo.set(row.video_id, list);
  }

  const stagePermissions = await batchReadStagePermissionCustomAnswers(
    db,
    videoIds.map((videoId) => ({
      videoId,
      eventIds: eventIdsByVideo.get(videoId) ?? [],
    })),
  );

  for (const videoId of videoIds) {
    const stagePermission = stagePermissions.get(videoId) ?? null;
    out.set(videoId, {
      stage_permission_summary: summarizeStagePermission(stagePermission),
      required_unanswered_count: 0,
    });
  }

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
        inArray(videoEvents.video_id, [...videoIds]),
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

  return out;
}
