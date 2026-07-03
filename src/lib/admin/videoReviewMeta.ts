import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  eventCustomQuestions,
  videoCustomAnswers,
  videoEvents,
  videos,
} from "@/lib/db/schema";

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

  const stageRows = await db
    .select({
      id: videos.id,
      stage_permission: videos.stage_permission,
    })
    .from(videos)
    .where(inArray(videos.id, [...videoIds]));

  for (const row of stageRows) {
    out.set(row.id, {
      stage_permission_summary: summarizeStagePermission(row.stage_permission),
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
