/**
 * MIG-0650 U03bf: UNMOUNTED SA-085 atomic D1 execution adapter.
 *
 * Not a route, authorizer, or transport policy. Only a trusted Hono host that
 * has completed origin/session/admin/TOS/CostGuard checks, canonical D1 reads,
 * and assembleAdminVideoMemberAtomicPlan may call this function.
 * One strict audit + member/chapter/metadata/JSON1 rebuild Queue D1 batch is
 * committed by the shared executor. Queue wakes are postcommit only.
 *
 * Importing this module alone never performs a mutation or registers a route.
 */
import type { ServerCoreDb } from "../db.ts";
import type { QueueWakeHostLoader, QueueWakeHost } from "../ports.ts";
import {
  mutateWithAudit,
  planAtomicAuditMutationBudget,
  type AtomicAuditMutationInput,
} from "../audit/mutate.ts";
import {
  isValidPreloadedActorSnapshotJson,
  type PreloadedAuditContext,
} from "../audit/logger.ts";
import { D1_MAX_BATCH_QUERIES } from "../audit/mutateBudget.ts";
import type { AdminMemberAtomicAssembly } from "./adminMemberAtomicAssembly.ts";

export type AdminMemberAtomicExecutionInput = {
  assembly: AdminMemberAtomicAssembly;
  /** Both identifiers must come from the authorized guard and target SELECT. */
  videoId: string;
  actorUserId: string;
  /** Actual logical D1 reads already charged by this invocation. Never guess. */
  callerQueryCount: number;
  /** CostGuard settings and actor snapshots already read by the write guard. */
  preloaded: PreloadedAuditContext;
};

function invalid(): never {
  throw new RangeError("video_admin_member_atomic_execution_invalid");
}

function nullWakeHost(): QueueWakeHost {
  return {
    readEnv: () => null,
    readWaitUntil: () => null,
    readKv: () => null,
  };
}

/**
 * Verify the authenticated execution boundary before calling mutateWithAudit.
 * This is a pure check: it does not prepare audit entries or execute D1.
 */
export function prepareAdminMemberAtomicExecution(
  input: AdminMemberAtomicExecutionInput,
): AtomicAuditMutationInput | null {
  const { assembly, videoId, actorUserId, callerQueryCount, preloaded } = input;
  if (
    typeof videoId !== "string" || !videoId ||
    typeof actorUserId !== "string" || !actorUserId ||
    !Number.isSafeInteger(callerQueryCount) || callerQueryCount < 0 ||
    !assembly || !assembly.plan || !assembly.queue ||
    !Array.isArray(assembly.plan.statements) ||
    !Array.isArray(assembly.plan.expectedChanges) ||
    !Array.isArray(assembly.plan.audits) ||
    !Array.isArray(assembly.queue.statements) ||
    !Array.isArray(assembly.queue.expectedChanges) ||
    !Array.isArray(assembly.targets) ||
    // Even a no-op must not be acknowledged with a forged/missing guard actor.
    !preloaded?.settings ||
    !isValidPreloadedActorSnapshotJson(preloaded.actorSnapshotJsonById?.[actorUserId])
  ) invalid();

  const { plan, queue } = assembly;
  if (
    plan.statements.length !== plan.expectedChanges.length ||
    queue.statements.length !== queue.expectedChanges.length ||
    !Number.isSafeInteger(queue.acceptedTargetCount) ||
    queue.acceptedTargetCount < 0 ||
    queue.acceptedTargetCount !== assembly.targets.length
  ) invalid();

  if (assembly.noOp) {
    if (
      plan.statements.length || plan.audits.length ||
      queue.statements.length || queue.acceptedTargetCount ||
      assembly.targets.length || assembly.budget !== null
    ) invalid();
    // No-op bypasses mutateWithAudit, so enforce the invocation-level
    // D1 read ceiling here as well. Real requests meter each SELECT; a
    // forged or miscounted no-op cannot silently evade this final guard.
    if (callerQueryCount > D1_MAX_BATCH_QUERIES) {
      throw new RangeError("video_admin_member_atomic_execution_budget_exceeded");
    }
    return null;
  }

  if (
    !plan.statements.length || !plan.audits.length ||
    !assembly.budget?.withinLimit ||
    plan.expectedChanges.some(
      expected => expected !== null &&
        (!Number.isSafeInteger(expected) || expected < 0),
    ) ||
    plan.audits.some(audit =>
      audit.strict !== true ||
      audit.actor_user_id !== actorUserId ||
      audit.target_id !== videoId
    ) ||
    // The queue batch must remain the final segment of the SAME write plan.
    queue.statements.some((statement, i) =>
      plan.statements[plan.statements.length - queue.statements.length + i] !== statement ||
      plan.expectedChanges[plan.expectedChanges.length - queue.expectedChanges.length + i] !==
        queue.expectedChanges[i]
    ) ||
    (queue.acceptedTargetCount > 0) !== (queue.statements.length > 0) ||
    (assembly.targets.length > 0) !== (queue.acceptedTargetCount > 0)
  ) invalid();

  const atomic: AtomicAuditMutationInput = {
    mutationStatements: plan.statements,
    expectedMutationChanges: plan.expectedChanges,
    audits: plan.audits,
    preloaded,
    callerQueryCount,
    ...(queue.statements.length > 0
      ? { staticRebuildWakeSource: "admin" as const }
      : {}),
  };
  // Do not trust the planning-stage 18-query reserve as an execution budget.
  // The host provides its measured request-local D1 reads and the real audit
  // executor accounts for preloaded settings/actor snapshots consistently.
  if (!planAtomicAuditMutationBudget(atomic).withinLimit) {
    throw new RangeError("video_admin_member_atomic_execution_budget_exceeded");
  }
  return atomic;
}

/**
 * Only called after the trusted Hono host has authorized and assembled the
 * canonical save. The route is intentionally NOT mounted yet.
 */
export async function executeAdminMemberAtomicCandidate(
  db: ServerCoreDb,
  input: AdminMemberAtomicExecutionInput,
  loadWakeHost?: QueueWakeHostLoader,
): Promise<{ committed: boolean; auditIds: string[] }> {
  const atomic = prepareAdminMemberAtomicExecution(input);
  if (!atomic) return { committed: false, auditIds: [] };
  if (atomic.staticRebuildWakeSource && !loadWakeHost) invalid();

  // A successful D1 commit must never be converted into a 500 merely because
  // the host fails to read its optional after-commit Queue dispatch binding.
  const safeWakeHost: QueueWakeHostLoader | undefined = loadWakeHost
    ? async () => {
        try {
          return await loadWakeHost();
        } catch {
          return nullWakeHost();
        }
      }
    : undefined;
  const auditIds = await mutateWithAudit(db, atomic, safeWakeHost);
  return { committed: true, auditIds };
}
