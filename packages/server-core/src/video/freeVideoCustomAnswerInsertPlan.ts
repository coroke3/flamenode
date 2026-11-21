import { sql } from "drizzle-orm";
import { eventCustomQuestions, videoCustomAnswers } from "@flamenode/db/schema";
import { MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS } from "@flamenode/domain/video/atomicLimits";
import type { SubmissionCustomAnswerDraft } from "@flamenode/domain/video/customAnswers";
import type { ServerCoreDb } from "../db.ts";
import type { UnslottedVideoAtomicPlan } from "./unslottedEventPlans.ts";

const EMPTY = (): UnslottedVideoAtomicPlan => ({ statements: [], expectedChanges: [], audits: [] });
const STAGE_KEY = "stage_permission";
const STAGE_PREFIX = "stage_permission_";

/**
 * MIG-0651 SA-086 unmounted candidate for *new* video's general answers.
 *
 * Do not execute separately: append these statements AND strict audits to the
 * videos INSERT, event eligibility reassertion, notification/queue rows and
 * other derived row plans within one mutateWithAudit D1 transaction.
 * The assertion stops a removed/inactivated/renamed/reparented question.
 * Revalidating all required/option/visibility policies under concurrency is
 * still outstanding; therefore this is not production write authorization.
 */
export function buildFreeVideoCustomAnswerInsertPlan(
  db: ServerCoreDb,
  args: {
    videoId: string;
    eventId: string | null;
    drafts: readonly SubmissionCustomAnswerDraft[];
    actorUserId: string;
    now: number;
  },
): UnslottedVideoAtomicPlan {
  const { videoId, eventId, actorUserId, drafts, now } = args;
  if (!videoId || !actorUserId || !Number.isSafeInteger(now) || now < 0) {
    throw new Error("video_custom_answer_insert_arguments_invalid");
  }
  if (drafts.length > MAX_ATOMIC_VIDEO_CUSTOM_ANSWERS) {
    throw new Error("video_custom_answer_atomic_limit_exceeded");
  }
  if (!eventId) {
    if (drafts.length > 0) throw new Error("video_custom_answer_event_missing");
    return EMPTY();
  }
  if (drafts.length === 0) return EMPTY();
  const seen = new Set<string>();
  for (const draft of drafts) {
    if (
      !draft.question_id || !draft.question_key || draft.event_id !== eventId ||
      (!draft.answer_text?.trim() && !draft.answer_json?.trim()) ||
      (draft.answer_text !== null && draft.answer_json !== null)
    ) {
      throw new Error("video_custom_answer_draft_invalid");
    }
    if (seen.has(draft.question_id)) {
      throw new Error("video_custom_answer_duplicate_question");
    }
    seen.add(draft.question_id);
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
  // Batch-time CAS: do not insert an answer if its question was deleted,
  // disabled, renamed, moved to another event or changed to stage-permission.
  const eligible = sql.join(drafts.map((draft) => sql`EXISTS (
    SELECT 1 FROM ${eventCustomQuestions}
    WHERE ${eventCustomQuestions.id} = ${draft.question_id}
      AND ${eventCustomQuestions.event_id} = ${eventId}
      AND ${eventCustomQuestions.question_key} = ${draft.question_key}
      AND ${eventCustomQuestions.is_active} = 1
      AND ${eventCustomQuestions.question_key} <> ${STAGE_KEY}
      AND substr(${eventCustomQuestions.question_key}, 1, ${STAGE_PREFIX.length}) <> ${STAGE_PREFIX}
  )`), sql` AND `);
  return {
    statements: [
      db.run(sql`SELECT CASE WHEN ${eligible} THEN 1 ELSE json_extract('not-valid-json', '$') END`),
      db.insert(videoCustomAnswers).values(rows),
    ],
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
