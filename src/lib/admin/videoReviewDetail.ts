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
import { readStagePermissionCustomAnswers } from "@/lib/video/stagePermissionAnswers";
import { getVideoSoftwareLabel } from "@/lib/db/software";

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
  stagePermission: string | null;
  visibility_status: string;
  software_label: string | null;
  event_ids: string[];
  customAnswers: VideoReviewCustomAnswer[];
  members: VideoReviewMember[];
};

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

  const linkedEventIds =
    eventIds && eventIds.length > 0
      ? [...eventIds]
      : video.primary_event_id
        ? [video.primary_event_id]
        : [];

  const stagePermission = await readStagePermissionCustomAnswers(db, {
    videoId,
    eventIds: linkedEventIds,
  });

  const questions =
    linkedEventIds.length > 0
      ? await db
          .select({
            id: eventCustomQuestions.id,
            label: eventCustomQuestions.label,
            required: eventCustomQuestions.required,
            question_key: eventCustomQuestions.question_key,
          })
          .from(eventCustomQuestions)
          .where(inArray(eventCustomQuestions.event_id, linkedEventIds))
      : [];

  const nonStageQuestions = questions.filter(
    (question) => !question.question_key.startsWith("stage_permission"),
  );
  const answers =
    nonStageQuestions.length > 0
      ? await db
          .select({
            question_id: videoCustomAnswers.question_id,
            answer_text: videoCustomAnswers.answer_text,
          })
          .from(videoCustomAnswers)
          .where(
            and(
              eq(videoCustomAnswers.video_id, videoId),
              inArray(
                videoCustomAnswers.question_id,
                nonStageQuestions.map((question) => question.id),
              ),
            )!,
          )
      : [];
  const answerMap = new Map(
    answers.map((answer) => [answer.question_id, answer.answer_text ?? ""]),
  );

  const members = await db
    .select({
      name: videoMembers.name,
      role: videoMembers.role,
      x_user_id: videoMembers.x_user_id,
      is_public_member: videoMembers.is_public_member,
    })
    .from(videoMembers)
    .where(eq(videoMembers.video_id, videoId))
    .orderBy(asc(videoMembers.order_index));

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
    stagePermission,
    visibility_status: video.visibility_status,
    software_label: await getVideoSoftwareLabel(db, videoId),
    event_ids: linkedEventIds,
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
    })),
  };
}
