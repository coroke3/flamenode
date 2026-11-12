/**
 * MIG-0657 U01i — SA-065..068 single atomic slot CAS+audit+Queue write core.
 *
 * Host boundaries: CURRENT supplies a Drizzle D1 handle, authenticated actor,
 * already-authorized mutation plan and a lazy QueueWakeHostLoader. Hono may
 * supply those later after its own Origin/Auth/BAN/TOS/Active X guard.
 *
 * No public route, no implicit authorization. Keep CURRENT mutation order,
 * per-statement changes() assertions, strict before/after audit and wake-only-
 * after-commit invariant. Notification outbox guards are passed in as extra.
 */
import { sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { slots } from "@flamenode/db/schema";
import { buildSlotAtomicAuditPlan } from "@flamenode/domain/slots/atomicAuditPlan";
import { mutateWithAudit } from "../audit/mutate.ts";
import type { ServerCoreDb } from "../db.ts";
import type { QueueWakeHostLoader } from "../ports.ts";
import { buildSlotChangeQueueBatch } from "../staticRebuild/hooks.ts";
import { versionedSlotWhere } from "./versionedPredicate.ts";

type SlotRow = typeof slots.$inferSelect;
type SlotPatch = Partial<typeof slots.$inferInsert>;

export type SlotCoreBulkMutation = {
  rows: SlotRow[];
  patch: SlotPatch;
  statusGuard?: "available" | "reserved" | "submitted";
};

export async function commitSlotMutationPlanCore(args: {
  db: ServerCoreDb;
  mutations: readonly SlotCoreBulkMutation[];
  eventId: string;
  actorUserId: string;
  reason: string;
  extraStatements?: BatchItem<"sqlite">[];
  notificationWakeSource?: "web";
  loadWakeHost: QueueWakeHostLoader;
}): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  // Fail closed on empty or duplicate rows before acquiring Queue or D1
  // batch execution; the pure plan snapshots old and new column values.
  // This core is shared by CURRENT and future Hono hosts. Never trust a
  // caller-supplied plan to retarget another event or rewrite slot identity.
  // Reject before the first D1/Queue read, not merely after a failed UPDATE.
  const immutableColumns = ["id", "event_id", "version", "updated_at"] as const;
  for (const mutation of args.mutations) {
    if (immutableColumns.some((column) => Object.prototype.hasOwnProperty.call(mutation.patch, column))) {
      throw new Error("slot_mutation_forbidden_identity_patch");
    }
    for (const row of mutation.rows) {
      if (row.event_id !== args.eventId) {
        throw new Error("slot_mutation_cross_event");
      }
    }
  }
  const plan = buildSlotAtomicAuditPlan(args.mutations, now);
  const mutationStatements: BatchItem<"sqlite">[] = plan.updates.map(
    (mutation) =>
      args.db
        .update(slots)
        .set({
          ...mutation.patch,
          updated_at: now,
          version: sql`${slots.version} + 1`,
        })
        .where(
          versionedSlotWhere(
            args.eventId,
            mutation.rows,
            mutation.statusGuard,
          ),
        ),
  );
  const expectedMutationChanges = plan.updates.map(
    (mutation) => mutation.expectedChanges,
  );
  const audits = plan.auditDeltas.map((delta) => ({
    table_name: "slots" as const,
    target_id: delta.targetId,
    operation: "UPDATE" as const,
    before: delta.before,
    after: delta.after,
    actor_user_id: args.actorUserId,
    reason: args.reason,
    context: "user-slot" as const,
    retention_class: "normal" as const,
    restore_strategy: "update_before" as const,
    strict: true as const,
  }));

  const queue = await buildSlotChangeQueueBatch(args.db, {
    eventId: args.eventId,
    reason: args.reason,
    requestedByUserId: args.actorUserId,
  });
  const extra = args.extraStatements ?? [];
  // The presence of extra guard statements alone cannot wake notifications;
  // only a caller that saved an outbox item may set notificationWakeSource.
  const wakeNotification = args.notificationWakeSource;
  await mutateWithAudit(args.db, {
    mutationStatements: [
      ...mutationStatements,
      ...queue.statements,
      ...extra,
    ],
    expectedMutationChanges: [
      ...expectedMutationChanges,
      ...queue.expectedChanges,
      ...extra.map(() => null),
    ],
    audits,
    notificationWakeSource: wakeNotification,
    staticRebuildWakeSource: queue.statements.length > 0 ? "web" : undefined,
  }, args.loadWakeHost);
}
