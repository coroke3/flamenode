import { sql } from "drizzle-orm";
import { users, videos, xUserAccountLinks, xUsers } from "@flamenode/db/schema";
import type { SubmissionCustomAnswerDraft } from "@flamenode/domain/video";
import type { ServerCoreDb } from "../db.ts";
import { planD1AuditMutationBudget, type D1AuditMutationBudget } from "../audit/mutateBudget.ts";
import type { UnslottedVideoAtomicPlan } from "./unslottedEventPlans.ts";
import {
  buildUnslottedEventEligibilityAssertionPlan,
  buildUnslottedVideoEventPlan,
} from "./unslottedEventPlans.ts";
import { buildFreeVideoInsertPlan, buildFreeVideoYoutubeMetadataInsertPlan } from "./freeVideoInsertPlan.ts";
import { buildFreeVideoCustomAnswerInsertPlan } from "./freeVideoCustomAnswerInsertPlan.ts";
import { buildStaticRebuildQueueBatch } from "../staticRebuild/enqueue.ts";
import { buildFreeVideoRebuildTargets } from "./freeVideoRebuildTargets.ts";
import { buildFreeVideoSoftwareInsertPlan } from "./freeVideoSoftwareInsertPlan.ts";
import { buildFreeVideoSubmittedNotificationPlan } from "./freeVideoSubmittedNotificationPlan.ts";
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
    /** Trusted Active X from the authenticated write guard, never request data. */
    trustedActiveXId: string;
    eventId: string | null;
    now: number;
    /** Trusted, D1-loaded full question set; not submitted FormData. */
    questions: readonly LoadedGeneralCustomQuestion[];
    /** Parsed against the same question set. */
    customAnswerDrafts: readonly SubmissionCustomAnswerDraft[];
  },
): UnslottedVideoAtomicPlan {
  const { videoAfter, actorUserId, trustedActiveXId, eventId, now, questions, customAnswerDrafts } = args;
  if (!actorUserId || !trustedActiveXId?.trim() || !videoAfter.id ||
      videoAfter.submitted_by_user_id !== actorUserId ||
      videoAfter.primary_event_id !== eventId ||
      videoAfter.creator_x_user_id !== trustedActiveXId ||
      videoAfter.source_type !== "youtube" ||
      !videoAfter.youtube_video_id ||
      !/^[A-Za-z0-9_-]{11}$/.test(videoAfter.youtube_video_id) ||
      videoAfter.visibility_status !== "public" ||
      videoAfter.scheduling_type !== "manual" ||
      (typeof videoAfter.scheduled_time !== "number" ||
        !Number.isSafeInteger(videoAfter.scheduled_time) ||
        videoAfter.scheduled_time < 0) ||
      videoAfter.app_like_count !== 0 ||
      videoAfter.score !== 0 ||
      videoAfter.score_updated_at !== null ||
      !videoAfter.creator_display_name.trim() ||
      !videoAfter.title.trim() ||
      videoAfter.created_at !== now || videoAfter.updated_at !== now ||
      !Number.isSafeInteger(now) || now < 0) {
    throw new Error("free_video_submission_plan_identity_invalid");
  }

  // Recheck the authenticated Active X on the SAME D1 batch as creation.
  // This prevents a concurrent ban, active-X switch, link revocation or
  // approval downgrade from committing with a stale request-time guard.
  // This batch-time assertion also mirrors CURRENT's TOS gate; a request
  // that passed an earlier guard must fail if consent is revoked or the user
  // is required to re-accept a newer terms version before commit.
  const activeXAssertion = db.run(sql`
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM ${users}
      JOIN ${xUserAccountLinks}
        ON ${xUserAccountLinks.auth_user_id} = ${users.id}
       AND ${xUserAccountLinks.x_user_id} = ${trustedActiveXId}
      JOIN ${xUsers}
        ON ${xUsers.id} = ${xUserAccountLinks.x_user_id}
      WHERE ${users.id} = ${actorUserId}
        AND ${users.active_x_user_id} = ${trustedActiveXId}
        AND COALESCE(${users.is_banned}, 0) = 0
        AND ${users.is_tos_accepted} = 1
        AND COALESCE(${users.terms_reaccept_required}, 0) <> 1
        AND ${xUsers.approval_status} = 'approved'
    ) THEN 1 ELSE json_extract('not-valid-json', '$') END
  `);
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
  const youtubeMetadata = buildFreeVideoYoutubeMetadataInsertPlan(db, {
    videoId: videoAfter.id, actorUserId, now,
  });
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
    activeXAssertion,
    ...eventAssertion.statements,
    ...(questionAssertion ? [questionAssertion] : []),
    ...videoInsert.statements,
    ...youtubeMetadata.statements,
    ...eventLink.statements,
    ...answerMutations,
  ];
  const expectedChanges = [
    null,
    ...eventAssertion.expectedChanges,
    ...(questionAssertion ? [null] : []),
    ...videoInsert.expectedChanges,
    ...youtubeMetadata.expectedChanges,
    ...eventLink.expectedChanges,
    ...answerMutationChanges,
  ];
  if (statements.length !== expectedChanges.length) {
    throw new Error("free_video_submission_plan_length_invalid");
  }
  return {
    statements,
    expectedChanges,
    audits: [...videoInsert.audits, ...youtubeMetadata.audits, ...eventLink.audits, ...answerPlan.audits],
  };
}

/**
 * UNMOUNTED SA-086 proposal. Appends the canonical rebuild targets to the
 * same prepared D1 batch as the video INSERT; no DB writes or wake occur.
 * The authenticated caller must still provide the remaining CURRENT atomic
 * member, derived and icon integration. Software rows and CURRENT-style DM
 * notification are included only with trusted inputs from the host.
 */
export async function buildFreeVideoSubmissionWithRebuildPlan(
  db: ServerCoreDb,
  args: Parameters<typeof buildFreeVideoSubmissionAtomicPlan>[1] & {
    /** Canonical parsed videoForm.used_software; omit only for legacy tests. */
    usedSoftware?: string | null;
    /** Trusted, CURRENT-formatted notification payload. Legacy tests omit it. */
    submittedNotificationPayload?: Record<string, unknown>;
  },
): Promise<UnslottedVideoAtomicPlan> {
  const base = buildFreeVideoSubmissionAtomicPlan(db, args);
  const software = await buildFreeVideoSoftwareInsertPlan(db, {
    videoId: args.videoAfter.id,
    actorUserId: args.actorUserId,
    raw: args.usedSoftware ?? null,
    now: args.now,
  });
  const notification = args.submittedNotificationPayload
    ? await buildFreeVideoSubmittedNotificationPlan(db, {
      videoId: args.videoAfter.id,
      actorUserId: args.actorUserId,
      eventId: args.eventId,
      payload: args.submittedNotificationPayload,
      now: args.now,
    })
    : { statements: [], expectedChanges: [], audits: [] };
  const targets = buildFreeVideoRebuildTargets({
    videoId: args.videoAfter.id,
    userId: args.actorUserId,
    activeXId: args.trustedActiveXId,
    eventId: args.eventId,
  });
  const queue = await buildStaticRebuildQueueBatch(db, targets);
  if (queue.acceptedTargetCount !== targets.length ||
      queue.statements.length === 0 ||
      queue.statements.length !== queue.expectedChanges.length) {
    throw new Error("free_video_submission_rebuild_plan_incomplete");
  }
  return {
    statements: [...base.statements, ...software.statements, ...notification.statements, ...queue.statements],
    expectedChanges: [...base.expectedChanges, ...software.expectedChanges, ...notification.expectedChanges, ...queue.expectedChanges],
    audits: [...base.audits, ...software.audits],
  };
}

/**
 * U02 unmounted S3 gate: estimate the *same* logical D1 query budget as
 * CURRENT's inspectVideoAtomicWritePlanBudget. The eventual Hono caller must
 * pass its actual number of pre-mutation read queries; silently using the
 * deprecated generic 18-query allowance is not a substitute for measurement.
 *
 * This is intentionally PURE. It neither runs statements nor grants permission
 * to commit. A production caller MUST reject !withinLimit before invoking the
 * guarded mutateWithAudit transaction.
 */
export function inspectFreeVideoSubmissionAtomicPlanBudget(
  plan: UnslottedVideoAtomicPlan,
  callerQueryCount: number,
): D1AuditMutationBudget {
  if (!Number.isSafeInteger(callerQueryCount) || callerQueryCount < 0 ||
      plan.statements.length === 0 ||
      plan.statements.length !== plan.expectedChanges.length ||
      plan.audits.length === 0 ||
      plan.audits.some((audit) => !audit.strict || !audit.actor_user_id)) {
    throw new Error("free_video_submission_budget_arguments_invalid");
  }
  return planD1AuditMutationBudget({
    mutationStatementCount: plan.statements.length,
    mutationAssertionCount: plan.expectedChanges.filter((value) => value !== null).length,
    auditEntryCount: plan.audits.length,
    distinctActorCount: new Set(plan.audits.map((audit) => audit.actor_user_id)).size,
    actorXValidationQueryCount: plan.audits.some(
      (audit) => Boolean(audit.actor_x_user_id?.trim()),
    ) ? 1 : 0,
    // No claims about authentication/audit-setting preloading in unmounted U02.
    preloadedSettings: false,
    preloadedActorCount: 0,
    callerQueryCount,
  });
}
