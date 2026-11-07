/**
 * MIG-0652 U04 (SA-024) — Hono event archive / depublicize route candidate.
 * CURRENT: src/lib/actions/event-admin.ts#deleteEvent.
 *
 * NOT MOUNTED: apps/api/src/routes/events/index.ts must not register this
 * router until SA-021..024 permissions, D1 audit, R2 and Queue parity T01–T06
 * have independently passed. Parent /api/admin middleware supplies Origin,
 * authenticated session, admin writeGuard and the D1 adapter exactly once.
 */
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { events } from "@flamenode/db/schema";
import { EVENT_ID_PATTERN } from "@flamenode/domain/event";
import {
  mutateWithAudit,
  planD1AuditMutationBudget,
} from "@flamenode/server-core/audit/mutate";
import {
  planEventVisibilityTransition,
  compensateEventVisibilityFenceOnD1Failure,
} from "@flamenode/server-core/visibility/eventTransition";
import { buildEventChangeQueueBatch } from "@flamenode/server-core/staticRebuild/hooks";
import type { AppEnv } from "../env.ts";
import { BODY_TOO_LARGE_MESSAGE, auditPreloaded, readAdminJsonBody } from "../routes/admin/body.ts";
import { costGuardMiddleware } from "../middleware/costGuard.ts";
import { createEventVisibilityFenceHost } from "../visibility/eventTransitionHost.ts";
import { runEventWriteBehindVisibilityFence } from "../visibility/eventPrecommitGuard.ts";
import { createEventPostCommitCacheHost } from "../visibility/eventPostCommitHost.ts";

const NO_STORE = "private, no-store";
const ARCHIVE_PRECOMMIT_FAILURE = "イベント非公開化の安全な反映準備に失敗しました。";
const ARCHIVE_MUTATION_FAILURE = "イベント非公開化に失敗しました。状態を再取得してもう一度お試しください。";
const ARCHIVE_BUDGET_FAILURE = "イベント非公開化の原子的処理がD1の上限を超えます。";

/**
 * The URI ID is authoritative. Accept the legacy form's explicit event_id
 * and confirm, but never allow a body ID to select a different row.
 */
export function validateEventArchiveRequest(
  eventId: string,
  body: Record<string, unknown>,
): { ok: true; eventId: string } | { ok: false; message: string } {
  if (!eventId || !EVENT_ID_PATTERN.test(eventId)) {
    return { ok: false, message: "イベントIDが不正です。" };
  }
  const rawId = typeof body.event_id === "string" ? body.event_id.trim() : "";
  const confirm = typeof body.confirm === "string" ? body.confirm.trim() : "";
  if (!rawId) return { ok: false, message: "event_id が必要です。" };
  if (rawId !== eventId) {
    return { ok: false, message: "イベントIDが一致しません。" };
  }
  if (confirm !== eventId) {
    return { ok: false, message: "確認のため、イベント ID と同じ文字列を入力してください。" };
  }
  return { ok: true, eventId };
}

export const eventLifecycleRoutes = new Hono<AppEnv>();

// Defence-in-depth: if accidentally mounted without the admin parent, do not
// allow an anonymous or non-admin session to reach a state-changing handler.
eventLifecycleRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", NO_STORE);
  const user = c.get("user");
  if (!user || user.role !== "admin" || !c.get("db")) {
    return c.json({ ok: false, message: "操作する権限がありません。" }, 403);
  }
  await next();
});

eventLifecycleRoutes.delete("/:eventId", costGuardMiddleware("manage_event_archive"), async (c) => {
  c.header("Cache-Control", NO_STORE);
  const incoming = await readAdminJsonBody(c.req.raw);
  if (incoming.kind === "too_large") {
    return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
  }
  if (incoming.kind !== "ok") {
    return c.json({ ok: false, message: "入力エラー" }, 400);
  }

  const parsed = validateEventArchiveRequest(c.req.param("eventId"), incoming.value);
  if (!parsed.ok) return c.json({ ok: false, message: parsed.message }, 400);

  const eventId = parsed.eventId;
  const actorUserId = c.get("user")!.id;
  const db = c.get("db");
  try {
    const before = (await db.select().from(events).where(eq(events.id, eventId)).limit(1))[0];
    if (!before) return c.json({ ok: false, message: "イベントが見つかりません。" }, 404);

    const now = Math.max(Math.floor(Date.now() / 1000), before.updated_at + 1);
    const after = { ...before, visibility_status: "private" as const, updated_at: now };
    const visibilityTransition = planEventVisibilityTransition({
      db, eventId,
      previousStatus: before.visibility_status,
      nextStatus: "private",
      actorUserId,
      reason: "event_private",
      now,
    });
    const queue = await buildEventChangeQueueBatch(db, {
      eventId,
      reason: "event_private",
      requestedByUserId: actorUserId,
      priority: "high",
    });
    const mutationStatements = [
      db.update(events)
        .set({ visibility_status: "private", updated_at: now })
        .where(and(eq(events.id, eventId), eq(events.updated_at, before.updated_at))),
      ...visibilityTransition.mutationStatements,
      ...queue.statements,
    ];
    const expectedMutationChanges = [
      1,
      ...visibilityTransition.expectedMutationChanges,
      ...queue.expectedChanges,
    ];
    const audit = {
      table_name: "events" as const,
      target_id: eventId,
      operation: "UPDATE" as const,
      before,
      after,
      actor_user_id: actorUserId,
      retention_class: "long_audit" as const,
      strict: true,
    };
    // Preserve CURRENT's conservative 18-query reserve and one-audit budget.
    // All limit checks happen BEFORE an externally visible R2 manifest write.
    const budget = planD1AuditMutationBudget({
      mutationStatementCount: mutationStatements.length,
      mutationAssertionCount: mutationStatements.length,
      auditEntryCount: 1,
      distinctActorCount: 1,
    });
    if (!budget.withinLimit) {
      return c.json({ ok: false, message: ARCHIVE_BUDGET_FAILURE }, 409);
    }

    let d1CommitStarted = false;
    const host = createEventVisibilityFenceHost(c.env);
    try {
      await runEventWriteBehindVisibilityFence({
        eventId,
        fenceToken: visibilityTransition.fenceToken,
        reason: "event_private",
        visibilityHost: host,
        compensateOnFailure: async () => {
          if (!visibilityTransition.fenceToken) return;
          await compensateEventVisibilityFenceOnD1Failure(db, {
            eventId,
            fenceToken: visibilityTransition.fenceToken,
          }, host);
        },
        commit: async () => {
          d1CommitStarted = true;
          await mutateWithAudit(db, {
            mutationStatements,
            expectedMutationChanges,
            preloaded: auditPreloaded(c),
            audits: [audit],
            // D-0603-1: Hono intentionally sends zero Queue wakes.
            // The static rebuild queue rows remain in the atomic D1 batch.
          });
        },
      });
    } catch {
      console.error(d1CommitStarted
        ? "[MIG-0652] EVENT_ARCHIVE_COMMIT_FAILED"
        : "[MIG-0652] EVENT_ARCHIVE_PRECOMMIT_FAILED");
      return c.json({
        ok: false,
        message: d1CommitStarted ? ARCHIVE_MUTATION_FAILURE : ARCHIVE_PRECOMMIT_FAILURE,
      }, d1CommitStarted ? 500 : 503);
    }

    // Cache API invalidation is post-commit and best-effort. Next-only path
    // revalidation is intentionally not used by Hono.
    try {
      await createEventPostCommitCacheHost().archive(eventId);
    } catch {
      console.warn("[MIG-0652] EVENT_ARCHIVE_CACHE_INVALIDATION_FAILED");
    }
    return c.json({
      ok: true,
      ...(queue.statements.length > 0 ? { pendingPublicReflection: true } : {}),
    }, 200);
  } catch {
    // No provider error is interpolated into the response or logs.
    console.error("[MIG-0652] EVENT_ARCHIVE_FAILED");
    return c.json({ ok: false, message: ARCHIVE_MUTATION_FAILURE }, 500);
  }
});
