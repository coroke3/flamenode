import { and, eq, inArray, sql } from "drizzle-orm";
import type { getDatabase } from "../cloudflare.ts";
import {
  eventCustomQuestions,
  videoCustomAnswers,
} from "../db/schema.ts";
import {
  LEGACY_STAGE_PERMISSION_ID,
  parseStagePermissionAnswers,
} from "./formSettings.ts";
import { computeStagePermissionAnswerDeleteEventIds } from "./eventSync.ts";

type DB = NonNullable<ReturnType<typeof getDatabase>>;

const STAGE_PERMISSION_KEY_PREFIX = `${LEGACY_STAGE_PERMISSION_ID}_`;

export interface ReplaceStagePermissionCustomAnswersArgs {
  videoId: string;
  eventIds: string[];
  deleteEventIds?: string[];
  stagePermission: string | null;
  now: number;
}

export function stagePermissionQuestionKeyCondition() {
  return sql`(${eventCustomQuestions.question_key} = ${LEGACY_STAGE_PERMISSION_ID} OR substr(${eventCustomQuestions.question_key}, 1, ${STAGE_PERMISSION_KEY_PREFIX.length}) = ${STAGE_PERMISSION_KEY_PREFIX})`;
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
