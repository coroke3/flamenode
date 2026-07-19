import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  eventCustomQuestions,
  videoCustomAnswers,
  videoMembers,
  videos,
  xUsers,
} from "@/lib/db/schema";
import { getVideoSoftwareLabel } from "@/lib/db/software";
import { parseMemberChaptersJson } from "@/lib/video/memberChaptersJson";
import { formatCustomAnswerValue } from "@/lib/video/customQuestions";
import { MAX_VIDEO_CUSTOM_QUESTIONS } from "@/lib/video/customQuestionLimits";

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

function formatMemberChaptersSummary(
  chaptersJson: string | null,
): string | null {
  const rows = parseMemberChaptersJson(chaptersJson);
  if (rows.length === 0) return null;
  return rows
    .map((row) => `${row.label} (${row.time_seconds})`)
    .join(" / ");
}

export async function fetchVideoReviewDetail(
  db: DB,
  videoId: string,
  eventIds?: readonly string[],
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

  const linkedEventIds = eventIds && eventIds.length > 0
    ? [...new Set(eventIds)]
    : video.primary_event_id
      ? [video.primary_event_id]
      : [];

  const questions = linkedEventIds.length > 0
    ? await db
        .select({
          id: eventCustomQuestions.id,
          label: eventCustomQuestions.label,
          required: eventCustomQuestions.required,
          sort_order: eventCustomQuestions.sort_order,
          is_active: eventCustomQuestions.is_active,
        })
        .from(eventCustomQuestions)
        .where(inArray(eventCustomQuestions.event_id, linkedEventIds))
        .orderBy(
          asc(eventCustomQuestions.sort_order),
          asc(eventCustomQuestions.created_at),
        )
        .limit(MAX_VIDEO_CUSTOM_QUESTIONS * linkedEventIds.length + 1)
    : [];

  const answers = questions.length > 0
    ? await db
        .select({
          question_id: videoCustomAnswers.question_id,
          answer_text: videoCustomAnswers.answer_text,
          answer_json: videoCustomAnswers.answer_json,
        })
        .from(videoCustomAnswers)
        .where(and(
          eq(videoCustomAnswers.video_id, videoId),
          inArray(
            videoCustomAnswers.question_id,
            questions.map((question) => question.id),
          ),
        )!)
    : [];
  const answerMap = new Map(
    answers.map((answer) => [
      answer.question_id,
      formatCustomAnswerValue(answer.answer_text, answer.answer_json),
    ]),
  );

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
    customAnswers: questions.map((question) => ({
      id: question.id,
      label: question.label,
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
