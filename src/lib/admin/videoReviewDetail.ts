import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  eventCustomQuestions,
  videoChapters,
  videoCustomAnswers,
  videoEvents,
  videoMembers,
  videos,
} from "@/lib/db/schema";
import { readStagePermissionCustomAnswers } from "@/lib/video/stagePermissionAnswers";
import { getVideoSoftwareLabel } from "@/lib/db/software";
import { formatChapterTime } from "@/lib/utils/chapterTime";
import { formatVideoReviewAnswer } from "./videoReviewAnswer";

// Keep event/question IN predicates below D1's 100-bind ceiling even for
// imported detail rows that predate the four-event write limit.
const D1_REVIEW_ID_CHUNK_SIZE = 80;

function chunkReviewIds(ids: readonly string[]): string[][] {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += D1_REVIEW_ID_CHUNK_SIZE) {
    chunks.push(unique.slice(index, index + D1_REVIEW_ID_CHUNK_SIZE));
  }
  return chunks;
}

export type VideoReviewCustomAnswer = {
  label: string;
  answer: string;
  required: boolean;
};

export type VideoReviewMember = {
  name: string;
  role: string | null;
  x_user_id: string | null;
  is_public_member: boolean;
  chapters: string | null;
};

export type VideoReviewDetail = {
  id: string;
  title: string;
  creator_name: string;
  creator_x_user_id: string | null;
  created_at: number;
  source_type: string;
  youtube_video_id: string | null;
  music: string | null;
  credit: string | null;
  intro_comment: string | null;
  highlights: string | null;
  production_story: string | null;
  stagePermission: string | null;
  visibility_status: string;
  software_label: string | null;
  event_ids: string[];
  customAnswers: VideoReviewCustomAnswer[];
  members: VideoReviewMember[];
};

type VideoReviewVideoRow = {
  id: string;
  title: string;
  creator_name: string | null;
  creator_x_user_id: string | null;
  created_at: number;
  source_type: string;
  youtube_video_id: string | null;
  music: string | null;
  credit: string | null;
  intro_comment: string | null;
  highlights: string | null;
  production_story: string | null;
  visibility_status: string;
};

const videoReviewVideoSelect = {
  id: videos.id,
  title: videos.title,
  creator_name: videos.creator_display_name,
  creator_x_user_id: videos.creator_x_user_id,
  created_at: videos.created_at,
  source_type: videos.source_type,
  youtube_video_id: videos.youtube_video_id,
  music: videos.music,
  credit: videos.credit,
  intro_comment: videos.intro_comment,
  highlights: videos.highlights,
  production_story: videos.production_story,
  visibility_status: videos.visibility_status,
} as const;

async function buildVideoReviewDetail(
  db: DB,
  video: VideoReviewVideoRow,
  linkedEventIds: readonly string[],
): Promise<VideoReviewDetail> {
  const normalizedEventIds = Array.from(new Set(linkedEventIds.filter(Boolean)));

  const stagePermission = await readStagePermissionCustomAnswers(db, {
    videoId: video.id,
    eventIds: normalizedEventIds,
  });

  const questions: Array<{
    id: string;
    label: string;
    required: number;
    question_key: string;
  }> = [];
  for (const eventIdChunk of chunkReviewIds(normalizedEventIds)) {
    const chunkQuestions = await db
      .select({
        id: eventCustomQuestions.id,
        label: eventCustomQuestions.label,
        required: eventCustomQuestions.required,
        question_key: eventCustomQuestions.question_key,
      })
      .from(eventCustomQuestions)
      .where(inArray(eventCustomQuestions.event_id, eventIdChunk));
    questions.push(...chunkQuestions);
  }

  const nonStageQuestions = questions.filter(
    (question) => !question.question_key.startsWith("stage_permission"),
  );
  const answers: Array<{
    question_id: string;
    answer_text: string | null;
    answer_json: string | null;
  }> = [];
  for (const questionIdChunk of chunkReviewIds(
    nonStageQuestions.map((question) => question.id),
  )) {
    const chunkAnswers = await db
      .select({
        question_id: videoCustomAnswers.question_id,
        answer_text: videoCustomAnswers.answer_text,
        answer_json: videoCustomAnswers.answer_json,
      })
      .from(videoCustomAnswers)
      .where(
        and(
          eq(videoCustomAnswers.video_id, video.id),
          inArray(videoCustomAnswers.question_id, questionIdChunk),
        )!,
      );
    answers.push(...chunkAnswers);
  }
  const answerMap = new Map(
    answers.map((answer) => [
      answer.question_id,
      formatVideoReviewAnswer(answer.answer_text, answer.answer_json),
    ]),
  );

  const members = await db
    .select({
      name: videoMembers.name,
      role: videoMembers.role,
      x_user_id: videoMembers.x_user_id,
      is_public_member: videoMembers.is_public_member,
    })
    .from(videoMembers)
    .where(eq(videoMembers.video_id, video.id))
    .orderBy(asc(videoMembers.order_index));

  const chapters = await db
    .select({
      x_user_id: videoChapters.x_user_id,
      chapter_time: videoChapters.chapter_time,
      chapter_label: videoChapters.chapter_label,
    })
    .from(videoChapters)
    .where(eq(videoChapters.video_id, video.id))
    .orderBy(asc(videoChapters.chapter_time), asc(videoChapters.id));
  const chaptersByXUserId = new Map<string, string[]>();
  for (const chapter of chapters) {
    if (!chapter.x_user_id) continue;
    const labels = chaptersByXUserId.get(chapter.x_user_id) ?? [];
    labels.push(`${formatChapterTime(chapter.chapter_time)} ${chapter.chapter_label}`);
    chaptersByXUserId.set(chapter.x_user_id, labels);
  }

  return {
    id: video.id,
    title: video.title,
    creator_name: video.creator_name ?? video.creator_x_user_id ?? "—",
    creator_x_user_id: video.creator_x_user_id,
    created_at: video.created_at,
    source_type: video.source_type,
    youtube_video_id: video.youtube_video_id,
    music: video.music,
    credit: video.credit,
    intro_comment: video.intro_comment,
    highlights: video.highlights,
    production_story: video.production_story,
    stagePermission,
    visibility_status: video.visibility_status,
    software_label: await getVideoSoftwareLabel(db, video.id),
    event_ids: normalizedEventIds,
    customAnswers: nonStageQuestions.map((question) => ({
      label: question.label,
      required: question.required === 1,
      answer: answerMap.get(question.id)?.trim() || "（未回答）",
    })),
    members: members.map((member) => ({
      name: member.name,
      role: member.role,
      x_user_id: member.x_user_id,
      is_public_member: member.is_public_member === 1,
      chapters: member.x_user_id
        ? chaptersByXUserId.get(member.x_user_id)?.join(", ") ?? null
        : null,
    })),
  };
}

export async function fetchVideoReviewDetail(
  db: DB,
  videoId: string,
  eventIds?: readonly string[],
): Promise<VideoReviewDetail | null> {
  const video = (
    await db
      .select(videoReviewVideoSelect)
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1)
  )[0] as VideoReviewVideoRow | undefined;
  if (!video) return null;

  const linkedEventIds =
    eventIds && eventIds.length > 0
      ? [...eventIds]
      : (
          await db
            .select({ event_id: videoEvents.event_id })
            .from(videoEvents)
            .where(eq(videoEvents.video_id, videoId))
        ).map((row) => row.event_id);

  return buildVideoReviewDetail(db, video, linkedEventIds);
}

/**
 * Event-scoped detail loader for manage review pages.
 *
 * The membership guard and video projection intentionally share one indexed
 * query. A separate guard query followed by fetchVideoReviewDetail would
 * re-read the same video row and could not improve the 404 semantics.
 */
export async function fetchEventVideoReviewDetail(
  db: DB,
  eventId: string,
  videoId: string,
): Promise<VideoReviewDetail | null> {
  const video = (
    await db
      .select({
        ...videoReviewVideoSelect,
        event_id: videoEvents.event_id,
      })
      .from(videos)
      .innerJoin(videoEvents, eq(videoEvents.video_id, videos.id))
      .where(
        and(
          eq(videos.id, videoId),
          eq(videoEvents.event_id, eventId),
        )!,
      )
      .limit(1)
  )[0];
  if (!video) return null;

  return buildVideoReviewDetail(db, video, [video.event_id]);
}
