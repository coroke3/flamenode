/**
 * MIG-0652 U02 (SA-021) — unmounted Hono event-create atomic D1 write plan.
 *
 * The caller MUST first perform CURRENT-equivalent Origin/session/admin write
 * guard, CostGuard, schema/form/template validation, duplicate/tombstone checks,
 * approved Active-X ownership and normalized question planning. This module
 * ONLY builds statements and strict audit snapshots; it never commits or
 * mounts a route. Old-ID reuse requires its separate, verified R2 precommit
 * and MUST NOT use this no-tombstone planner.
 */
import { sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { events, eventStaff, eventCustomQuestions, users, xUsers, xUserAccountLinks } from "@flamenode/db/schema";
import type { ServerCoreDb } from "@flamenode/server-core/db";
import type { WriteAuditLogInput } from "@flamenode/server-core/audit/types";
import { assertCondition, planD1AuditMutationBudget } from "@flamenode/server-core/audit/mutate";
import type { buildEventChangeQueueBatch } from "@flamenode/server-core/staticRebuild/hooks";
import { EVENT_ID_PATTERN, MAX_EVENT_CREATE_QUESTIONS, MAX_EVENT_CREATE_QUESTIONS_PER_INSERT } from "@flamenode/domain/event";

export const EVENT_CREATE_PLAN_FAILURE = "イベント作成の原子的処理がD1の上限を超えます。";
export const EVENT_CREATE_INVALID_PLAN = "イベント作成の書き込み計画が不正です。";

type EventInsert = typeof events.$inferInsert;
type StaffInsert = typeof eventStaff.$inferInsert;
type QuestionInsert = typeof eventCustomQuestions.$inferInsert;
type EventQueueBatch = Awaited<ReturnType<typeof buildEventChangeQueueBatch>>;

export type EventCreateAtomicWritePlan =
  | { ok: false; message: string }
  | {
      ok: true;
      mutationStatements: BatchItem<"sqlite">[];
      expectedMutationChanges: number[];
      preMutationAssertions: BatchItem<"sqlite">[];
      audits: WriteAuditLogInput[];
      budget: ReturnType<typeof planD1AuditMutationBudget>;
    };

/**
 * Caller passes only validated rows and a prepared queue batch. D1 mutation
 * and strict audit must be committed by mutateWithAudit in a single batch.
 */
export function planEventCreateAtomicWrite(input: {
  db: ServerCoreDb;
  eventRow: EventInsert;
  ownerRow: StaffInsert;
  questionRows: readonly QuestionInsert[];
  questionChunks: readonly (readonly QuestionInsert[])[];
  queue: EventQueueBatch;
  actorUserId: string;
  /** A rename tombstone must go through the separate CAS/R2 precommit flow. */
  hasRenameTombstone: boolean;
}): EventCreateAtomicWritePlan {
  const { db, eventRow, ownerRow, questionRows, questionChunks, queue, actorUserId } = input;
  const bad = (): EventCreateAtomicWritePlan => ({ ok: false, message: EVENT_CREATE_INVALID_PLAN });
  // CURRENT createEvent always disables the public export API on creation
  // and creates one publicly listed, fixed-role owner without extra grants.
  // Reject a malformed future Hono adapter instead of silently increasing
  // publication or owner permissions in its first atomic D1 batch.
  // Mirror CURRENT createEvent route-safe new-ID contract even if a future
  // Hono adapter passes a malformed purportedly validated event row.
  if (input.hasRenameTombstone ||
      typeof eventRow.id !== "string" || !EVENT_ID_PATTERN.test(eventRow.id) ||
      !ownerRow.id ||
      eventRow.public_api_enabled !== 0 ||
      ownerRow.event_id !== eventRow.id || !actorUserId ||
      ownerRow.approved_by_auth_user_id !== actorUserId ||
      ownerRow.permission_preset !== "owner" ||
      ownerRow.custom_permission_keys_json !== null ||
      ownerRow.is_public !== 1 ||
      ownerRow.public_role_label !== "主催" || !ownerRow.x_user_id ||
      questionRows.length > MAX_EVENT_CREATE_QUESTIONS ||
      queue.statements.length !== queue.expectedChanges.length) return bad();

  const flattened = questionChunks.flat();
  if (flattened.length !== questionRows.length ||
      questionChunks.some((chunk) => chunk.length === 0 || chunk.length > MAX_EVENT_CREATE_QUESTIONS_PER_INSERT) ||
      flattened.some((row, index) => row !== questionRows[index])) return bad();
  const ids = new Set<string>([ownerRow.id]);
  const keys = new Set<string>();
  for (const row of questionRows) {
    if (!row.id || row.event_id !== eventRow.id || !row.question_key ||
        ids.has(row.id) || keys.has(row.question_key)) return bad();
    ids.add(row.id);
    keys.add(row.question_key);
  }

  // CURRENT createEvent requires the selected Active X identity to be both
  // approved and linked to the authenticated caller. Reassert ownership
  // *inside* the same atomic D1 batch: even a stale/forged future Hono
  // preflight must never create an event with an unapproved owner or stale display name.
  const preMutationAssertions: BatchItem<"sqlite">[] = [
    db.run(assertCondition(sql`EXISTS (
      SELECT 1 FROM ${users}
      INNER JOIN ${xUserAccountLinks}
        ON ${xUserAccountLinks.auth_user_id} = ${users.id}
      INNER JOIN ${xUsers}
        ON ${xUsers.id} = ${xUserAccountLinks.x_user_id}
      WHERE ${users.id} = ${actorUserId}
        AND ${users.active_x_user_id} = ${ownerRow.x_user_id}
        AND ${xUserAccountLinks.x_user_id} = ${ownerRow.x_user_id}
        AND ${xUsers.approval_status} = 'approved'
        AND ${xUsers.x_name} = ${ownerRow.display_name}
    )`)),
  ];

  const mutationStatements: BatchItem<"sqlite">[] = [
    db.insert(events).values(eventRow),
    db.insert(eventStaff).values(ownerRow),
    ...questionChunks.map((chunk) => db.insert(eventCustomQuestions).values([...chunk])),
    ...queue.statements,
  ];
  const expectedMutationChanges = [
    1, 1, ...questionChunks.map((chunk) => chunk.length), ...queue.expectedChanges,
  ];
  const audits: WriteAuditLogInput[] = [
    {
      table_name: "events", target_id: eventRow.id, operation: "CREATE",
      before: null, after: { ...eventRow }, actor_user_id: actorUserId,
      retention_class: "normal", strict: true,
    },
    {
      table_name: "event_staff", target_id: ownerRow.id, operation: "CREATE",
      before: null, after: { ...ownerRow }, actor_user_id: actorUserId,
      context: "event-create:owner", reason: "イベント作成者をownerとして登録",
      retention_class: "long_audit", restore_strategy: "delete_created", strict: true,
    },
    ...questionRows.map((row): WriteAuditLogInput => ({
      table_name: "event_custom_questions", target_id: row.id, operation: "CREATE",
      before: null, after: { ...row }, actor_user_id: actorUserId,
      context: "event-create:custom-question", retention_class: "normal", strict: true,
    })),
  ];
  // Preserve CURRENT's conservative 18-query reserve until an actual Hono
  // route measures all preflight reads. No Queue wake may occur in Hono.
  const budget = planD1AuditMutationBudget({
    mutationStatementCount: mutationStatements.length,
    mutationAssertionCount: mutationStatements.length,
    preMutationAssertionCount: preMutationAssertions.length,
    auditEntryCount: audits.length,
    distinctActorCount: 1,
  });
  if (!budget.withinLimit) return { ok: false, message: EVENT_CREATE_PLAN_FAILURE };
  return { ok: true, mutationStatements, expectedMutationChanges, preMutationAssertions, audits, budget };
}
