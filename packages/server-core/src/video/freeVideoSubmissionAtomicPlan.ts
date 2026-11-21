import { videos } from "@flamenode/db/schema";
import type { SubmissionCustomAnswerDraft } from "@flamenode/domain/video";
import type { ServerCoreDb } from "../db.ts";
import type { UnslottedVideoAtomicPlan } from "./unslottedEventPlans.ts";
import {
  buildUnslottedEventEligibilityAssertionPlan,
  buildUnslottedVideoEventPlan,
} from "./unslottedEventPlans.ts";
import { buildFreeVideoInsertPlan } from "./freeVideoInsertPlan.ts";
import { buildFreeVideoCustomAnswerInsertPlan } from "./freeVideoCustomAnswerInsertPlan.ts";
import type { LoadedGeneralCustomQuestion } from "./freeVideoCustomQuestionRead.ts";

/**
 * SA-086 U02 UNMOUNTED candidate: compose the first slice of an atomic D1
 * submission. These are PREPARED statements, not executed transactions.
 *
 * All policy/CAS assertions MUST precede all mutations. The eventual caller
 * must append member/derived/notification/static-rebuild statements and strict
 * audit metadata, then execute the whole set via mutateWithAudit, with exact
 * per-statement changes(), bounded D1 query count and post-commit wake.
 * Never use this function alone to authorize a write or mount a route.
 */
export function buildFreeVideoSubmissionAtomicPlan(
  db: ServerCoreDb,
  args: {
    videoAfter: typeof videos.$inferSelect;
    actorUserId: string;
    eventId: string | null;
    now: number;
    /** Trusted, D1-loaded full question set; not submitted FormData. */
    questions: readonly LoadedGeneralCustomQuestion[];
    /** Parsed against the same question set. */
    customAnswerDrafts: readonly SubmissionCustomAnswerDraft[];
  },
): UnslottedVideoAtomicPlan {
  const { videoAfter, actorUserId, eventId, now, questions, customAnswerDrafts } = args;
  if (!actorUserId || !videoAfter.id ||
      videoAfter.submitted_by_user_id !== actorUserId ||
      videoAfter.primary_event_id !== eventId ||
      !videoAfter.creator_x_user_id ||
      videoAfter.created_at !== now || videoAfter.updated_at !== now ||
      !Number.isSafeInteger(now) || now < 0) {
    throw new Error("free_video_submission_plan_identity_invalid");
  }

  // Pure plan construction can still fail closed. Nothing has been written.
  const eventAssertion = buildUnslottedEventEligibilityAssertionPlan(db, eventId, now);
  const answerPlan = buildFreeVideoCustomAnswerInsertPlan(db, {
    videoId: videoAfter.id,
    eventId,
    drafts: customAnswerDrafts,
    questions,
    actorUserId,
    now,
  });
  if (eventId && (
    eventAssertion.statements.length !== 1 ||
    answerPlan.statements.length < 1 ||
    eventAssertion.expectedChanges[0] !== null ||
    answerPlan.expectedChanges[0] !== null
  )) {
    throw new Error("free_video_submission_assertion_plan_invalid");
  }
  const videoInsert = buildFreeVideoInsertPlan(db, videoAfter, actorUserId);
  const eventLink = buildUnslottedVideoEventPlan(db, {
    videoId: videoAfter.id, eventId, actorUserId,
  });
  // The answer plan includes one assertion followed by zero/one INSERT.
  const [questionAssertion, ...answerMutations] = eventId
    ? answerPlan.statements
    : [];
  const answerMutationChanges = eventId
    ? answerPlan.expectedChanges.slice(1)
    : [];
  const statements = [
    ...eventAssertion.statements,
    ...(questionAssertion ? [questionAssertion] : []),
    ...videoInsert.statements,
    ...eventLink.statements,
    ...answerMutations,
  ];
  const expectedChanges = [
    ...eventAssertion.expectedChanges,
    ...(questionAssertion ? [null] : []),
    ...videoInsert.expectedChanges,
    ...eventLink.expectedChanges,
    ...answerMutationChanges,
  ];
  if (statements.length !== expectedChanges.length) {
    throw new Error("free_video_submission_plan_length_invalid");
  }
  return {
    statements,
    expectedChanges,
    audits: [...videoInsert.audits, ...eventLink.audits, ...answerPlan.audits],
  };
}
