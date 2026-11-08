/**
 * MIG-0656 U02c-1: SA-062 batchDeleteAvailableSlots Hono candidate, UNMOUNTED.
 *
 * Only use after the parent Origin-before-session, writeGuard(TOS), DB adapter.
 * This feature enforces CostGuard manage_slot_delete, event.slots approved
 * linked staff, and a 3-row authoritative CAS snapshot. Strict per-row
 * DELETE audits, slot projections and exact changes commit in the same
 * mutateWithAudit D1 batch. Do not mount before post-commit wake parity and
 * independent review.
 */
import { Hono } from "hono";
import { SlotBatchIdsBodySchema } from "@flamenode/contracts";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { buildSlotChangeQueueBatch } from "@flamenode/server-core/staticRebuild/hooks";
import type { AppEnv } from "../../env.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "../admin/body.ts";
import { SLOT_BATCH_WRITE_SNAPSHOT_SQL, parseSlotRows, canUpdateEventLabels } from "./slotWriteScopedRead.ts";
import { selectSlotBatchRows } from "./slotWriteSelection.ts";
import { buildSlotBatchAtomicPlan } from "./slotWriteMutations.ts";
import { isWriteConflict } from "../events/templates.ts";

const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const NO_STORE = "private, no-store";
const WRITE_FAILED = "枠の削除に失敗しました。再読み込み後にお試しください。";

/** This router is intentionally NOT registered with manageRoutes. */
export const slotBatchAvailableDeleteRoutes = new Hono<AppEnv>();
slotBatchAvailableDeleteRoutes.use("*", costGuardMiddleware("manage_slot_delete"));
slotBatchAvailableDeleteRoutes.delete("/batch-available", async (c) => {
  c.header("Cache-Control", NO_STORE);
  const user = c.get("user");
  if (!user) return c.json({ ok: false, message: "ログインが必要です。" }, 401);
  const eventId = c.req.param("id") ?? "";
  if (!EVENT_ID_PATTERN.test(eventId)) {
    return c.json({ ok: false, message: "イベントIDが不正です。" }, 400);
  }
  const body = await readAdminJsonBody(c.req.raw);
  if (body.kind === "too_large") return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
  if (body.kind !== "ok") return c.json({ ok: false, message: "入力エラー" }, 400);
  const validated = SlotBatchIdsBodySchema.safeParse(body.value);
  if (!validated.success) return c.json({ ok: false, message: "入力エラー" }, 400);

  const db = c.get("db");
  if (!db || !c.get("auditSettings") || !c.get("actorSnapshotJsonById")) {
    return c.json({ ok: false, message: WRITE_FAILED }, 503);
  }
  try {
    const read = await c.env.DB.prepare(SLOT_BATCH_WRITE_SNAPSHOT_SQL)
      .bind(eventId, eventId, user.id, eventId, JSON.stringify(validated.data.slot_ids))
      .first<{ exists_id: string | null; staff_json: string | null; slots_json: string | null }>();
    if (!read) return c.json({ ok: false, message: WRITE_FAILED }, 503);
    // No event-existence oracle: permission checked first, including staff
    // 101-row fail-closed sentinel; admins bypass the staff-grant limit.
    if (!canUpdateEventLabels(user.role, read.staff_json)) {
      return c.json({ ok: false, message: "Not Found" }, 404);
    }
    if (!read.exists_id) return c.json({ ok: false, message: "Not Found" }, 404);
    const selection = selectSlotBatchRows(
      eventId, validated.data.slot_ids, parseSlotRows(read.slots_json), "delete-available",
    );
    if (!selection.ok) return c.json({ ok: false, message: selection.message }, 409);
    const plan = buildSlotBatchAtomicPlan({
      kind: "delete-available", eventId, rows: selection.rows,
    });
    const queue = await buildSlotChangeQueueBatch(db, {
      eventId, reason: "slot_admin_batch_delete", requestedByUserId: user.id,
    });
    await mutateWithAudit(db, {
      mutationStatements: [db.run(plan.mutationStatement), ...queue.statements],
      expectedMutationChanges: [plan.expectedMutationChanges, ...queue.expectedChanges],
      preMutationAssertions: plan.preMutationAssertions.map((assertion) => db.run(assertion)),
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
      created: selection.rows.length,
      message: String(selection.rows.length) + "件の枠を削除しました。",
      ...(queue.statements.length ? { pendingPublicReflection: true } : {}),
    }, 200);
  } catch (error) {
    console.error("[MIG-0656] slot batch available delete failed");
    return c.json({ ok: false, message: WRITE_FAILED }, isWriteConflict(error) ? 409 : 503);
  }
});
