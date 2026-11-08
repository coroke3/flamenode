/**
 * MIG-0656 U03f: SA-056 and SA-057 Hono mutation candidates.
 *
 * UNMOUNTED: this file is deliberately NOT imported in manage/index.ts.
 * D-15-10 parent must guarantee Origin BEFORE Auth.js session, requireAuth,
 * TOS/writeGuard, DB/audit preloads and event.slots-scoped staff permission.
 *
 * Max S3 prereads: anchor+approved-linked staff, exact RAW group (if grouped),
 * complete video audit before + submitted refs (if video). One atomic audited
 * D1 batch: RAW-group/full-slot and all-video-refs CAS, exact slot/video DML,
 * 1-21 strict long audits, three static rebuild queue intents and DM Outbox.
 * No immediate Queue wake and no direct mutation outside mutateWithAudit.
 */
import { Hono, type Context } from "hono";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { buildSlotChangeQueueBatch } from "@flamenode/server-core/staticRebuild/hooks";
import type { AppEnv } from "../../env.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { auditPreloaded } from "../admin/body.ts";
import { isWriteConflict } from "../events/templates.ts";
import {
  SLOT_SUBMITTED_DANGER_ANCHOR_SQL,
  SLOT_SUBMITTED_DANGER_RAW_GROUP_SQL,
  SLOT_SUBMITTED_DANGER_VIDEO_REFS_SQL,
  selectAuthorizedSubmittedDangerAnchor,
  needsSubmittedDangerGroupRead,
  submittedDangerVideoReadId,
  decodeSubmittedDangerReads,
  type SubmittedDangerAnchorRead,
  type SubmittedDangerGroupRead,
  type SubmittedDangerVideoRefsRead,
} from "./slotSubmittedDangerSnapshot.ts";
import { buildSubmittedDangerAtomicPlan } from "./slotSubmittedDangerMutation.ts";
import { buildSubmittedDangerStrictAudits } from "./slotSubmittedDangerAudit.ts";
import { buildSubmittedDangerOutboxStatements } from "./slotSubmittedDangerOutbox.ts";
import type { SubmittedDangerKind } from "./slotSubmittedDangerSelection.ts";

const NO_STORE = "private, no-store";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const WRITE_FAILED = "提出済み枠の変更に失敗しました。画面を更新して再試行してください。";

/** This router MUST remain unmounted pending independent reviewer/Lead gate. */
export const slotSubmittedDangerRoutes = new Hono<AppEnv>();
slotSubmittedDangerRoutes.use("*", costGuardMiddleware("manage_slot_update"));

async function submittedDanger(c: Context<AppEnv>, kind: SubmittedDangerKind) {
  c.header("Cache-Control", NO_STORE);
  const user = c.get("user");
  if (!user) return c.json({ ok: false, message: "ログインが必要です。" }, 401);
  const eventId = c.req.param("id") ?? "";
  const slotId = c.req.param("slotId") ?? "";
  if (!ID_PATTERN.test(eventId) || !ID_PATTERN.test(slotId)) {
    return c.json({ ok: false, message: "イベントIDまたは枠IDが不正です。" }, 400);
  }
  const db = c.get("db");
  if (!db || !c.get("auditSettings") || !c.get("actorSnapshotJsonById")) {
    return c.json({ ok: false, message: WRITE_FAILED }, 503);
  }

  try {
    // Read #1. The same 404 for denied and nonexistent event is returned
    // BEFORE the raw group/video query and BEFORE any mutation or queue plan.
    const first = await c.env.DB.prepare(SLOT_SUBMITTED_DANGER_ANCHOR_SQL)
      .bind(eventId, eventId, user.id, eventId, slotId)
      .first<SubmittedDangerAnchorRead>();
    if (!first) return c.json({ ok: false, message: WRITE_FAILED }, 503);
    const authorized = selectAuthorizedSubmittedDangerAnchor({
      eventId, slotId, actorRole: user.role, read: first,
    });
    if (!authorized.ok) {
      return c.json(
        { ok: false, message: authorized.message },
        authorized.message === "Not Found" ? 404 : 409,
      );
    }

    // Read #2, only when JS-trim classifies a nonempty group. Always bind
    // the untouched stored key: SQL trim() differs for Unicode whitespace.
    const groupRead = needsSubmittedDangerGroupRead(authorized.anchor)
      ? await c.env.DB.prepare(SLOT_SUBMITTED_DANGER_RAW_GROUP_SQL)
        .bind(eventId, authorized.anchor.reservation_group_id)
        .first<SubmittedDangerGroupRead>()
      : null;
    if (needsSubmittedDangerGroupRead(authorized.anchor) && !groupRead) {
      return c.json({ ok: false, message: WRITE_FAILED }, 503);
    }

    // Read #3, only when a nonblank video ID is present. For SA-057, a
    // missing video is rejected by decodeSubmittedDangerReads (fail closed).
    const videoId = submittedDangerVideoReadId(authorized.anchor);
    const videoRead = videoId
      ? await c.env.DB.prepare(SLOT_SUBMITTED_DANGER_VIDEO_REFS_SQL)
        .bind(videoId, videoId)
        .first<SubmittedDangerVideoRefsRead>()
      : null;
    if (videoId && !videoRead) {
      return c.json({ ok: false, message: WRITE_FAILED }, 503);
    }
    const selection = decodeSubmittedDangerReads({
      kind, eventId, slotId, authorized, groupRead, videoRead,
    });
    if (!selection.ok) {
      return c.json({ ok: false, message: selection.message }, 409);
    }
    const now = Math.floor(Date.now() / 1000);
    const plan = buildSubmittedDangerAtomicPlan({
      kind, eventId, selection, updatedAt: now,
    });
    const audits = buildSubmittedDangerStrictAudits({
      kind, selection, plan, actorUserId: user.id, updatedAt: now,
    });
    const queue = await buildSlotChangeQueueBatch(db, {
      eventId,
      reason: kind === "force-release"
        ? "slot_admin_force_release_submitted"
        : "slot_admin_release_submitted_video",
      requestedByUserId: user.id,
    });
    const notifications = buildSubmittedDangerOutboxStatements({
      kind, eventId, slotId, selection,
      siteOrigin: c.env.NEXT_PUBLIC_SITE_URL ?? "",
      createdAt: now,
    });
    // Changes and the audit/outbox/queue are inseparable: all statements
    // are compiled and committed via one mutateWithAudit D1 batch.
    await mutateWithAudit(db, {
      preMutationAssertions: plan.preMutationAssertions.map((item) => db.run(item)),
      mutationStatements: [
        ...plan.mutationStatements.map((item) => db.run(item)),
        ...queue.statements,
      ],
      expectedMutationChanges: [
        ...plan.expectedMutationChanges,
        ...queue.expectedChanges,
      ],
      audits,
      postAuditStatements: notifications.statements.map((item) => db.run(item)),
      preloaded: auditPreloaded(c),
    });
    return c.json({
      ok: true,
      message: kind === "force-release"
        ? String(selection.rows.length) + "件の提出済み枠を解放しました。"
        : String(selection.rows.length) + "件の提出作品を解除し、予約枠を維持しました。",
      ...(queue.statements.length ? { pendingPublicReflection: true } : {}),
    }, 200);
  } catch (error) {
    console.error("[MIG-0656] submitted danger mutation failed");
    return c.json(
      { ok: false, message: WRITE_FAILED },
      isWriteConflict(error) ? 409 : 503,
    );
  }
}

/** Explicit paths, both POST-only; they do not overlap existing SA-060. */
slotSubmittedDangerRoutes.post("/:slotId/force-release-submitted", (c) =>
  submittedDanger(c, "force-release"));
slotSubmittedDangerRoutes.post("/:slotId/release-submitted-video", (c) =>
  submittedDanger(c, "keep-reservation"));
