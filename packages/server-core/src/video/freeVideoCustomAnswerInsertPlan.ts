import { sql } from "drizzle-orm";
import { eventCustomQuestions, videoCustomAnswers } from "@flamenode/db/schema";
import { MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS } from "@flamenode/domain/video/atomicLimits";
import { validateSubmissionCustomAnswers, type SubmissionCustomAnswerDraft } from "@flamenode/domain/video";
import type { ServerCoreDb } from "../db.ts";
import type { UnslottedVideoAtomicPlan } from "./unslottedEventPlans.ts";
import {
  MAX_VIDEO_CUSTOM_QUESTIONS_READ,
  serializeGeneralCustomQuestionPolicy,
  type LoadedGeneralCustomQuestion,
} from "./freeVideoCustomQuestionRead.ts";

const EMPTY = (): UnslottedVideoAtomicPlan => ({ statements: [], expectedChanges: [], audits: [] });
const STAGE_KEY = "stage_permission";
const STAGE_PREFIX = "stage_permission_";

/**
 * MIG-0651 SA-086 unmounted candidate for *new* video's general answers.
 *
 * Do not execute separately: append these statements AND strict audits to the
 * videos INSERT, event eligibility reassertion, notification/queue rows and
 * other derived row plans within one mutateWithAudit D1 transaction.
 * Its batch-time policy snapshot assertion rejects deleted/inactivated/moved,
 * renamed, new-required, and type/options/length/visibility policy changes.
 * This must still be composed with video/queue/notification and the authenticated
 * transactional guard; it is NOT production write authorization.
 */
export function buildFreeVideoCustomAnswerInsertPlan(
  db: ServerCoreDb,
  args: {
    videoId: string;
    eventId: string | null;
    drafts: readonly SubmissionCustomAnswerDraft[];
    /** Server-read snapshot; never take this from a client request. */
    questions: readonly LoadedGeneralCustomQuestion[];
    actorUserId: string;
    now: number;
  },
): UnslottedVideoAtomicPlan {
  const { videoId, eventId, actorUserId, drafts, questions, now } = args;
  if (!videoId || !actorUserId || !Number.isSafeInteger(now) || now < 0) {
    throw new Error("video_custom_answer_insert_arguments_invalid");
  }
  if (drafts.length > MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS) {
    throw new Error("video_custom_answer_atomic_limit_exceeded");
  }
  if (!eventId) {
    if (drafts.length > 0 || questions.length > 0) {
      throw new Error("video_custom_answer_event_missing");
    }
    return EMPTY();
  }
  if (questions.length > MAX_VIDEO_CUSTOM_QUESTIONS_READ) {
    throw new Error("video_custom_question_snapshot_limit_exceeded");
  }
  const known = new Map<string, LoadedGeneralCustomQuestion>();
  for (const question of questions) {
    if (!question.is_active || question.event_id !== eventId ||
        question.source.event_id !== eventId ||
        question.id !== question.source.id ||
        question.question_key !== question.source.question_key ||
        question.type !== question.source.type ||
        question.label !== question.source.label ||
        Number(question.required) !== question.source.required ||
        question.max_length !== question.source.max_length ||
        known.has(question.id)) {
      throw new Error("video_custom_question_snapshot_invalid");
    }
    known.set(question.id, question);
  }
  const seen = new Set<string>();
  for (const draft of drafts) {
    if (
      !draft.question_id || !draft.question_key || draft.event_id !== eventId ||
      (!draft.answer_text?.trim() && !draft.answer_json?.trim()) ||
      (draft.answer_text !== null && draft.answer_json !== null) ||
      known.get(draft.question_id)?.question_key !== draft.question_key
    ) {
      throw new Error("video_custom_answer_draft_invalid");
    }
    if (seen.has(draft.question_id)) {
      throw new Error("video_custom_answer_duplicate_question");
    }
    seen.add(draft.question_id);
  }
  // Defensive replay is bounded (<=18 questions, <=4 drafts): a caller
  // forgetting the initial FormData preflight must not skip required fields,
  // text limits or selected-option checks. Replay also rejects malformed,
  // noncanonical checkbox JSON and stale/out-of-order draft snapshots.
  const form = new FormData();
  for (const draft of drafts) {
    const key = `custom_answer:${eventId}:${draft.question_key}`;
    if (draft.answer_text !== null) {
      form.append(key, draft.answer_text);
    } else if (draft.answer_json !== null) {
      let selections: unknown;
      try {
        selections = JSON.parse(draft.answer_json);
      } catch {
        throw new Error("video_custom_answer_draft_invalid");
      }
      if (!Array.isArray(selections) ||
          selections.length === 0 ||
          selections.some((item) => typeof item !== "string") ||
          JSON.stringify(selections) !== draft.answer_json) {
        throw new Error("video_custom_answer_draft_invalid");
      }
      for (const selection of selections as string[]) form.append(key, selection);
    }
  }
  const replay = validateSubmissionCustomAnswers(form, questions);
  if (!replay.ok || replay.drafts.length !== drafts.length ||
      replay.drafts.some((answer, i) => (
        answer.event_id !== drafts[i]?.event_id ||
        answer.question_id !== drafts[i]?.question_id ||
        answer.question_key !== drafts[i]?.question_key ||
        answer.answer_text !== drafts[i]?.answer_text ||
        answer.answer_json !== drafts[i]?.answer_json
      ))) {
    throw new Error("video_custom_answer_draft_policy_invalid");
  }
  const rows: (typeof videoCustomAnswers.$inferSelect)[] = drafts.map((draft) => ({
    video_id: videoId,
    event_id: eventId,
    question_id: draft.question_id,
    answer_text: draft.answer_text,
    answer_json: draft.answer_json,
    created_at: now,
    updated_at: now,
  }));
  // The full event question-set, not only submitted answers, is compared in the
  // same D1 batch as the video INSERT. New required questions and changed option
  // policies therefore invalidate the earlier form validation.
  const expected = serializeGeneralCustomQuestionPolicy(questions);
  const actual = sql`(
    SELECT json_group_array(json_array(
      id, event_id, question_key, label, type, required, options_json,
      max_length, sort_order, visibility, updated_at
    ))
    FROM (
      SELECT
        ${eventCustomQuestions.id} AS id,
        ${eventCustomQuestions.event_id} AS event_id,
        ${eventCustomQuestions.question_key} AS question_key,
        ${eventCustomQuestions.label} AS label,
        ${eventCustomQuestions.type} AS type,
        ${eventCustomQuestions.required} AS required,
        ${eventCustomQuestions.options_json} AS options_json,
        ${eventCustomQuestions.max_length} AS max_length,
        ${eventCustomQuestions.sort_order} AS sort_order,
        ${eventCustomQuestions.visibility} AS visibility,
        ${eventCustomQuestions.updated_at} AS updated_at
      FROM ${eventCustomQuestions}
      WHERE ${eventCustomQuestions.event_id} = ${eventId}
        AND ${eventCustomQuestions.is_active} = 1
        AND ${eventCustomQuestions.question_key} <> ${STAGE_KEY}
        AND substr(${eventCustomQuestions.question_key}, 1, ${STAGE_PREFIX.length}) <> ${STAGE_PREFIX}
      ORDER BY ${eventCustomQuestions.sort_order} ASC, ${eventCustomQuestions.id} ASC
      LIMIT ${MAX_VIDEO_CUSTOM_QUESTIONS_READ + 1}
    )
  )`;
  const assertion = db.run(sql`
    SELECT CASE WHEN ${actual} = ${expected} THEN 1
      ELSE json_extract('not-valid-json', '$') END
  `);
  if (rows.length === 0) {
    return { statements: [assertion], expectedChanges: [null], audits: [] };
  }
  return {
    statements: [assertion, db.insert(videoCustomAnswers).values(rows)],
    expectedChanges: [null, rows.length],
    audits: rows.map((row) => ({
      table_name: "video_custom_answers",
      target_id: [videoId, eventId, row.question_id].map(encodeURIComponent).join(":"),
      actor_user_id: actorUserId,
      context: "video-save:custom-answers",
      retention_class: "normal",
      strict: true,
      operation: "CREATE",
      before: null,
      after: { ...row },
    })),
  };
}
