/**
 * MIG-0656 U02c-3: SA-063 batch release Hono candidate, UNMOUNTED.
 * The parent D-15-10 Origin -> session -> writeGuard -> db stack MUST be
 * registered and tested BEFORE this module can be mounted in manage/index.
 * CURRENT parity: 3-row bound group selection, CAS+same-batch phantom
 * assertion, long audits, post-audit DM outbox, rebuild queue. Zero wakes.
 */
import { Hono } from "hono";
import { SlotBatchIdsBodySchema } from "@flamenode/contracts";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { buildSlotChangeQueueBatch } from "@flamenode/server-core/staticRebuild/hooks";
import type { AppEnv } from "../../env.ts";
import { extractSessionToken } from "../../auth/session.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "../admin/body.ts";
import { canUpdateEventLabels, buildSlotChunkSessionAssertion, buildSlotChunkScopeAssertion } from "./slotWriteScopedRead.ts";
import { verifySlotChunkCostGuard, buildSlotChunkCostGuardAssertion } from "./slotChunkCostGuard.ts";
import { writeGuardDenyResponse } from "../../middleware/writeOrigin.ts";
import {
  SLOT_BATCH_RELEASE_SNAPSHOT_SQL,
  selectBatchReservedReleaseSnapshot,
  type SlotBatchReleaseRead,
} from "./slotWriteGroupSnapshot.ts";
import { buildSlotBatchAtomicPlan } from "./slotWriteMutations.ts";
import { buildSlotReleaseOutboxStatements } from "./slotReleaseOutbox.ts";
import { isWriteConflict } from "../events/templates.ts";

const NO_STORE = "private, no-store";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const WRITE_FAILED = "予約枠の解放に失敗しました。再読み込み後にお試しください。";

export const slotBatchReservedReleaseRoutes = new Hono<AppEnv>();
slotBatchReservedReleaseRoutes.use("*", costGuardMiddleware("manage_slot_update"));
slotBatchReservedReleaseRoutes.post("/batch-release", async (c) => {
  c.header("Cache-Control", NO_STORE);
  const user = c.get("user");
  if (!user) return c.json({ ok: false, message: "ログインが必要です。" }, 401);
  const eventId = c.req.param("id") ?? "";
  if (!ID_PATTERN.test(eventId)) {
    return c.json({ ok: false, message: "イベントIDが不正です。" }, 400);
  }
  const body = await readAdminJsonBody(c.req.raw);
  if (body.kind === "too_large") {
    return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
  }
  if (body.kind !== "ok") return c.json({ ok: false, message: "入力エラー" }, 400);
  const validated = SlotBatchIdsBodySchema.safeParse(body.value);
  if (!validated.success) return c.json({ ok: false, message: "入力エラー" }, 400);
  // Require the real upstream Auth.js identity, not only a test stub user.
  const sessionToken = c.get("sessionState") === "user"
    ? extractSessionToken(c.req.header("cookie"), { secure: new URL(c.req.url).protocol === "https:" })
    : null;
  if (!sessionToken) return c.json({ ok: false, message: WRITE_FAILED }, 503);
  const db = c.get("db");
  if (!db || !c.get("auditSettings") || !c.get("actorSnapshotJsonById")) {
    return c.json({ ok: false, message: WRITE_FAILED }, 503);
  }

  try {
    // S3: parent writeGuard actor/TOS + this CostGuard + ONE scoped snapshot;
    // the same atomic batch rechecks session, scope and policy after this read.
    const values = JSON.stringify(validated.data.slot_ids);
    const read = await c.env.DB.prepare(SLOT_BATCH_RELEASE_SNAPSHOT_SQL)
      .bind(eventId, eventId, user.id, eventId, values, eventId, eventId, values)
      .first<SlotBatchReleaseRead>();
    if (!read) return c.json({ ok: false, message: WRITE_FAILED }, 503);
    // Permission before existence, preventing event-existence disclosure.
    if (!canUpdateEventLabels(user.role, read.staff_json) || !read.exists_id) {
      return c.json({ ok: false, message: "Not Found" }, 404);
    }
    const guard = verifySlotChunkCostGuard(read.cost_guard_json, "manage_slot_update");
    if (!guard.approved) return writeGuardDenyResponse(c, guard.reason, 503);
    const selection = selectBatchReservedReleaseSnapshot(
      eventId, validated.data.slot_ids, read,
    );
    if (!selection.ok) return c.json({ ok: false, message: selection.message }, 409);
    const now = Math.floor(Date.now() / 1000);
    const plan = buildSlotBatchAtomicPlan({
      kind: "release-reserved", eventId, rows: selection.rows, updatedAt: now,
    });
    const queue = await buildSlotChangeQueueBatch(db, {
      eventId, reason: "slot_admin_release", requestedByUserId: user.id,
    });
    const notifications = buildSlotReleaseOutboxStatements({
      eventId, rows: selection.rows, createdAt: now,
      siteOrigin: c.env.NEXT_PUBLIC_SITE_URL ?? "",
    });
    const audits = selection.rows.map((row) => ({
      table_name: "slots" as const,
      target_id: row.id,
      operation: "UPDATE" as const,
      before: { ...row },
      after: {
        ...row, status: "available", reserved_by_user_id: null,
        x_user_id: null, reserved_x_id_snapshot: null, display_name: null,
        reservation_group_id: null, video_id: null,
        updated_at: now, version: row.version + 1,
      },
      actor_user_id: user.id,
      retention_class: "long_audit" as const,
      strict: true,
    }));
    await mutateWithAudit(db, {
      preMutationAssertions: [
        db.run(buildSlotChunkSessionAssertion(user.id, sessionToken)),
        db.run(buildSlotChunkScopeAssertion({ eventId, actorUserId: user.id, actorRole: user.role, staffJson: read.staff_json })),
        db.run(buildSlotChunkCostGuardAssertion(guard)),
        ...plan.preMutationAssertions.map((statement) => db.run(statement)),
      ],
      mutationStatements: [db.run(plan.mutationStatement), ...queue.statements],
      expectedMutationChanges: [plan.expectedMutationChanges, ...queue.expectedChanges],
      audits,
      postAuditStatements: notifications.statements.map((statement) => db.run(statement)),
      preloaded: auditPreloaded(c),
    });
    return c.json({
      ok: true, message: String(selection.rows.length) + "件の予約枠を解放しました。",
      ...(queue.statements.length ? { pendingPublicReflection: true } : {}),
    }, 200);
  } catch (error) {
    console.error("[MIG-0656] batch reserved release failed");
    return c.json({ ok: false, message: WRITE_FAILED }, isWriteConflict(error) ? 409 : 503);
  }
});
