import { and, asc, eq, inArray, not, sql } from "drizzle-orm";
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

/**
 * Decode the ordered JSON projection from the single SA-086 event SELECT.
 * Its tuple columns, ordering and row cap match the ordinary D1 loader and
 * the batch-time policy assertion. Fail closed on malformed/foreign rows;
 * this is never a client-supplied snapshot.
 */
export function decodeGeneralCustomQuestionPolicyProjection(
  json: string,
  expectedEventId: string,
): LoadedGeneralCustomQuestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("video_custom_question_projection_invalid");
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_VIDEO_CUSTOM_QUESTIONS_READ) {
    throw new Error("video_custom_question_projection_limit_or_shape_invalid");
  }
  const seen = new Set<string>();
  return parsed.map((tuple: unknown) => {
    if (!Array.isArray(tuple) || tuple.length !== 11) {
      throw new Error("video_custom_question_projection_invalid");
    }
    const [id, eventId, key, label, type, required, optionsJson, maxLength,
      sortOrder, visibility, updatedAt] = tuple;
    if (typeof id !== "string" || !id || seen.has(id) ||
        eventId !== expectedEventId ||
        typeof key !== "string" || typeof label !== "string" ||
        typeof type !== "string" || (required !== 0 && required !== 1) ||
        (optionsJson !== null && typeof optionsJson !== "string") ||
        (maxLength !== null && (!Number.isSafeInteger(maxLength) || maxLength < 0)) ||
        !Number.isSafeInteger(sortOrder) || typeof visibility !== "string" ||
        !Number.isSafeInteger(updatedAt)) {
      throw new Error("video_custom_question_projection_invalid");
    }
    seen.add(id);
    const source: GeneralCustomQuestionPolicySnapshot = {
      id, event_id: eventId, question_key: key, label, type, required,
      options_json: optionsJson, max_length: maxLength,
      sort_order: sortOrder, visibility, updated_at: updatedAt,
    };
    return {
      id,
      event_id: eventId,
      question_key: key,
      label,
      type: parseSubmissionQuestionType(type),
      required: required === 1,
      options: parseSubmissionQuestionOptionsJson(optionsJson),
      max_length: maxLength,
      is_active: true,
      source,
    };
  });
}

/**
 * Decode the same ordered general-question projection for a resolved
 * multi-event slot submission. SQL orders by event_id, sort_order, id;
 * each event retains CURRENT's independent 18-row cap.
 */
export function decodeGeneralCustomQuestionPolicyForEvents(
  json: string,
  expectedEventIds: readonly string[],
): LoadedGeneralCustomQuestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("video_custom_question_projection_invalid");
  }
  const ids = Array.from(new Set(expectedEventIds.filter(Boolean)));
  if (!Array.isArray(parsed) || parsed.length > ids.length * MAX_VIDEO_CUSTOM_QUESTIONS_READ) {
    throw new Error("video_custom_question_projection_limit_or_shape_invalid");
  }
  const expected = new Set(ids);
  const grouped = new Map<string, unknown[][]>();
  const order: string[] = [];
  for (const tuple of parsed) {
    if (!Array.isArray(tuple) || tuple.length !== 11 ||
        typeof tuple[1] !== "string" || !expected.has(tuple[1])) {
      throw new Error("video_custom_question_projection_invalid");
    }
    const eventId = tuple[1];
    let rows = grouped.get(eventId);
    if (!rows) {
      rows = [];
      grouped.set(eventId, rows);
      order.push(eventId);
    }
    rows.push(tuple);
    if (rows.length > MAX_VIDEO_CUSTOM_QUESTIONS_READ) {
      throw new Error("video_custom_question_projection_limit_or_shape_invalid");
    }
  }
  return order.flatMap((eventId) =>
    decodeGeneralCustomQuestionPolicyProjection(JSON.stringify(grouped.get(eventId)), eventId)
  );
}

const STAGE_KEY = "stage_permission";
const STAGE_PREFIX = "stage_permission_";

/**
 * CURRENT's exact key-only stage-question predicate, shared with event-update planning.
 * Keep is_active as a separate caller predicate; this helper deliberately does not add it.
 */
export function stagePermissionQuestionKeyCondition() {
  return sql`(
    ${eventCustomQuestions.question_key} = ${STAGE_KEY}
    OR substr(${eventCustomQuestions.question_key}, 1, ${STAGE_PREFIX.length}) = ${STAGE_PREFIX}
  )`;
}

async function readGeneralQuestionRows(db: ServerCoreDb, ids: readonly string[]) {
  return db.select({
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
      ids.length === 1 ? eq(eventCustomQuestions.event_id, ids[0]) : inArray(eventCustomQuestions.event_id, [...ids]),
      eq(eventCustomQuestions.is_active, 1),
      not(stagePermissionQuestionKeyCondition()),
    )!)
    .orderBy(
      asc(eventCustomQuestions.event_id),
      asc(eventCustomQuestions.sort_order),
      asc(eventCustomQuestions.id),
    )
    .limit(ids.length * MAX_VIDEO_CUSTOM_QUESTIONS_READ + 1);
}

type GeneralQuestionRow = Awaited<ReturnType<typeof readGeneralQuestionRows>>[number];

function normalizeGeneralQuestionRows(rows: readonly GeneralQuestionRow[]): LoadedGeneralCustomQuestion[] {
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

/** CURRENT's chunk size, not a new event-selection cap. Normal SA-088
 * selections of <=4 events produce one SELECT with LIMIT <=73. The admin
 * compatibility path can exceed four during preflight; preserve CURRENT's
 * chunk order and do not silently truncate or reject it here.
 * Unmounted: the final S3 path needs a fused receipt and same-batch CAS.
 */
export const GENERAL_QUESTION_EVENT_CHUNK_SIZE = 80;

export async function loadGeneralCustomQuestionsForSlotSubmission(
  db: ServerCoreDb,
  eventIds: readonly string[],
): Promise<LoadedGeneralCustomQuestion[]> {
  const ids = Array.from(new Set(eventIds.filter(Boolean)));
  const out: LoadedGeneralCustomQuestion[] = [];
  for (let i = 0; i < ids.length; i += GENERAL_QUESTION_EVENT_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + GENERAL_QUESTION_EVENT_CHUNK_SIZE);
    const rows = await readGeneralQuestionRows(db, chunk);
    if (rows.length > chunk.length * MAX_VIDEO_CUSTOM_QUESTIONS_READ) {
      throw new Error("video_custom_question_read_limit_exceeded");
    }
    const counts = new Map<string, number>();
    for (const row of rows) {
      const count = (counts.get(row.event_id) ?? 0) + 1;
      if (count > MAX_VIDEO_CUSTOM_QUESTIONS_READ) {
        throw new Error("video_custom_question_read_limit_exceeded");
      }
      counts.set(row.event_id, count);
    }
    out.push(...normalizeGeneralQuestionRows(rows));
  }
  return out;
}

/** SA-086 retains its existing single-event semantics and exact predicate. */
export async function loadGeneralCustomQuestionsForFreeVideo(
  db: ServerCoreDb,
  eventId: string | null,
): Promise<LoadedGeneralCustomQuestion[]> {
  return loadGeneralCustomQuestionsForSlotSubmission(db, eventId ? [eventId] : []);
}
