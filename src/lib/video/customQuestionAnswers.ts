import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { getDatabase } from "@/lib/cloudflare";
import {
  eventCustomQuestions,
  videoCustomAnswers,
} from "@/lib/db/schema";
import {
  type CustomAnswerDraft,
  type CustomQuestion,
  parseOptionsJson,
  rowToQuestion,
} from "./customQuestions";
import {
  compositeAuditTargetId,
  emptyVideoAtomicWritePlan,
  type VideoAtomicWritePlan,
} from "@/lib/video/atomicWritePlan";
import { expectedRowCondition } from "@/lib/audit/adapters";
import {
  MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS,
  MAX_ATOMIC_VIDEO_EVENTS,
} from "@/lib/video/atomicLimits";
import {
  MAX_EVENT_CUSTOM_QUESTIONS,
  MAX_VIDEO_CUSTOM_QUESTIONS,
} from "@/lib/video/customQuestionLimits";

export const MAX_VIDEO_CUSTOM_QUESTIONS_READ = MAX_VIDEO_CUSTOM_QUESTIONS;
export const MAX_VIDEO_CUSTOM_QUESTION_HISTORY_READ =
  MAX_ATOMIC_VIDEO_EVENTS * MAX_EVENT_CUSTOM_QUESTIONS;
const CUSTOM_QUESTION_EVENT_ID_BATCH_SIZE = 40;
const CUSTOM_ANSWER_DELETE_CHUNK_SIZE = MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS;

type DB = NonNullable<ReturnType<typeof getDatabase>>;
type CustomAnswerRow = typeof videoCustomAnswers.$inferSelect;

function chunkValues<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function answerTargetId(row: Pick<CustomAnswerRow, "video_id" | "event_id" | "question_id">): string {
  return compositeAuditTargetId(row.video_id, row.event_id, row.question_id);
}

function sameStoredAnswer(current: CustomAnswerRow, next: CustomAnswerRow): boolean {
  return current.answer_text === next.answer_text && current.answer_json === next.answer_json;
}

export async function buildReplaceGeneralCustomAnswersPlan(
  db: DB,
  args: {
    videoId: string;
    eventIds: readonly string[];
    deleteEventIds?: readonly string[];
    drafts: CustomAnswerDraft[];
    now: number;
    actorUserId: string;
  },
): Promise<VideoAtomicWritePlan> {
  const eventIds = Array.from(new Set(args.eventIds.filter(Boolean)));
  const deleteEventIds = Array.from(new Set(
    (args.deleteEventIds ?? []).filter((eventId) => eventId && !eventIds.includes(eventId)),
  ));
  const replaceTargetAnswers = args.drafts.length > 0;
  if (!replaceTargetAnswers && deleteEventIds.length === 0) {
    return emptyVideoAtomicWritePlan();
  }
  if (args.drafts.length > MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS) {
    throw new Error("video_custom_answer_atomic_limit_exceeded");
  }

  const questions = replaceTargetAnswers && eventIds.length > 0
    ? await db
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
        )
        .limit(MAX_VIDEO_CUSTOM_QUESTIONS_READ + 1)
    : [];
  if (questions.length > MAX_VIDEO_CUSTOM_QUESTIONS_READ) {
    throw new Error("video_custom_question_read_limit_exceeded");
  }

  const questionIds = questions.map((question) => question.id);
  const existingActive = questionIds.length > 0
    ? await db
        .select()
        .from(videoCustomAnswers)
        .where(and(
          eq(videoCustomAnswers.video_id, args.videoId),
          inArray(videoCustomAnswers.question_id, questionIds),
        )!)
        .limit(MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS + 1)
    : [];
  if (existingActive.length > MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS) {
    throw new Error("video_custom_answer_existing_atomic_limit_exceeded");
  }

  const removedEventAnswers = deleteEventIds.length > 0
    ? await db
        .select()
        .from(videoCustomAnswers)
        .where(and(
          eq(videoCustomAnswers.video_id, args.videoId),
          inArray(videoCustomAnswers.event_id, deleteEventIds),
        )!)
        .limit(MAX_VIDEO_CUSTOM_QUESTION_HISTORY_READ + 1)
    : [];
  if (removedEventAnswers.length > MAX_VIDEO_CUSTOM_QUESTION_HISTORY_READ) {
    throw new Error("video_custom_answer_removed_event_history_limit_exceeded");
  }

  const existingByTarget = new Map<string, CustomAnswerRow>();
  for (const row of [...existingActive, ...removedEventAnswers]) {
    existingByTarget.set(answerTargetId(row), row);
  }
  const existing = [...existingByTarget.values()];
  const draftByQuestionId = new Map(
    args.drafts.map((draft) => [draft.question_id, draft]),
  );

  const next: CustomAnswerRow[] = [];
  for (const question of questions) {
    const draft = draftByQuestionId.get(question.id);
    if (!draft) continue;
    const hasText = Boolean(draft.answer_text?.trim());
    const hasJson = Boolean(draft.answer_json?.trim());
    if (!hasText && !hasJson) continue;

    const targetId = compositeAuditTargetId(args.videoId, question.event_id, question.id);
    const current = existingByTarget.get(targetId);
    next.push({
      video_id: args.videoId,
      event_id: question.event_id,
      question_id: question.id,
      answer_text: draft.answer_text,
      answer_json: draft.answer_json,
      created_at: current?.created_at ?? args.now,
      updated_at: args.now,
    });
  }

  const nextTargetIds = new Set(next.map(answerTargetId));
  const stale = existing.filter((row) => !nextTargetIds.has(answerTargetId(row)));
  const changed = next.filter((row) => {
    const current = existingByTarget.get(answerTargetId(row));
    return !current || !sameStoredAnswer(current, row);
  });

  const plan = emptyVideoAtomicWritePlan();
  for (const deleteChunk of chunkValues(stale, CUSTOM_ANSWER_DELETE_CHUNK_SIZE)) {
    plan.statements.push(db.delete(videoCustomAnswers).where(or(...deleteChunk.map((row) => and(
      eq(videoCustomAnswers.video_id, row.video_id),
      eq(videoCustomAnswers.event_id, row.event_id),
      eq(videoCustomAnswers.question_id, row.question_id),
      expectedRowCondition({ expectedCurrent: row }),
    )!))!));
    plan.expectedChanges.push(deleteChunk.length);
  }
  if (stale.length > 0) {
    plan.audits.push(...stale.map((row) => ({
      table_name: "video_custom_answers",
      target_id: answerTargetId(row),
      operation: "DELETE" as const,
      before: { ...row },
      after: null,
      actor_user_id: args.actorUserId,
      context: "video-save:custom-answers",
      retention_class: "normal" as const,
      strict: true,
    })));
  }

  if (changed.length > 0) {
    plan.statements.push(
      db.insert(videoCustomAnswers)
        .values(changed)
        .onConflictDoUpdate({
          target: [
            videoCustomAnswers.video_id,
            videoCustomAnswers.event_id,
            videoCustomAnswers.question_id,
          ],
          set: {
            answer_text: sql`excluded.answer_text`,
            answer_json: sql`excluded.answer_json`,
            updated_at: sql`excluded.updated_at`,
          },
        }),
    );
    plan.expectedChanges.push(changed.length);
    plan.audits.push(...changed.map((row) => {
      const current = existingByTarget.get(answerTargetId(row));
      return {
        table_name: "video_custom_answers",
        target_id: answerTargetId(row),
        operation: current ? "UPDATE" as const : "CREATE" as const,
        before: current ? { ...current } : null,
        after: { ...row },
        actor_user_id: args.actorUserId,
        context: "video-save:custom-answers",
        retention_class: "normal" as const,
        strict: true,
      };
    }));
  }
  return plan;
}

/**
 * 候補表示用に、指定イベントそれぞれの有効質問を取得する。
 * 投稿時の合計8件制限とは分離し、イベント単位で最大8件を検証する。
 */
export async function fetchActiveCustomQuestionsForEvents(
  db: DB,
  eventIds: readonly string[],
): Promise<Map<string, CustomQuestion[]>> {
  const ids = Array.from(new Set(eventIds.filter(Boolean)));
  const out = new Map<string, CustomQuestion[]>();
  if (ids.length === 0) return out;

  for (const idChunk of chunkValues(ids, CUSTOM_QUESTION_EVENT_ID_BATCH_SIZE)) {
    const maxRows = idChunk.length * MAX_EVENT_CUSTOM_QUESTIONS;
    const rows = await db
      .select()
      .from(eventCustomQuestions)
      .where(
        and(
          inArray(eventCustomQuestions.event_id, idChunk),
          eq(eventCustomQuestions.is_active, 1),
        )!,
      )
      .orderBy(
        asc(eventCustomQuestions.event_id),
        asc(eventCustomQuestions.sort_order),
        asc(eventCustomQuestions.question_key),
      )
      .limit(maxRows + 1);
    if (rows.length > maxRows) {
      throw new Error("event_custom_question_limit_exceeded");
    }

    for (const row of rows) {
      const list = out.get(row.event_id) ?? [];
      if (list.length >= MAX_EVENT_CUSTOM_QUESTIONS) {
        throw new Error("event_custom_question_limit_exceeded");
      }
      list.push(rowToQuestion(row));
      out.set(row.event_id, list);
    }
  }

  return out;
}

export async function readCustomAnswerValuesForVideo(
  db: DB,
  args: {
    videoId: string;
    eventIds: readonly string[];
  },
): Promise<string | null> {
  const questionsByEvent = await fetchActiveCustomQuestionsForEvents(db, args.eventIds);
  const questions = [...questionsByEvent.values()].flat();
  if (questions.length === 0) return null;
  if (questions.length > MAX_VIDEO_CUSTOM_QUESTION_HISTORY_READ) {
    throw new Error("video_custom_question_history_read_limit_exceeded");
  }

  const answers = await db
    .select({
      question_id: videoCustomAnswers.question_id,
      answer_text: videoCustomAnswers.answer_text,
      answer_json: videoCustomAnswers.answer_json,
    })
    .from(videoCustomAnswers)
    .where(and(
      eq(videoCustomAnswers.video_id, args.videoId),
      inArray(videoCustomAnswers.question_id, questions.map((question) => question.id)),
    )!)
    .limit(MAX_VIDEO_CUSTOM_QUESTION_HISTORY_READ + 1);
  if (answers.length > MAX_VIDEO_CUSTOM_QUESTION_HISTORY_READ) {
    throw new Error("video_custom_answer_history_read_limit_exceeded");
  }

  const values: Record<string, string | string[]> = {};
  for (const answer of answers) {
    const text = answer.answer_text?.trim();
    if (text) {
      values[answer.question_id] = text;
      continue;
    }
    const selected = parseOptionsJson(answer.answer_json);
    if (selected.length > 0) values[answer.question_id] = selected;
  }
  return Object.keys(values).length > 0 ? JSON.stringify(values) : null;
}
