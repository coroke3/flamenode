import { and, eq, inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  eventCustomQuestions,
  videoCustomAnswers,
} from "@/lib/db/schema";
import { parseStagePermissionAnswers } from "@/lib/video/formSettings";
import { computeStagePermissionAnswerDeleteEventIds } from "@/lib/video/eventSync";

type DB = NonNullable<ReturnType<typeof getDatabase>>;

export interface ReplaceStagePermissionCustomAnswersArgs {
  videoId: string;
  eventIds: string[];
  deleteEventIds?: string[];
  stagePermission: string | null;
  now: number;
}

/** Syncs stage-permission answers into normalized custom answer rows. */
export async function replaceStagePermissionCustomAnswers(
  db: DB,
  args: ReplaceStagePermissionCustomAnswersArgs,
): Promise<void> {
  const eventIds = Array.from(new Set(args.eventIds.filter(Boolean)));
  const deleteEventIds = computeStagePermissionAnswerDeleteEventIds({
    previousEventIds: args.deleteEventIds ?? [],
    targetEventIds: eventIds,
  });

  if (deleteEventIds.length > 0) {
    await db
      .delete(videoCustomAnswers)
      .where(
        and(
          eq(videoCustomAnswers.video_id, args.videoId),
          inArray(videoCustomAnswers.event_id, deleteEventIds),
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

  const questions = await db
    .select({
      id: eventCustomQuestions.id,
      event_id: eventCustomQuestions.event_id,
      question_key: eventCustomQuestions.question_key,
    })
    .from(eventCustomQuestions)
    .where(
      and(
        inArray(eventCustomQuestions.event_id, eventIds),
        eq(eventCustomQuestions.is_active, 1),
      )!,
    );

  const values = questions
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
