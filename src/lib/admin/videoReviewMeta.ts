import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  eventCustomQuestions,
  videoCustomAnswers,
  videoEvents,
} from "@/lib/db/schema";
import { formatCustomAnswerValue } from "@/lib/video/customQuestions";

export type VideoReviewSummary = {
  /** 互換フィールド名。内容は最初のカスタム回答概要。 */
  stage_permission_summary: string;
  required_unanswered_count: number;
};

function summarizeAnswer(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return "—";
  if (text.length <= 24) return text;
  return `${text.slice(0, 23)}…`;
}

export async function fetchVideoReviewSummaries(
  db: DB,
  videoIds: readonly string[],
  eventId?: string,
): Promise<Map<string, VideoReviewSummary>> {
  const ids = [...new Set(videoIds.filter(Boolean))];
  const out = new Map<string, VideoReviewSummary>();
  for (const videoId of ids) {
    out.set(videoId, {
      stage_permission_summary: "—",
      required_unanswered_count: 0,
    });
  }
  if (ids.length === 0) return out;

  const rows = await db
    .select({
      video_id: videoEvents.video_id,
      question_id: eventCustomQuestions.id,
      required: eventCustomQuestions.required,
      answer_text: videoCustomAnswers.answer_text,
      answer_json: videoCustomAnswers.answer_json,
    })
    .from(videoEvents)
    .innerJoin(
      eventCustomQuestions,
      and(
        eq(eventCustomQuestions.event_id, videoEvents.event_id),
        eq(eventCustomQuestions.is_active, 1),
      )!,
    )
    .leftJoin(
      videoCustomAnswers,
      and(
        eq(videoCustomAnswers.video_id, videoEvents.video_id),
        eq(videoCustomAnswers.event_id, videoEvents.event_id),
        eq(videoCustomAnswers.question_id, eventCustomQuestions.id),
      )!,
    )
    .where(
      and(
        inArray(videoEvents.video_id, ids),
        eventId ? eq(videoEvents.event_id, eventId) : undefined,
      )!,
    )
    .orderBy(
      asc(videoEvents.video_id),
      asc(eventCustomQuestions.sort_order),
      asc(eventCustomQuestions.id),
    );

  for (const row of rows) {
    const current = out.get(row.video_id) ?? {
      stage_permission_summary: "—",
      required_unanswered_count: 0,
    };
    const answer = formatCustomAnswerValue(row.answer_text, row.answer_json);
    if (current.stage_permission_summary === "—" && answer) {
      current.stage_permission_summary = summarizeAnswer(answer);
    }
    if (row.required === 1 && !answer) {
      current.required_unanswered_count += 1;
    }
    out.set(row.video_id, current);
  }

  return out;
}
