import { and, eq, inArray, sql } from "drizzle-orm";
import type { getDatabase } from "../cloudflare.ts";
import {
  eventCustomQuestions,
  videoCustomAnswers,
} from "../db/schema.ts";
import {
  DEFAULT_STAGE_PERMISSION_QUESTION_KEY,
  parseStagePermissionAnswers,
  serializeStagePermissionAnswers,
} from "./formSettings.ts";
import { computeStagePermissionAnswerDeleteEventIds } from "./eventSync.ts";

type DB = NonNullable<ReturnType<typeof getDatabase>>;

const STAGE_PERMISSION_KEY_PREFIX = `${DEFAULT_STAGE_PERMISSION_QUESTION_KEY}_`;

export interface ReplaceStagePermissionCustomAnswersArgs {
  videoId: string;
  eventIds: string[];
  deleteEventIds?: string[];
  stagePermission: string | null;
  now: number;
}

export function stagePermissionQuestionKeyCondition() {
  return sql`(${eventCustomQuestions.question_key} = ${DEFAULT_STAGE_PERMISSION_QUESTION_KEY} OR substr(${eventCustomQuestions.question_key}, 1, ${STAGE_PERMISSION_KEY_PREFIX.length}) = ${STAGE_PERMISSION_KEY_PREFIX})`;
}

export async function readStagePermissionCustomAnswers(
  db: DB,
  args: {
    videoId: string;
    eventIds: readonly string[];
  },
): Promise<string | null> {
  const eventIds = Array.from(new Set(args.eventIds.filter(Boolean)));
  if (eventIds.length === 0) return null;

  const questions = await db
    .select({
      id: eventCustomQuestions.id,
      event_id: eventCustomQuestions.event_id,
      question_key: eventCustomQuestions.question_key,
      label: eventCustomQuestions.label,
      sort_order: eventCustomQuestions.sort_order,
      is_active: eventCustomQuestions.is_active,
    })
    .from(eventCustomQuestions)
    .where(
      and(
        inArray(eventCustomQuestions.event_id, eventIds),
        stagePermissionQuestionKeyCondition(),
      )!,
    );
  if (questions.length === 0) return null;

  const answers = await db
    .select({
      question_id: videoCustomAnswers.question_id,
      answer_text: videoCustomAnswers.answer_text,
    })
    .from(videoCustomAnswers)
    .where(
      and(
        eq(videoCustomAnswers.video_id, args.videoId),
        inArray(videoCustomAnswers.event_id, eventIds),
        inArray(
          videoCustomAnswers.question_id,
          questions.map((question) => question.id),
        ),
      )!,
    );
  const answerByQuestionId = new Map(
    answers.map((answer) => [answer.question_id, answer.answer_text ?? ""]),
  );

  const serialized = serializeStagePermissionAnswers(
    questions
      .filter((question) => question.is_active === 1)
      .sort((a, b) =>
        a.event_id === b.event_id
          ? a.sort_order - b.sort_order
          : eventIds.indexOf(a.event_id) - eventIds.indexOf(b.event_id),
      )
      .map((question) => ({
        id: question.question_key,
        label: question.label,
        value: answerByQuestionId.get(question.id)?.trim() ?? "",
      })),
  );

  return serialized;
}

/** Syncs stage-permission answers into normalized custom answer rows. */
export async function replaceStagePermissionCustomAnswers(
  db: DB,
  args: ReplaceStagePermissionCustomAnswersArgs,
): Promise<void> {
  const eventIds = Array.from(new Set(args.eventIds.filter(Boolean)));
  const syncEventIds = computeStagePermissionAnswerDeleteEventIds({
    previousEventIds: args.deleteEventIds ?? [],
    targetEventIds: eventIds,
  });

  if (syncEventIds.length === 0) return;

  const stageQuestions = await db
    .select({
      id: eventCustomQuestions.id,
      event_id: eventCustomQuestions.event_id,
      question_key: eventCustomQuestions.question_key,
      is_active: eventCustomQuestions.is_active,
    })
    .from(eventCustomQuestions)
    .where(
      and(
        inArray(eventCustomQuestions.event_id, syncEventIds),
        stagePermissionQuestionKeyCondition(),
      )!,
    );

  if (stageQuestions.length > 0) {
    await db
      .delete(videoCustomAnswers)
      .where(
        and(
          eq(videoCustomAnswers.video_id, args.videoId),
          inArray(videoCustomAnswers.event_id, syncEventIds),
          inArray(
            videoCustomAnswers.question_id,
            stageQuestions.map((question) => question.id),
          ),
        )!,
      );
  }

  if (eventIds.length === 0) return;

  const submitted = new Map(
    parseStagePermissionAnswers(args.stagePermission).map((answer) => [
      answer.id,
      answer.value,
    ]),
  );
  if (submitted.size === 0) return;

  const eventIdSet = new Set(eventIds);
  const values = stageQuestions
    .filter(
      (question) =>
        eventIdSet.has(question.event_id) && question.is_active === 1,
    )
    .map((question) => {
      const value = submitted.get(question.question_key)?.trim();
      if (!value) return null;
      return {
        video_id: args.videoId,
        event_id: question.event_id,
        question_id: question.id,
        answer_text: value,
        answer_json: null,
        created_at: args.now,
        updated_at: args.now,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (values.length === 0) return;
  await db.insert(videoCustomAnswers).values(values).onConflictDoNothing();
}
