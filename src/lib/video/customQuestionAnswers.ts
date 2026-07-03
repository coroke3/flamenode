import { and, eq, inArray, not } from "drizzle-orm";
import type { getDatabase } from "@/lib/cloudflare";
import {
  eventCustomQuestions,
  videoCustomAnswers,
} from "@/lib/db/schema";
import {
  type CustomAnswerDraft,
  type CustomQuestion,
  rowToQuestion,
} from "./customQuestions";
import { stagePermissionQuestionKeyCondition } from "./stagePermissionAnswers";

type DB = NonNullable<ReturnType<typeof getDatabase>>;

export async function replaceGeneralCustomAnswers(
  db: DB,
  args: {
    videoId: string;
    eventIds: readonly string[];
    drafts: CustomAnswerDraft[];
    now: number;
  },
): Promise<void> {
  const eventIds = Array.from(new Set(args.eventIds.filter(Boolean)));
  if (eventIds.length === 0) return;

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
        not(stagePermissionQuestionKeyCondition()),
      )!,
    );

  if (questions.length === 0) return;

  const questionIds = questions.map((q) => q.id);
  const draftByQuestionId = new Map(
    args.drafts.map((draft) => [draft.question_id, draft]),
  );

  await db
    .delete(videoCustomAnswers)
    .where(
      and(
        eq(videoCustomAnswers.video_id, args.videoId),
        inArray(videoCustomAnswers.event_id, eventIds),
        inArray(videoCustomAnswers.question_id, questionIds),
      )!,
    );

  for (const question of questions) {
    const draft = draftByQuestionId.get(question.id);
    if (!draft) continue;
    const hasText = Boolean(draft.answer_text?.trim());
    const hasJson = Boolean(draft.answer_json?.trim());
    if (!hasText && !hasJson) continue;

    await db.insert(videoCustomAnswers).values({
      video_id: args.videoId,
      event_id: question.event_id,
      question_id: question.id,
      answer_text: draft.answer_text,
      answer_json: draft.answer_json,
      created_at: args.now,
      updated_at: args.now,
    });
  }
}

export async function fetchActiveCustomQuestionsForEvents(
  db: DB,
  eventIds: readonly string[],
): Promise<Map<string, CustomQuestion[]>> {
  const ids = Array.from(new Set(eventIds.filter(Boolean)));
  const out = new Map<string, CustomQuestion[]>();
  if (ids.length === 0) return out;

  const rows = await db
    .select()
    .from(eventCustomQuestions)
    .where(
      and(
        inArray(eventCustomQuestions.event_id, ids),
        eq(eventCustomQuestions.is_active, 1),
        not(stagePermissionQuestionKeyCondition()),
      )!,
    )
    .orderBy(eventCustomQuestions.sort_order);

  for (const row of rows) {
    const list = out.get(row.event_id) ?? [];
    list.push(rowToQuestion(row));
    out.set(row.event_id, list);
  }
  return out;
}
