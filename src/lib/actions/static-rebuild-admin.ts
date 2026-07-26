"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDatabase } from "@/lib/cloudflare";
import type { DB } from "@/lib/db/client";
import { events, staticRebuildQueue, videos, xUsers } from "@/lib/db/schema";
import { requireAdminWrite } from "@/lib/auth/writeGuard";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { mutateWithAudit } from "@/lib/audit/mutate";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import {
  isStaticRebuildTargetType,
  type EnqueueStaticRebuildInput,
} from "@/lib/staticRebuild/types";
import { PUBLIC_LISTABLE_X_APPROVAL_STATUSES } from "@/lib/utils/publicXUser";
import {
  readStaticBackfillState,
  writeStaticBackfillState,
} from "@/lib/staticRebuild/backfillState";
import {
  STATIC_BACKFILL_KINDS,
  withStaticBackfillRun,
  type StaticBackfillKind,
  type StaticBackfillRunState,
} from "@/lib/staticRebuild/backfillStateCore";

const BULK_RETRY_MAX = 8;
const BACKFILL_BATCH_SIZE = 12;
type Row = typeof staticRebuildQueue.$inferSelect;

function parseCursor(value: FormDataEntryValue | null): string {
  const cursor = String(value ?? "").trim();
  if (cursor.length > 128) {
    throw new Error("backfill_cursor_too_long");
  }
  return cursor;
}

async function countBackfillTargets(
  db: DB,
  kind: StaticBackfillKind,
): Promise<number> {
  if (kind === "video_v2") {
    const row = (
      await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(videos)
        .where(eq(videos.visibility_status, "public"))
    )[0];
    return Math.max(0, Number(row?.count ?? 0));
  }

  if (kind === "user_profile") {
    const row = (
      await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(xUsers)
        .where(
          inArray(xUsers.approval_status, [
            ...PUBLIC_LISTABLE_X_APPROVAL_STATUSES,
          ]),
        )
    )[0];
    return Math.max(0, Number(row?.count ?? 0));
  }

  const row = (
    await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(events)
      .where(eq(events.visibility_status, "public"))
  )[0];

  return Math.max(0, Number(row?.count ?? 0));
}

async function enqueueBackfillRows(args: {
  kind: StaticBackfillKind;
  cursor: string;
  restart: boolean;
  previous: StaticBackfillRunState;
  actorUserId: string;
  db: DB;
}): Promise<{
  run: StaticBackfillRunState;
  scannedThisBatch: number;
  enqueuedThisBatch: number;
}> {
  const total = await countBackfillTargets(args.db, args.kind);
  const limit = BACKFILL_BATCH_SIZE + 1;
  let selected: { id: string }[] = [];

  if (args.kind === "video_v2") {
    selected = await args.db
      .select({ id: videos.id })
      .from(videos)
      .where(
        args.cursor
          ? and(
              eq(videos.visibility_status, "public"),
              gt(videos.id, args.cursor),
            )!
          : eq(videos.visibility_status, "public"),
      )
      .orderBy(asc(videos.id))
      .limit(limit);
  } else if (args.kind === "user_profile") {
    selected = await args.db
      .select({ id: xUsers.id })
      .from(xUsers)
      .where(
        args.cursor
          ? and(
              inArray(xUsers.approval_status, [
                ...PUBLIC_LISTABLE_X_APPROVAL_STATUSES,
              ]),
              gt(xUsers.id, args.cursor),
            )!
          : inArray(xUsers.approval_status, [
              ...PUBLIC_LISTABLE_X_APPROVAL_STATUSES,
            ]),
      )
      .orderBy(asc(xUsers.id))
      .limit(limit);
  } else {
    selected = await args.db
      .select({ id: events.id })
      .from(events)
      .where(
        args.cursor
          ? and(
              eq(events.visibility_status, "public"),
              gt(events.id, args.cursor),
            )!
          : eq(events.visibility_status, "public"),
      )
      .orderBy(asc(events.id))
      .limit(limit);
  }

  const hasMore = selected.length > BACKFILL_BATCH_SIZE;
  const batch = selected.slice(0, BACKFILL_BATCH_SIZE);
  const now = Math.floor(Date.now() / 1000);
  const baseScanned = args.restart ? 0 : args.previous.scanned;
  const baseEnqueued = args.restart ? 0 : args.previous.enqueued;

  if (batch.length === 0) {
    return {
      scannedThisBatch: 0,
      enqueuedThisBatch: 0,
      run: {
        cursor: null,
        status: "completed",
        total,
        scanned: Math.max(baseScanned, total),
        enqueued: baseEnqueued,
        last_error: null,
        last_run_at: now,
      },
    };
  }

  const targetType =
    args.kind === "video_v2"
      ? ("video" as const)
      : args.kind === "user_profile"
        ? ("user" as const)
        : ("event" as const);
  const reason = `backfill_${args.kind}`;

  const prerequisiteTargets: EnqueueStaticRebuildInput[] =
    args.kind === "video_v2" && !args.cursor
      ? [
          {
            targetType: "youtube_related_blocklist",
            targetId: "global",
            reason: "backfill_video_v2_prerequisite",
            priority: "high",
            requestedByUserId: args.actorUserId,
          },
          {
            targetType: "random_video_pool",
            targetId: "global",
            reason: "backfill_video_v2_prerequisite",
            priority: "normal",
            requestedByUserId: args.actorUserId,
          },
        ]
      : [];

  const itemTargets: EnqueueStaticRebuildInput[] = batch.map((row) => ({
    targetType,
    targetId: row.id,
    reason,
    priority: "low",
    requestedByUserId: args.actorUserId,
  }));

  const queue = await buildStaticRebuildQueueBatch(args.db, [
    ...prerequisiteTargets,
    ...itemTargets,
  ]);

  if (queue.statements.length > 0) {
    await mutateWithAudit(args.db, {
      mutationStatements: queue.statements,
      expectedMutationChanges: queue.expectedChanges,
      audits: [
        {
          table_name: "static_rebuild_queue",
          target_id: `backfill:${args.kind}:${batch[0]?.id ?? "empty"}`,
          operation: "CREATE",
          after: {
            kind: args.kind,
            scanned: batch.length,
            cursor: args.cursor || null,
            next_cursor: hasMore ? (batch.at(-1)?.id ?? null) : null,
          },
          actor_user_id: args.actorUserId,
          context: "admin_static_backfill",
          reason: "静的JSON段階的バックフィル",
          retention_class: "normal",
          strict: true,
        },
      ],
      staticRebuildWakeSource: "admin",
    });
  }

  const itemExpectedChanges = queue.expectedChanges.slice(
    prerequisiteTargets.length,
  );
  const enqueuedThisBatch = itemExpectedChanges.reduce(
    (sum, value) => sum + Math.max(0, Number(value ?? 0)),
    0,
  );

  return {
    scannedThisBatch: batch.length,
    enqueuedThisBatch,
    run: {
      cursor: hasMore ? (batch.at(-1)?.id ?? null) : null,
      status: hasMore ? "running" : "completed",
      total,
      scanned: baseScanned + batch.length,
      enqueued: baseEnqueued + enqueuedThisBatch,
      last_error: null,
      last_run_at: now,
    },
  };
}

export async function enqueueStaticBackfillBatch(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminWrite("admin_static_rebuild");
  if (!guard.ok) return;

  const kind = String(formData.get("kind") ?? "") as StaticBackfillKind;
  if (!STATIC_BACKFILL_KINDS.includes(kind)) {
    return;
  }

  const mode = String(formData.get("mode") ?? "continue");
  const restart = mode === "restart";
  const requestedCursor = parseCursor(formData.get("cursor"));

  const state = await readStaticBackfillState();
  const previous = state.runs[kind];
  const cursor = restart
    ? ""
    : requestedCursor || previous.cursor || "";

  try {
    const result = await enqueueBackfillRows({
      kind,
      cursor,
      restart,
      previous,
      actorUserId: guard.user.id,
      db: guard.db,
    });

    const now = Math.floor(Date.now() / 1000);
    const nextState = withStaticBackfillRun(state, kind, result.run, now);
    const statePersisted = await writeStaticBackfillState(nextState);

    revalidatePath("/admin/static-builds");

    const params = new URLSearchParams({
      backfill_kind: kind,
      backfill_scanned: String(result.scannedThisBatch),
      backfill_enqueued: String(result.enqueuedThisBatch),
      backfill_done: result.run.status === "completed" ? "1" : "0",
      backfill_state_persisted: statePersisted ? "1" : "0",
    });

    if (result.run.cursor) {
      params.set("backfill_cursor", result.run.cursor);
    }

    redirect(`/admin/static-builds?${params.toString()}`);
  } catch (error) {
    const now = Math.floor(Date.now() / 1000);
    const message =
      error instanceof Error
        ? error.message
        : "static_backfill_unknown_error";

    const failedState = withStaticBackfillRun(
      state,
      kind,
      {
        ...previous,
        status: "failed",
        last_error: message.slice(0, 1000),
        last_run_at: now,
      },
      now,
    );

    const statePersisted = await writeStaticBackfillState(failedState);

    const params = new URLSearchParams({
      backfill_kind: kind,
      backfill_error: message.slice(0, 240),
      backfill_state_persisted: statePersisted ? "1" : "0",
    });

    redirect(`/admin/static-builds?${params.toString()}`);
  }
}

async function retryRows(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  rows: Row[],
  actor: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const statements: BatchItem<"sqlite">[] = [];
  const audits: WriteAuditLogInput[] = [];
  for (const before of rows) {
    const patch = {
      status: "pending" as const,
      priority: "high" as const,
      next_retry_at: null,
      error: null,
      lease_token: null,
      lease_expires_at: null,
      updated_at: now,
    };
    const after = { ...before, ...patch };
    statements.push(
      db
        .update(staticRebuildQueue)
        .set(patch)
        .where(
          and(
            eq(staticRebuildQueue.id, before.id),
            expectedRowCondition({ expectedCurrent: { ...before } }),
          )!,
        ),
    );
    audits.push({
      table_name: "static_rebuild_queue",
      target_id: before.id,
      operation: "UPDATE",
      before: { ...before },
      after: { ...after },
      actor_user_id: actor,
      context: "admin_static_rebuild_retry",
      reason: "失敗した静的再生成を手動リトライ",
      retention_class: "normal",
      strict: true,
    });
  }
  await mutateWithAudit(db, {
    mutationStatements: statements,
    expectedMutationChanges: rows.map(() => 1),
    audits,
  });
}

export async function retryFailedStaticRebuild(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminWrite("admin_static_rebuild");
  if (!guard.ok) return;
  const id = String(formData.get("queue_id") ?? "").trim();
  if (!id || id.length > 128) return;
  const { db } = guard;
  const row = (
    await db.select().from(staticRebuildQueue).where(eq(staticRebuildQueue.id, id)).limit(1)
  )[0];
  if (!row || row.status !== "failed") return;
  await retryRows(db, [row], guard.user.id);
  revalidatePath("/admin/static-builds");
}

export async function enqueueStaticRebuildAdmin(
  formData: FormData,
): Promise<void> {
  const guard = await requireAdminWrite("admin_static_rebuild");
  if (!guard.ok) return;
  const targetType = String(formData.get("target_type") ?? "").trim();
  const targetId = String(formData.get("target_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "manual_rebuild").trim();
  if (
    !isStaticRebuildTargetType(targetType) ||
    !targetId ||
    targetId.length > 128 ||
    !reason ||
    reason.length > 500
  ) {
    return;
  }
  const { db } = guard;
  const queue = await buildStaticRebuildQueueBatch(db, [
    {
      targetType,
      targetId,
      reason,
      priority: "high",
      requestedByUserId: guard.user.id,
    },
  ]);
  if (queue.statements.length === 0) return;
  await mutateWithAudit(db, {
    mutationStatements: queue.statements,
    expectedMutationChanges: queue.expectedChanges,
    audits: [
      {
        table_name: "static_rebuild_queue",
        target_id: `manual:${targetType}:${targetId}`,
        operation: "CREATE",
        after: {
          target_type: targetType,
          target_id: targetId,
          reason,
          priority: "high",
          requested_by_user_id: guard.user.id,
        },
        actor_user_id: guard.user.id,
        context: "admin_static_rebuild_enqueue",
        reason: "静的再生成を手動登録",
        retention_class: "normal",
        strict: true,
      },
    ],
    staticRebuildWakeSource: "admin",
  });
  revalidatePath("/admin/static-builds");
}

export async function retryAllFailedStaticRebuild(): Promise<void> {
  const guard = await requireAdminWrite("admin_static_rebuild");
  if (!guard.ok) return;
  const { db } = guard;
  const rows = await db
    .select()
    .from(staticRebuildQueue)
    .where(eq(staticRebuildQueue.status, "failed"))
    .orderBy(asc(staticRebuildQueue.created_at))
    .limit(BULK_RETRY_MAX + 1);
  const targets = rows.slice(0, BULK_RETRY_MAX);
  if (targets.length === 0) return;
  await retryRows(db, targets, guard.user.id);
  revalidatePath("/admin/static-builds");
}
