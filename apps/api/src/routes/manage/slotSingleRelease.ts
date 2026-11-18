/**
 * MIG-0656 U02c-5d: SA-060 single reserved-slot release Hono candidate.
 * UNMOUNTED. Only the D-15-10 guarded parent can safely activate it:
 * Origin before session, writeGuard/TOS, db, then CostGuard and event.slots.
 * CURRENT SA-060 allows the whole raw reservation group up to 20 members.
 *
 * One scoped D1 read, one mutateWithAudit D1 batch with phantom-group
 * assertion, full CAS, strict long audit, static rebuild intents and DM outbox.
 * No immediate Queue wake (D-0603-1 / D-13-41).
 */
import { Hono } from "hono";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { buildSlotChangeQueueBatch } from "@flamenode/server-core/staticRebuild/hooks";
import type { AppEnv } from "../../env.ts";
import { extractSessionToken } from "../../auth/session.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { auditPreloaded } from "../admin/body.ts";
import { canUpdateEventLabels, buildSlotChunkSessionAssertion, buildSlotChunkScopeAssertion } from "./slotWriteScopedRead.ts";
import { verifySlotChunkCostGuard, buildSlotChunkCostGuardAssertion } from "./slotChunkCostGuard.ts";
import { writeGuardDenyResponse } from "../../middleware/writeOrigin.ts";
import {
  SLOT_SINGLE_RELEASE_SNAPSHOT_SQL,
  selectSingleReservedReleaseSnapshot,
  type SlotSingleReleaseRead,
} from "./slotSingleReleaseSnapshot.ts";
import { buildSlotSingleReleaseAtomicPlan } from "./slotSingleReleaseMutation.ts";
import { buildSlotSingleReleaseOutboxStatements } from "./slotSingleReleaseOutbox.ts";
import { isWriteConflict } from "../events/templates.ts";

const NO_STORE = "private, no-store";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const WRITE_FAILED = "予約枠の解放に失敗しました。再読み込み後にお試しください。";

/** This router is NOT imported into manage/index.ts. */
export const slotSingleReleaseRoutes = new Hono<AppEnv>();
slotSingleReleaseRoutes.use("*", costGuardMiddleware("manage_slot_update"));
slotSingleReleaseRoutes.post("/:slotId/release", async (c) => {
  c.header("Cache-Control", NO_STORE);
  const user = c.get("user");
  if (!user) return c.json({ ok: false, message: "ログインが必要です。" }, 401);
  const eventId = c.req.param("id") ?? "";
  const slotId = c.req.param("slotId") ?? "";
  if (!ID_PATTERN.test(eventId) || !ID_PATTERN.test(slotId)) {
    return c.json({ ok: false, message: "イベントIDまたは枠IDが不正です。" }, 400);
  }
  // An offline candidate must never trust a synthetic user without the parent
  // Auth.js session identity. The token is bound only to the D1 assertion.
  const sessionToken = c.get("sessionState") === "user"
    ? extractSessionToken(c.req.header("cookie"), { secure: new URL(c.req.url).protocol === "https:" })
    : null;
  if (!sessionToken) return c.json({ ok: false, message: WRITE_FAILED }, 503);
  const db = c.get("db");
  if (!db || !c.get("auditSettings") || !c.get("actorSnapshotJsonById")) {
    return c.json({ ok: false, message: WRITE_FAILED }, 503);
  }
  try {
    // One SELECT for event existence, approved linked-staff grants,
    // the requested anchor and up to 21 raw group members.
    const read = await c.env.DB.prepare(SLOT_SINGLE_RELEASE_SNAPSHOT_SQL)
      .bind(eventId, eventId, user.id, eventId, slotId, eventId, eventId, slotId)
      .first<SlotSingleReleaseRead>();
    if (!read) return c.json({ ok: false, message: WRITE_FAILED }, 503);
    // No event/slot existence oracle for unauthorised actors.
    if (!canUpdateEventLabels(user.role, read.staff_json) || !read.exists_id) {
      return c.json({ ok: false, message: "Not Found" }, 404);
    }
    const guard = verifySlotChunkCostGuard(read.cost_guard_json, "manage_slot_update");
    if (!guard.approved) return writeGuardDenyResponse(c, guard.reason, 503);
    const selection = selectSingleReservedReleaseSnapshot(eventId, slotId, read);
    if (!selection.ok) {
      return c.json({ ok: false, message: selection.message }, 409);
    }
    const now = Math.floor(Date.now() / 1000);
    const plan = buildSlotSingleReleaseAtomicPlan({
      eventId, rows: selection.rows, updatedAt: now,
    });
    const queue = await buildSlotChangeQueueBatch(db, {
      eventId, reason: "slot_admin_release", requestedByUserId: user.id,
    });
    const notifications = buildSlotSingleReleaseOutboxStatements({
      eventId, rows: selection.rows, siteOrigin: c.env.NEXT_PUBLIC_SITE_URL ?? "",
      createdAt: now,
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
        ...plan.preMutationAssertions.map((item) => db.run(item)),
      ],
      mutationStatements: [db.run(plan.mutationStatement), ...queue.statements],
      expectedMutationChanges: [plan.expectedMutationChanges, ...queue.expectedChanges],
      audits,
      postAuditStatements: notifications.statements.map((item) => db.run(item)),
      preloaded: auditPreloaded(c),
    });
    return c.json({
      ok: true,
      message: String(selection.rows.length) + "件の予約枠を解放しました。",
      ...(queue.statements.length ? { pendingPublicReflection: true } : {}),
    }, 200);
  } catch (error) {
    console.error("[MIG-0656] single reserved release failed");
    return c.json({ ok: false, message: WRITE_FAILED }, isWriteConflict(error) ? 409 : 503);
  }
});
