/**
 * MIG-0652 U03 (SA-022) — unmounted Hono event-create atomic D1 write plan.
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
import { events, eventStaff, eventCustomQuestions, users, xUsers, xUserAccountLinks, publicVisibilityFences } from "@flamenode/db/schema";
import type { ServerCoreDb } from "@flamenode/server-core/db";
import type { WriteAuditLogInput } from "@flamenode/server-core/audit/types";
import { assertCondition, planAtomicAuditMutationBudget, type AtomicAuditMutationInput } from "@flamenode/server-core/audit/mutate";
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
      preloaded?: AtomicAuditMutationInput["preloaded"];
      callerQueryCount?: number;
      budget: ReturnType<typeof planAtomicAuditMutationBudget>;
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
  /** Server-read identity and lossless storage witnesses, never request input. */
  ownerSnapshot: {
    identity: { x_user_id: string; display_name: string };
    persistedActiveX: { type: string; hex: string };
    displayName: { type: string; hex: string };
  };
  preloaded?: AtomicAuditMutationInput["preloaded"];
  callerQueryCount?: number;
  /** A rename tombstone must go through the separate CAS/R2 precommit flow. */
  hasRenameTombstone: boolean;
}): EventCreateAtomicWritePlan {
  const { db, eventRow, ownerRow, questionRows, questionChunks, queue, actorUserId, ownerSnapshot } = input;
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
      ownerRow.x_user_id !== ownerSnapshot.identity.x_user_id ||
      ownerRow.display_name !== ownerSnapshot.identity.display_name ||
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

  // CURRENT resolves a normalized selection or the sole approved linked X.
  // Keep that request-local identity, but reject a changed persisted selection,
  // revoked chosen link/approval, stale display name or a newly created rename
  // tombstone before any writes. Other newly linked X IDs do not revoke the
  // already resolved owner. typeof + hex(CAST AS BLOB) avoids a driver-decoded
  // legacy value silently weakening CAS or falsely appearing changed.
  const preMutationAssertions: BatchItem<"sqlite">[] = [
    db.run(assertCondition(sql`EXISTS (
      SELECT 1 FROM ${users}
      INNER JOIN ${xUserAccountLinks}
        ON ${xUserAccountLinks.auth_user_id} = ${users.id}
      INNER JOIN ${xUsers}
        ON ${xUsers.id} = ${xUserAccountLinks.x_user_id}
      WHERE ${users.id} = ${actorUserId}
        AND typeof(${users.active_x_user_id}) = ${ownerSnapshot.persistedActiveX.type}
        AND hex(CAST(${users.active_x_user_id} AS BLOB)) = ${ownerSnapshot.persistedActiveX.hex}
        AND ${xUserAccountLinks.x_user_id} = ${ownerRow.x_user_id}
        AND ${xUsers.approval_status} = 'approved'
        AND typeof(${xUsers.x_name}) = ${ownerSnapshot.displayName.type}
        AND hex(CAST(${xUsers.x_name} AS BLOB)) = ${ownerSnapshot.displayName.hex}
    ) AND NOT EXISTS (
      SELECT 1 FROM ${publicVisibilityFences}
      WHERE ${publicVisibilityFences.entity_type} = 'event'
        AND ${publicVisibilityFences.entity_id} = ${eventRow.id}
        AND ${publicVisibilityFences.state} = 'blocked'
        AND ${publicVisibilityFences.reason} = 'event_id_rename_old_cleanup'
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
  // Use the exact same preload validation and query accounting as the commit.
  // Unmounted plan-only callers retain the legacy conservative reserve.
  const write = {
    mutationStatements, expectedMutationChanges, preMutationAssertions, audits,
    preloaded: input.preloaded, callerQueryCount: input.callerQueryCount,
  };
  const budget = planAtomicAuditMutationBudget(write);
  if (!budget.withinLimit) return { ok: false, message: EVENT_CREATE_PLAN_FAILURE };
  return { ok: true, ...write, budget };
}
