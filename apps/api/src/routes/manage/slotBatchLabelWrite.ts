/**
 * MIG-0656 U02c-0: SA-064 complete label-write Hono candidate, UNMOUNTED.
 *
 * Parent router MUST put Origin -> session -> writeGuard -> dbMiddleware on
 * this path before mount. This module enforces manage_slot_update CostGuard,
 * approved linked event.slots permission, bounded JSON, 3-row CAS, strict
 * before/after audit and the durable slot-change projection queue in one D1
 * batch. Under D-0603-1/D-13-41, wake=0 by design; parent middleware replay,
 * actual D1 parity and human review still gate mount.
 */
import { Hono } from "hono";
import { SlotBatchLabelsBodySchema } from "@flamenode/contracts";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { buildSlotChangeQueueBatch } from "@flamenode/server-core/staticRebuild/hooks";
import type { AppEnv } from "../../env.ts";
import { extractSessionToken } from "../../auth/session.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "../admin/body.ts";
import { SLOT_BATCH_WRITE_SNAPSHOT_SQL, parseSlotRows, canUpdateEventLabels, buildSlotChunkSessionAssertion, buildSlotChunkScopeAssertion } from "./slotWriteScopedRead.ts";
import { verifySlotChunkCostGuard, buildSlotChunkCostGuardAssertion } from "./slotChunkCostGuard.ts";
import { writeGuardDenyResponse } from "../../middleware/writeOrigin.ts";
import { selectSlotBatchRows } from "./slotWriteSelection.ts";
import { buildSlotBatchAtomicPlan } from "./slotWriteMutations.ts";
import { isWriteConflict } from "../events/templates.ts";

const NO_STORE = "private, no-store";
const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const WRITE_FAILED = "枠の更新に失敗しました。再読み込み後にお試しください。";

/** CURRENT typeof slots.$inferSelect: full snapshots, not list-view rows. */
/**
 * The parent index.ts intentionally does not mount this router while other
 * SA-056..063 handlers and post-commit queue wake integration are incomplete.
 */
export const slotBatchLabelWriteRoutes = new Hono<AppEnv>();
slotBatchLabelWriteRoutes.use("*", costGuardMiddleware("manage_slot_update"));
slotBatchLabelWriteRoutes.patch("/labels", async (c) => {
  c.header("Cache-Control", NO_STORE);
  const user = c.get("user");
  if (!user) return c.json({ ok: false, message: "ログインが必要です。" }, 401);
  const eventId = c.req.param("id") ?? "";
  if (!EVENT_ID_PATTERN.test(eventId)) {
    return c.json({ ok: false, message: "イベントIDが不正です。" }, 400);
  }
  const body = await readAdminJsonBody(c.req.raw);
  if (body.kind === "too_large") {
    return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
  }
  if (body.kind !== "ok") {
    return c.json({ ok: false, message: "入力エラー" }, 400);
  }
  const parsed = SlotBatchLabelsBodySchema.safeParse(body.value);
  if (!parsed.success) return c.json({ ok: false, message: "入力エラー" }, 400);
  // Require the real parent Auth.js session identity; a standalone stub must
  // supply the same token explicitly, never a fabricated session on writes.
  const sessionToken = c.get("sessionState") === "user"
    ? extractSessionToken(c.req.header("cookie"), { secure: new URL(c.req.url).protocol === "https:" })
    : null;
  if (!sessionToken) return c.json({ ok: false, message: WRITE_FAILED }, 503);
  const db = c.get("db");
  if (!db || !c.get("auditSettings") || !c.get("actorSnapshotJsonById")) {
    return c.json({ ok: false, message: WRITE_FAILED }, 503);
  }

  try {
    const read = await c.env.DB.prepare(SLOT_BATCH_WRITE_SNAPSHOT_SQL)
      .bind(eventId, eventId, user.id, eventId, JSON.stringify(parsed.data.slot_ids))
      .first<{ exists_id: string | null; staff_json: string | null; slots_json: string | null; cost_guard_json: string | null }>();
    if (!read) return c.json({ ok: false, message: WRITE_FAILED }, 503);
    // Authorization precedes event-existence disclosure (404 for both).
    if (!canUpdateEventLabels(user.role, read.staff_json)) {
      return c.json({ ok: false, message: "Not Found" }, 404);
    }
    if (!read.exists_id) return c.json({ ok: false, message: "Not Found" }, 404);
    const guard = verifySlotChunkCostGuard(read.cost_guard_json, "manage_slot_update");
    if (!guard.approved) return writeGuardDenyResponse(c, guard.reason, 503);
    const current = parseSlotRows(read.slots_json);
    const selection = selectSlotBatchRows(eventId, parsed.data.slot_ids, current, "update-labels");
    if (!selection.ok) return c.json({ ok: false, message: selection.message }, 409);

    const now = Math.floor(Date.now() / 1000);
    const plan = buildSlotBatchAtomicPlan({
      kind: "update-labels", eventId, rows: selection.rows,
      updatedAt: now, label: parsed.data.label,
    });
    const queue = await buildSlotChangeQueueBatch(db, {
      eventId, reason: "slot_admin_label_update", requestedByUserId: user.id,
    });
    const audits = selection.rows.map((row) => ({
      table_name: "slots" as const, target_id: row.id,
      operation: "UPDATE" as const,
      before: { ...row },
      after: { ...row, slot_label: parsed.data.label, updated_at: now, version: row.version + 1 },
      actor_user_id: user.id,
      retention_class: "normal" as const, strict: true,
    }));
    await mutateWithAudit(db, {
      mutationStatements: [db.run(plan.mutationStatement), ...queue.statements],
      expectedMutationChanges: [plan.expectedMutationChanges, ...queue.expectedChanges],
      preMutationAssertions: [
        db.run(buildSlotChunkSessionAssertion(user.id, sessionToken)),
        db.run(buildSlotChunkScopeAssertion({ eventId, actorUserId: user.id, actorRole: user.role, staffJson: read.staff_json })),
        db.run(buildSlotChunkCostGuardAssertion(guard)),
        ...plan.preMutationAssertions.map((assertion) => db.run(assertion)),
      ],
      audits,
      preloaded: auditPreloaded(c),
    });
    return c.json({
      ok: true, message: String(selection.rows.length) + "件のラベルを更新しました。",
      ...(queue.statements.length ? { pendingPublicReflection: true } : {}),
    }, 200);
  } catch (error) {
    console.error("[MIG-0656] slot labels update failed");
    return c.json({ ok: false, message: WRITE_FAILED }, isWriteConflict(error) ? 409 : 503);
  }
});
