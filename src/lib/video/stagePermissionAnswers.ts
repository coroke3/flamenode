import { and, eq, inArray, or, sql } from "drizzle-orm";
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
import {
  compositeAuditTargetId,
  emptyVideoAtomicWritePlan,
  type VideoAtomicWritePlan,
} from "./atomicWritePlanCore.ts";
import { expectedRowCondition } from "../audit/expectedRowCondition.ts";

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
    )
    .limit(5);
  if (questions.length > 4) {
    throw new Error("video_stage_answer_read_limit_exceeded");
  }
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
    )
    .limit(5);
  if (answers.length > 4) {
    throw new Error("video_stage_answer_read_limit_exceeded");
  }
  const answerByQuestionId = new Map(
    answers.map((answer) => [answer.question_id, answer.answer_text ?? ""]),
  );

  return serializeStagePermissionFromRows(args.eventIds, questions, answerByQuestionId);
}

type StagePermissionQuestionRow = {
  id: string;
  event_id: string;
  question_key: string;
  label: string;
  sort_order: number;
  is_active: number;
};

function serializeStagePermissionFromRows(
  eventIds: readonly string[],
  questions: readonly StagePermissionQuestionRow[],
  answerByQuestionId: ReadonlyMap<string, string>,
): string | null {
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

/** Batch-read stage permission answers for many videos (fixed query count). */
export async function batchReadStagePermissionCustomAnswers(
  db: DB,
  items: ReadonlyArray<{ videoId: string; eventIds: readonly string[] }>,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (items.length === 0) return out;

  const eventIds = Array.from(
    new Set(items.flatMap((item) => item.eventIds.filter(Boolean))),
  );
  if (eventIds.length === 0) {
    for (const item of items) out.set(item.videoId, null);
    return out;
  }

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

  const questionsByEvent = new Map<string, StagePermissionQuestionRow[]>();
  for (const question of questions) {
    const list = questionsByEvent.get(question.event_id) ?? [];
    list.push(question);
    questionsByEvent.set(question.event_id, list);
  }

  const videoIds = items.map((item) => item.videoId);
  const questionIds = questions.map((question) => question.id);
  const answers =
    questionIds.length > 0
      ? await db
          .select({
            video_id: videoCustomAnswers.video_id,
            question_id: videoCustomAnswers.question_id,
            answer_text: videoCustomAnswers.answer_text,
          })
          .from(videoCustomAnswers)
          .where(
            and(
              inArray(videoCustomAnswers.video_id, [...videoIds]),
              inArray(videoCustomAnswers.event_id, eventIds),
              inArray(videoCustomAnswers.question_id, questionIds),
            )!,
          )
      : [];

  const answersByVideo = new Map<string, Map<string, string>>();
  for (const answer of answers) {
    const byQuestion =
      answersByVideo.get(answer.video_id) ?? new Map<string, string>();
    byQuestion.set(answer.question_id, answer.answer_text ?? "");
    answersByVideo.set(answer.video_id, byQuestion);
  }

  for (const item of items) {
    const scopedEventIds = Array.from(new Set(item.eventIds.filter(Boolean)));
    const scopedQuestions = scopedEventIds.flatMap(
      (eventId) => questionsByEvent.get(eventId) ?? [],
    );
    if (scopedQuestions.length === 0) {
      out.set(item.videoId, null);
      continue;
    }
    if (scopedQuestions.length > 4) {
      throw new Error("video_stage_answer_read_limit_exceeded");
    }
    const answerByQuestionId = answersByVideo.get(item.videoId) ?? new Map();
    out.set(
      item.videoId,
      serializeStagePermissionFromRows(
        scopedEventIds,
        scopedQuestions,
        answerByQuestionId,
      ),
    );
  }

  return out;
}

export async function buildReplaceStagePermissionAnswersPlan(
  db: DB,
  args: ReplaceStagePermissionCustomAnswersArgs & { actorUserId: string },
): Promise<VideoAtomicWritePlan> {
  const eventIds = Array.from(new Set(args.eventIds.filter(Boolean)));
  const syncEventIds = computeStagePermissionAnswerDeleteEventIds({
    previousEventIds: args.deleteEventIds ?? [],
    targetEventIds: eventIds,
  });

  if (syncEventIds.length === 0) return emptyVideoAtomicWritePlan();

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
    )
    .limit(5);

  if (stageQuestions.length > 4) {
    throw new Error("video_stage_answer_atomic_limit_exceeded");
  }
  const questionIds = stageQuestions.map((question) => question.id);
  const existing = questionIds.length > 0
    ? await db
        .select()
        .from(videoCustomAnswers)
        .where(and(
          eq(videoCustomAnswers.video_id, args.videoId),
          inArray(videoCustomAnswers.event_id, syncEventIds),
          inArray(videoCustomAnswers.question_id, questionIds),
        )!)
        .limit(5)
    : [];
  if (existing.length > 4) {
    throw new Error("video_stage_answer_existing_atomic_limit_exceeded");
  }

  const submitted = new Map(
    parseStagePermissionAnswers(args.stagePermission).map((answer) => [
      answer.id,
      answer.value,
    ]),
  );
  const plan = emptyVideoAtomicWritePlan();
  if (existing.length > 0) {
    plan.statements.push(db.delete(videoCustomAnswers).where(or(...existing.map((row) => and(
      eq(videoCustomAnswers.video_id, row.video_id),
      eq(videoCustomAnswers.event_id, row.event_id),
      eq(videoCustomAnswers.question_id, row.question_id),
      expectedRowCondition({ expectedCurrent: row }),
    )!))!));
    plan.expectedChanges.push(existing.length);
    plan.audits.push(...existing.map((row) => ({
      table_name: "video_custom_answers",
      target_id: compositeAuditTargetId(row.video_id, row.event_id, row.question_id),
      operation: "DELETE" as const,
      before: { ...row },
      after: null,
      actor_user_id: args.actorUserId,
      context: "video-save:stage-permission",
      retention_class: "normal" as const,
      strict: true,
    })));
  }
  if (eventIds.length === 0 || submitted.size === 0) return plan;

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

  if (values.length === 0) return plan;
  plan.statements.push(db.insert(videoCustomAnswers).values(values));
  plan.expectedChanges.push(values.length);
  plan.audits.push(...values.map((row) => ({
    table_name: "video_custom_answers",
    target_id: compositeAuditTargetId(row.video_id, row.event_id, row.question_id),
    operation: "CREATE" as const,
    before: null,
    after: { ...row },
    actor_user_id: args.actorUserId,
    context: "video-save:stage-permission",
    retention_class: "normal" as const,
    strict: true,
  })));
  return plan;
}
