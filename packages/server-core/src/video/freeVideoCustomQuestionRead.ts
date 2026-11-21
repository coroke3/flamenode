import { and, asc, eq, not, sql } from "drizzle-orm";
import { eventCustomQuestions } from "@flamenode/db/schema";
import {
  parseSubmissionQuestionOptionsJson,
  parseSubmissionQuestionType,
  type SubmissionCustomQuestion,
} from "@flamenode/domain/video";
import type { ServerCoreDb } from "../db.ts";

export const MAX_VIDEO_CUSTOM_QUESTIONS_READ = 18;

/** Strict source snapshot for a *single* SA-086 event. No client input here. */
export type GeneralCustomQuestionPolicySnapshot = {
  id: string;
  event_id: string;
  question_key: string;
  label: string;
  type: string;
  required: number;
  options_json: string | null;
  max_length: number | null;
  sort_order: number;
  visibility: string;
  updated_at: number;
};
export type LoadedGeneralCustomQuestion = SubmissionCustomQuestion & {
  source: GeneralCustomQuestionPolicySnapshot;
};
/** Same columns and ordering as the D1 batch-time JSON aggregate assertion. */
export function serializeGeneralCustomQuestionPolicy(
  questions: readonly LoadedGeneralCustomQuestion[],
): string {
  if (questions.length > MAX_VIDEO_CUSTOM_QUESTIONS_READ) {
    throw new Error("video_custom_question_snapshot_limit_exceeded");
  }
  return JSON.stringify(questions.map(({ source: q }) => [
    q.id, q.event_id, q.question_key, q.label, q.type,
    q.required, q.options_json, q.max_length, q.sort_order,
    q.visibility, q.updated_at,
  ]));
}
const STAGE_KEY = "stage_permission";
const STAGE_PREFIX = "stage_permission_";

/**
 * Unmounted SA-086 candidate. Matches CURRENT's active, non-stage general
 * question predicate and deterministic event/sort/id ordering. One bounded D1
 * read, and fail-closed if legacy rows exceed the approved per-event cap.
 */
export async function loadGeneralCustomQuestionsForFreeVideo(
  db: ServerCoreDb,
  eventId: string | null,
): Promise<LoadedGeneralCustomQuestion[]> {
  if (!eventId) return [];
  const rows = await db.select({
    id: eventCustomQuestions.id,
    event_id: eventCustomQuestions.event_id,
    question_key: eventCustomQuestions.question_key,
    label: eventCustomQuestions.label,
    type: eventCustomQuestions.type,
    required: eventCustomQuestions.required,
    options_json: eventCustomQuestions.options_json,
    max_length: eventCustomQuestions.max_length,
    is_active: eventCustomQuestions.is_active,
    sort_order: eventCustomQuestions.sort_order,
    visibility: eventCustomQuestions.visibility,
    updated_at: eventCustomQuestions.updated_at,
  })
    .from(eventCustomQuestions)
    .where(and(
      eq(eventCustomQuestions.event_id, eventId),
      eq(eventCustomQuestions.is_active, 1),
      not(sql`(
        ${eventCustomQuestions.question_key} = ${STAGE_KEY}
        OR substr(${eventCustomQuestions.question_key}, 1, ${STAGE_PREFIX.length}) = ${STAGE_PREFIX}
      )`),
    )!)
    .orderBy(
      asc(eventCustomQuestions.event_id),
      asc(eventCustomQuestions.sort_order),
      asc(eventCustomQuestions.id),
    )
    .limit(MAX_VIDEO_CUSTOM_QUESTIONS_READ + 1);
  if (rows.length > MAX_VIDEO_CUSTOM_QUESTIONS_READ) {
    throw new Error("video_custom_question_read_limit_exceeded");
  }
  return rows.map((row) => ({
    id: row.id,
    event_id: row.event_id,
    question_key: row.question_key,
    label: row.label,
    type: parseSubmissionQuestionType(row.type),
    required: row.required === 1,
    options: parseSubmissionQuestionOptionsJson(row.options_json),
    max_length: row.max_length,
    is_active: row.is_active === 1,
    source: {
      id: row.id, event_id: row.event_id, question_key: row.question_key,
      label: row.label, type: row.type, required: row.required,
      options_json: row.options_json, max_length: row.max_length,
      sort_order: row.sort_order, visibility: row.visibility,
      updated_at: row.updated_at,
    },
  }));
}
