/**
 * MIG-0656 U03n: SA-059 one-invocation / three-row Hono candidate, UNMOUNTED.
 *
 * This is intentionally NOT the all-available-slots API or a retry protocol.
 * A caller must never infer all-event completion from moreAtSnapshot=false.
 * The future mounted parent MUST apply Origin -> Auth.js -> TOS/writeGuard ->
 * DB before this CostGuard and event.slots-scoped permission check.
 *
 * One scoped D1 preread and one atomic mutateWithAudit D1 batch with
 * a pre-mutation scope recheck (pre-read TOCTOU revocation protection). No writes
 * happen in a read phase or outside the strict audit/Queue transaction.
 */
import { Hono } from "hono";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { buildSlotChangeQueueBatch } from "@flamenode/server-core/staticRebuild/hooks";
import type { AppEnv } from "../../env.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { auditPreloaded } from "../admin/body.ts";
import { canUpdateEventLabels, buildSlotChunkScopeAssertion } from "./slotWriteScopedRead.ts";
import {
  SLOT_AVAILABLE_DELETE_CHUNK_SNAPSHOT_SQL,
  selectAvailableDeleteChunk,
  type AvailableDeleteChunkRead,
} from "./slotAvailableDeleteChunkSnapshot.ts";
import { buildAvailableDeleteChunkAtomicPlan } from "./slotAvailableDeleteChunkMutation.ts";
import { isWriteConflict } from "../events/templates.ts";
import { writeGuardDenyResponse } from "../../middleware/writeOrigin.ts";
import { verifySlotChunkCostGuard, buildSlotChunkCostGuardAssertion } from "./slotChunkCostGuard.ts";

const NO_STORE = "private, no-store";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const WRITE_FAILED = "空き枠の削除に失敗しました。再読み込み後にお試しください。";

/** Test-only/independent-review candidate; NEVER mount in manage/index.ts yet. */
export const slotAvailableDeleteChunkRoutes = new Hono<AppEnv>();
slotAvailableDeleteChunkRoutes.use("*", costGuardMiddleware("manage_slot_delete"));
slotAvailableDeleteChunkRoutes.post("/delete-available-chunk", async (c) => {
  c.header("Cache-Control", NO_STORE);
  const user = c.get("user");
  if (!user) return c.json({ ok: false, message: "ログインが必要です。" }, 401);
  const eventId = c.req.param("id") ?? "";
  if (!ID_PATTERN.test(eventId)) {
    return c.json({ ok: false, message: "イベントIDが不正です。" }, 400);
  }
  const db = c.get("db");
  if (!db || !c.get("auditSettings") || !c.get("actorSnapshotJsonById")) {
    return c.json({ ok: false, message: WRITE_FAILED }, 503);
  }
  try {
    // One SELECT: event existence, approved linked staff, 4-row sentinel.
    const read = await c.env.DB.prepare(SLOT_AVAILABLE_DELETE_CHUNK_SNAPSHOT_SQL)
      .bind(eventId, eventId, user.id, eventId)
      .first<AvailableDeleteChunkRead>();
    if (!read) return c.json({ ok: false, message: WRITE_FAILED }, 503);
    // Before even parsing row_json, deny missing events and unauthorized actors
    // identically: no per-event existence/status oracle.
    if (!canUpdateEventLabels(user.role, read.staff_json) || !read.exists_id) {
      return c.json({ ok: false, message: "Not Found" }, 404);
    }
    const guard = verifySlotChunkCostGuard(read.cost_guard_json, "manage_slot_delete");
    if (!guard.approved) return writeGuardDenyResponse(c, guard.reason, 503);
    const selection = selectAvailableDeleteChunk(eventId, read);
    if (!selection.ok) {
      return c.json({ ok: false, message: selection.message }, 409);
    }
    if (selection.rows.length === 0) {
      // Never return an "all deleted" success from a read-time empty snapshot.
      return c.json({ ok: false, message: "この時点で削除対象の空き枠はありません。" }, 409);
    }
    const plan = buildAvailableDeleteChunkAtomicPlan({ eventId, selection });
    const queue = await buildSlotChangeQueueBatch(db, {
      eventId, reason: "slot_admin_delete_available", requestedByUserId: user.id,
    });
    await mutateWithAudit(db, {
      preMutationAssertions: [
        db.run(buildSlotChunkScopeAssertion({ eventId, actorUserId: user.id, actorRole: user.role, staffJson: read.staff_json })),
        db.run(buildSlotChunkCostGuardAssertion(guard)),
        ...plan.preMutationAssertions.map((statement) => db.run(statement)),
      ],
      mutationStatements: [db.run(plan.mutationStatement), ...queue.statements],
      expectedMutationChanges: [plan.expectedMutationChanges, ...queue.expectedChanges],
      audits: selection.rows.map((row) => ({
        table_name: "slots" as const,
        target_id: row.id,
        operation: "DELETE" as const,
        before: { ...row },
        actor_user_id: user.id,
        retention_class: "normal" as const,
        strict: true,
      })),
      preloaded: auditPreloaded(c),
    });
    return c.json({
      ok: true,
      deletedThisChunk: plan.processedCount,
      moreAtSnapshot: plan.moreAtSnapshot,
      // Even when false, newer available slots might exist after the read.
      completionVerified: false,
      pendingPublicReflection: queue.statements.length > 0,
    }, 200);
  } catch (error) {
    console.error("[MIG-0656] SA-059 one-chunk deletion failed");
    return c.json({ ok: false, message: WRITE_FAILED }, isWriteConflict(error) ? 409 : 503);
  }
});
