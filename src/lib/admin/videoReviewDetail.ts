import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  eventCustomQuestions,
  events,
  videoCustomAnswers,
  videoEvents,
  videoMembers,
  videos,
  xUsers,
} from "@/lib/db/schema";
import { getVideoSoftwareLabel } from "@/lib/db/software";
import { parseMemberChaptersJson } from "@/lib/video/memberChaptersJson";
import { formatCustomAnswerValue } from "@/lib/video/customQuestions";
import { MAX_ATOMIC_VIDEO_EVENTS } from "@/lib/video/atomicLimits";

const MAX_HISTORICAL_QUESTIONS_PER_EVENT = 64;
const CUSTOM_ANSWER_QUESTION_ID_BATCH_SIZE = 80;

export type VideoReviewQuestionScope = "admin" | "review";

export type VideoReviewCustomAnswer = {
  id: string;
  label: string;
  answer: string;
  required: boolean;
  active: boolean;
};

export type VideoReviewMember = {
  name: string;
  role: string | null;
  x_user_id: string | null;
  chapters: string | null;
  is_public_member: boolean;
};

export type VideoReviewDetail = {
  id: string;
  title: string;
  creator_name: string;
  creator_x_user_id: string | null;
  created_at: number;
  youtube_video_id: string | null;
  music: string | null;
  credit: string | null;
  intro_comment: string | null;
  highlights: string | null;
  production_story: string | null;
  visibility_status: string;
  software_label: string | null;
  event_ids: string[];
  customAnswers: VideoReviewCustomAnswer[];
  members: VideoReviewMember[];
};

type ReviewAnswerRow = {
  question_id: string;
  answer_text: string | null;
  answer_json: string | null;
};

function formatMemberChaptersSummary(
  chaptersJson: string | null,
): string | null {
  const rows = parseMemberChaptersJson(chaptersJson);
  if (rows.length === 0) return null;
  return rows
    .map((row) => `${row.label} (${row.time_seconds})`)
    .join(" / ");
}

function uniqueEventIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function chunkValues<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function assertReviewEventLimit(eventIds: readonly string[]): void {
  if (eventIds.length > MAX_ATOMIC_VIDEO_EVENTS) {
    throw new Error("video_review_event_limit_exceeded");
  }
}

async function resolveReviewEventIds(
  db: DB,
  videoId: string,
  primaryEventId: string | null,
  explicitEventIds?: readonly string[],
): Promise<string[]> {
  const explicit = uniqueEventIds(explicitEventIds ?? []);
  if (explicit.length > 0) {
    assertReviewEventLimit(explicit);
    return explicit;
  }

  const linkedRows = await db
    .select({ event_id: videoEvents.event_id })
    .from(videoEvents)
    .where(eq(videoEvents.video_id, videoId))
    .limit(MAX_ATOMIC_VIDEO_EVENTS + 1);
  if (linkedRows.length > MAX_ATOMIC_VIDEO_EVENTS) {
    throw new Error("video_review_event_limit_exceeded");
  }

  const linked = uniqueEventIds(linkedRows.map((row) => row.event_id));
  if (primaryEventId && !linked.includes(primaryEventId)) linked.unshift(primaryEventId);
  assertReviewEventLimit(linked);
  return linked;
}

export async function fetchVideoReviewDetail(
  db: DB,
  videoId: string,
  eventIds?: readonly string[],
  questionScope: VideoReviewQuestionScope = "admin",
): Promise<VideoReviewDetail | null> {
  const video = (
    await db
      .select({
        id: videos.id,
        title: videos.title,
        creator_name: videos.creator_display_name,
        creator_x_user_id: videos.creator_x_user_id,
        created_at: videos.created_at,
        youtube_video_id: videos.youtube_video_id,
        music: videos.music,
        credit: videos.credit,
        intro_comment: videos.intro_comment,
        highlights: videos.highlights,
        production_story: videos.production_story,
        visibility_status: videos.visibility_status,
        primary_event_id: videos.primary_event_id,
      })
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1)
  )[0];
  if (!video) return null;

  const xRow = video.creator_x_user_id
    ? (
        await db
          .select({ x_name: xUsers.x_name })
          .from(xUsers)
          .where(eq(xUsers.id, video.creator_x_user_id))
          .limit(1)
      )[0]
    : null;

  const linkedEventIds = await resolveReviewEventIds(
    db,
    video.id,
    video.primary_event_id,
    eventIds,
  );
  const eventRows = linkedEventIds.length > 0
    ? await db
        .select({ id: events.id, title: events.title })
        .from(events)
        .where(inArray(events.id, linkedEventIds))
    : [];
  const eventTitleById = new Map(eventRows.map((event) => [event.id, event.title]));
  const maxQuestionRows = Math.max(1, linkedEventIds.length) *
    MAX_HISTORICAL_QUESTIONS_PER_EVENT;
  const scopeCondition = questionScope === "admin"
    ? undefined
    : inArray(eventCustomQuestions.visibility, ["review", "public"]);

  const questions = linkedEventIds.length > 0
    ? await db
        .select({
          id: eventCustomQuestions.id,
          event_id: eventCustomQuestions.event_id,
          label: eventCustomQuestions.label,
          required: eventCustomQuestions.required,
          sort_order: eventCustomQuestions.sort_order,
          is_active: eventCustomQuestions.is_active,
        })
        .from(eventCustomQuestions)
        .where(and(
          inArray(eventCustomQuestions.event_id, linkedEventIds),
          scopeCondition,
        )!)
        .orderBy(
          asc(eventCustomQuestions.event_id),
          asc(eventCustomQuestions.sort_order),
          asc(eventCustomQuestions.created_at),
        )
        .limit(maxQuestionRows + 1)
    : [];
  if (questions.length > maxQuestionRows) {
    throw new Error("video_review_question_limit_exceeded");
  }

  const answers: ReviewAnswerRow[] = [];
  for (const questionIdChunk of chunkValues(
    questions.map((question) => question.id),
    CUSTOM_ANSWER_QUESTION_ID_BATCH_SIZE,
  )) {
    const rows = await db
      .select({
        question_id: videoCustomAnswers.question_id,
        answer_text: videoCustomAnswers.answer_text,
        answer_json: videoCustomAnswers.answer_json,
      })
      .from(videoCustomAnswers)
      .where(and(
        eq(videoCustomAnswers.video_id, videoId),
        inArray(videoCustomAnswers.question_id, questionIdChunk),
      )!)
      .limit(questionIdChunk.length + 1);
    if (rows.length > questionIdChunk.length) {
      throw new Error("video_review_answer_limit_exceeded");
    }
    answers.push(...rows);
  }
  if (answers.length > questions.length) {
    throw new Error("video_review_answer_limit_exceeded");
  }

  const answerMap = new Map(
    answers.map((answer) => [
      answer.question_id,
      formatCustomAnswerValue(answer.answer_text, answer.answer_json),
    ]),
  );
  const visibleQuestions = questions.filter(
    (question) => question.is_active === 1 || answerMap.has(question.id),
  );
  const showEventName = linkedEventIds.length > 1;

  const members = await db
    .select({
      id: videoMembers.id,
      name: videoMembers.name,
      role: videoMembers.role,
      x_user_id: videoMembers.x_user_id,
      is_public_member: videoMembers.is_public_member,
      chapters_json: videoMembers.chapters_json,
    })
    .from(videoMembers)
    .where(eq(videoMembers.video_id, videoId))
    .orderBy(asc(videoMembers.order_index));

  const softwareLabel = await getVideoSoftwareLabel(db, videoId);

  return {
    id: video.id,
    title: video.title,
    creator_name:
      xRow?.x_name ?? video.creator_name ?? video.creator_x_user_id ?? "—",
    creator_x_user_id: video.creator_x_user_id,
    created_at: video.created_at,
    youtube_video_id: video.youtube_video_id,
    music: video.music,
    credit: video.credit,
    intro_comment: video.intro_comment,
    highlights: video.highlights,
    production_story: video.production_story,
    visibility_status: video.visibility_status,
    software_label: softwareLabel,
    event_ids: linkedEventIds,
    customAnswers: visibleQuestions.map((question) => ({
      id: question.id,
      label: showEventName
        ? `${question.label}（${eventTitleById.get(question.event_id) ?? question.event_id}）`
        : question.label,
      required: question.required === 1,
      active: question.is_active === 1,
      answer: answerMap.get(question.id)?.trim() || "（未回答）",
    })),
    members: members.map((member) => ({
      name: member.name,
      role: member.role,
      x_user_id: member.x_user_id,
      chapters: formatMemberChaptersSummary(member.chapters_json),
      is_public_member: member.is_public_member === 1,
    })),
  };
}
