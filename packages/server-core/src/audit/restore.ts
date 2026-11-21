import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { auditLogs, auditRestoreRuns, users, videoEvents } from "@flamenode/db/schema";
import { validateVideoPublicEligibility } from "@flamenode/domain/video";
import type { ServerCoreDb } from "../db.ts";
import { generateId } from "../id.ts";
import type { QueueWakeHostLoader } from "../ports.ts";
import { buildAfterVideoStatusChangeQueueBatch, buildEventChangeQueueBatch, MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS } from "../staticRebuild/hooks.ts";
import {
  compensateEventVisibilityFenceOnD1Failure,
  planEventVisibilityTransition,
  preCommitEventVisibilityTransition,
} from "../visibility/eventTransition.ts";
import type { VisibilityFenceHost } from "../visibility/manifestHost.ts";
import {
  compensateDepublicizationFenceOnD1Failure,
  planVideoVisibilityFenceTransition,
  preCommitVideoVisibilityDepublicization,
  type VideoPublicCacheKeyHost,
} from "../visibility/videoTransition.ts";
import { evaluateRestoreCapability } from "./capability.ts";
import { asBatchRunnable, assertChanges, mutateWithAudit } from "./mutate.ts";
import { getRestoreRegistration } from "./registry.ts";
import { computeChangedKeys } from "./snapshot.ts";
import {
  AuditOperation,
  RestoreFailureReason,
  RestoreStatus,
  RestoreStrategy,
  type RestoreOptions,
  type RestoreResult,
} from "./types.ts";

/** What audit restore needs from src: fence manifest, object key sets, cache/export invalidation and the Queue wake loader. */
export type AuditRestoreHost = VisibilityFenceHost & {
  publicCacheKeys: VideoPublicCacheKeyHost;
  deletePublicJsonCaches(r2Keys: readonly string[]): Promise<void>;
  invalidateEventExportCache(eventId: string): Promise<void>;
  loadQueueWakeHost: QueueWakeHostLoader;
};

function parseSnapshot(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const PERMANENT_RESTORE_REASONS = new Set([
  "payload_exceeded",
  "strategy_none",
  "strategy_unsupported",
  "adapter_missing",
  "before_missing",
  "after_missing",
  "snapshot_invalid",
  "snapshot_redacted",
  "primary_key_missing",
  "event_id_missing",
  "event_staff_subject_missing",
  "required_field_missing",
]);

function userPublicCacheKeys(xUserId: string | null, userMaxPages: number): string[] {
  if (!xUserId) return [];
  const keys = [`users/${xUserId}.json`];
  for (let page = 2; page <= userMaxPages; page += 1) {
    keys.push(`users/${xUserId}/works/${page}.json`);
    keys.push(`users/${xUserId}/collabs/${page}.json`);
  }
  return keys;
}

function sanitizeRestoreError(
  error: unknown,
): string {
  const raw =
    error instanceof Error
      ? error.message
      : String(error);

  return raw
    .replace(
      /(token|secret|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .slice(0, 1000);
}

async function persistFailedRestoreRun(args: {
  db: ServerCoreDb;
  auditId: string;
  userId: string;
  reason: string;
  reasonCode: string;
  message: string;
  now: number;
}): Promise<string> {
  const runId = generateId("rst");

  await args.db.insert(auditRestoreRuns).values({
    id: runId,
    audit_log_id: args.auditId,
    executed_by_user_id: args.userId,
    reason: args.reason,
    status: "failed",
    error_message: JSON.stringify({
      code: args.reasonCode,
      message: sanitizeRestoreError(args.message),
    }),
    executed_at: args.now,
  });

  return runId;
}

async function persistPermanentRestoreFailure(args: {
  db: ServerCoreDb;
  auditId: string;
  userId: string;
  reason: string;
  reasonCode: string;
  message: string;
  now: number;
  status?: RestoreStatus;
}): Promise<string> {
  const runId = generateId("rst");
  const status =
    args.status ?? RestoreStatus.not_restorable;

  const statements = [
    args.db
      .update(auditLogs)
      .set({
        restore_status: status,
        restore_unavailable_reason_code:
          args.reasonCode,
        restore_unavailable_message:
          sanitizeRestoreError(args.message),
      })
      .where(eq(auditLogs.id, args.auditId)),
    args.db.run(assertChanges(1)),
    args.db.insert(auditRestoreRuns).values({
      id: runId,
      audit_log_id: args.auditId,
      executed_by_user_id: args.userId,
      reason: args.reason,
      status: "failed",
      error_message: JSON.stringify({
        code: args.reasonCode,
        message: sanitizeRestoreError(args.message),
      }),
      executed_at: args.now,
    }),
    args.db.run(assertChanges(1)),
  ].map((statement) => asBatchRunnable(args.db, statement));

  await args.db.batch(
    statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
  );

  return runId;
}

/** Only explicitly enumerated invariant codes may be shown to the caller.
 * Arbitrary Drizzle/provider exceptions can contain SQL parameters, user data
 * and headers even when they have no token:/secret: prefix.
 */
function publicRestoreMutationFailureMessage(error: unknown): string {
  const prefix = "復元を確定できませんでした。変更はロールバックされました";
  if (error instanceof Error && error.message === "video_status_rebuild_event_limit_exceeded") {
    return `${prefix}: video_status_rebuild_event_limit_exceeded`;
  }
  return `${prefix}。`;
}

/** Preserve only intentional adapter diagnostics, never arbitrary SQL/provider errors. */
function publicRestoreBuildFailureMessage(error: unknown): string {
  const safeCodes = new Set([
    "video_members_set_snapshot_invalid",
    "video_members_set_target_mismatch",
  ]);
  if (error instanceof Error && safeCodes.has(error.message)) {
    return error.message;
  }
  return "復元mutationを作成できません。";
}

/**
 * 復元本体、復元履歴、元ログの状態更新、RESTORE 監査ログを単一 D1 batch で確定する。
 * いずれか一つでも失敗した場合は、復元対象を含めて全て rollback される。
 */
export async function restoreAuditLog(
  db: ServerCoreDb,
  options: RestoreOptions,
  host: AuditRestoreHost,
): Promise<RestoreResult> {
  const { auditId, userId, reason, forceOverwrite = false, dry_run = false, confirmText } = options;
  if (!dry_run && confirmText?.trim() !== `RESTORE ${auditId}`) {
    return { ok: false, message: `確認テキスト「RESTORE ${auditId}」を入力してください。` };
  }
  if (!dry_run && !reason.trim()) {
    return { ok: false, message: "復元理由を入力してください。" };
  }

  const user = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).get();
  if (!user || user.role !== "admin") {
    return { ok: false, message: "site admin のみ監査ログを復元できます。" };
  }

  const log = await db.select().from(auditLogs).where(eq(auditLogs.id, auditId)).get();
  if (!log) return { ok: false, message: "監査ログが見つかりません。" };

  const priorSuccess = await db
    .select({ id: auditRestoreRuns.id })
    .from(auditRestoreRuns)
    .where(
      and(
        eq(auditRestoreRuns.audit_log_id, auditId),
        eq(auditRestoreRuns.status, "success"),
      )!,
    )
    .limit(1)
    .get();
  if (priorSuccess) {
    return { ok: false, message: "この監査ログはすでに復元済みです。" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    log.expires_at !== null &&
    log.expires_at < now
  ) {
    const message =
      "このログの復元可能期間は終了しています。";

    if (dry_run) {
      return {
        ok: false,
        message,
        reason_code: RestoreFailureReason.expired,
        restore_status: RestoreStatus.expired,
      };
    }

    const runId =
      await persistPermanentRestoreFailure({
        db,
        auditId,
        userId,
        reason,
        reasonCode:
          RestoreFailureReason.expired,
        message,
        now,
        status: RestoreStatus.expired,
      });

    return {
      ok: false,
      message,
      reason_code: RestoreFailureReason.expired,
      restore_status: RestoreStatus.expired,
      restore_run_id: runId,
    };
  }

  const strategy = log.restore_strategy as RestoreStrategy;
  const payloadExceeded =
    log.restore_unavailable_reason_code === "payload_exceeded";
  const before = parseSnapshot(log.before_json);
  const after = parseSnapshot(log.after_json);
  const capability = evaluateRestoreCapability({
    tableName: log.table_name,
    strategy,
    before,
    after,
    payloadExceeded,
  });
  if (!capability.restorable) {
    if (dry_run) {
      return {
        ok: false,
        message: capability.message,
        reason_code: capability.reasonCode,
        restore_status: capability.status,
      };
    }

    const permanent =
      PERMANENT_RESTORE_REASONS.has(
        capability.reasonCode,
      );

    const runId = permanent
      ? await persistPermanentRestoreFailure({
          db,
          auditId,
          userId,
          reason,
          reasonCode: capability.reasonCode,
          message: capability.message,
          now,
        })
      : await persistFailedRestoreRun({
          db,
          auditId,
          userId,
          reason,
          reasonCode: capability.reasonCode,
          message: capability.message,
          now,
        });

    return {
      ok: false,
      message: capability.message,
      reason_code: capability.reasonCode,
      restore_status: capability.status,
      restore_run_id: runId,
    };
  }

  const registration =
    getRestoreRegistration(log.table_name);

  if (!registration) {
    const message =
      "復元アダプターが見つかりません。";

    if (dry_run) {
      return {
        ok: false,
        message,
        reason_code:
          RestoreFailureReason.adapterMissing,
      };
    }

    const runId =
      await persistPermanentRestoreFailure({
        db,
        auditId,
        userId,
        reason,
        reasonCode:
          RestoreFailureReason.adapterMissing,
        message,
        now,
      });

    return {
      ok: false,
      message,
      reason_code:
        RestoreFailureReason.adapterMissing,
      restore_run_id: runId,
    };
  }

  const adapter = registration.adapter;
  const target = strategy === RestoreStrategy.delete_created ? after : before;
  if (!target) return { ok: false, message: "復元用スナップショットがありません。" };
  if (target.id !== log.target_id) {
    return { ok: false, message: "監査対象IDがスナップショットと一致しません。" };
  }

  const current = await adapter.fetchCurrent(db, log.target_id);
  const conflicts: string[] = [];
  if (strategy === RestoreStrategy.recreate_deleted) {
    if (current) conflicts.push("target_already_exists");
  } else if (!current) {
    conflicts.push("target_missing");
  } else if (after) {
    conflicts.push(...computeChangedKeys(after, current));
  }

  if (dry_run) {
    return {
      ok: true,
      message: conflicts.length ? `競合あり: ${conflicts.join(", ")}` : "競合なし。復元可能です。",
      diff: { current, target, conflicts },
    };
  }
  if (
    conflicts.length > 0 &&
    !forceOverwrite
  ) {
    const message =
      `競合が検出されました: ${conflicts.join(", ")}。`;

    const runId =
      await persistFailedRestoreRun({
        db,
        auditId,
        userId,
        reason,
        reasonCode:
          RestoreFailureReason.targetConflict,
        message,
        now,
      });

    return {
      ok: false,
      message,
      reason_code:
        RestoreFailureReason.targetConflict,
      restore_status: log.restore_status,
      restore_run_id: runId,
      diff: {
        current,
        target,
        conflicts,
      },
    };
  }

  let restoreMutation;
  try {
    restoreMutation = adapter.buildRestoreMutation(db, target, strategy, {
      forceOverwrite,
      actorUserId: userId,
      expectedCurrent: current,
    });
  } catch (error) {
    // Adapter construction can throw SQL/framework errors; they are not
    // user-facing diagnostics even when an explicit secret key is absent.
    const message = publicRestoreBuildFailureMessage(error);

    if (dry_run) {
      return {
        ok: false,
        message,
        reason_code:
          RestoreFailureReason.mutationFailed,
      };
    }

    const runId =
      await persistFailedRestoreRun({
        db,
        auditId,
        userId,
        reason,
        reasonCode:
          RestoreFailureReason.mutationFailed,
        message,
        now,
      });

    return {
      ok: false,
      message,
      reason_code:
        RestoreFailureReason.mutationFailed,
      restore_run_id: runId,
    };
  }

  const baseRestoreStatements =
    restoreMutation.statements != null
      ? restoreMutation.statements
      : [restoreMutation.query];

  const baseRestoreExpectedChanges: Array<number | null> =
    restoreMutation.expectedMutationChanges != null
      ? [...restoreMutation.expectedMutationChanges]
      : [restoreMutation.expectedChanges];

  const restoreRunId = generateId("rst");
  let restoreStatements: BatchItem<"sqlite">[] = [...baseRestoreStatements];
  let restoreExpectedMutationChanges: Array<number | null> = [
    ...baseRestoreExpectedChanges,
  ];
  let visibilityEntity: "event" | "video" | null = null;
  let visibilityFenceToken: string | null = null;
  let depublicizedFromPublic = false;
  let publicCacheKeys: string[] = [];
  let videoExportEventIds: string[] = [];
  try {
    if (log.table_name === "events") {
      const previousStatus = String(current?.visibility_status ?? "");
      const nextStatus = String(target.visibility_status ?? "");
      const transition = await planEventVisibilityTransition({
        db,
        eventId: log.target_id,
        previousStatus: previousStatus as "private" | "public",
        nextStatus: nextStatus as "private" | "public",
        actorUserId: userId,
        reason: "audit_restore_visibility",
        now,
      });
      const queue = await buildEventChangeQueueBatch(db, {
        eventId: log.target_id,
        reason: "audit_restore",
        requestedByUserId: userId,
        priority: transition.fenceToken ? "high" : undefined,
      });
      restoreStatements.push(...transition.mutationStatements, ...queue.statements);
      restoreExpectedMutationChanges.push(
        ...transition.expectedMutationChanges,
        ...queue.expectedChanges,
      );
      visibilityEntity = "event";
      visibilityFenceToken = transition.fenceToken;
      depublicizedFromPublic = transition.depublicizedFromPublic;
      publicCacheKeys = [
        ...host.publicCacheKeys.eventObjectKeys(log.target_id),
        "events/index.json",
        "list/recent.json",
        "list/popular.json",
        "top/sections/events.v1.json",
        "top.json",
      ];
    } else if (log.table_name === "videos") {
      const eventRows = await db
        .select({ event_id: videoEvents.event_id })
        .from(videoEvents)
        .where(eq(videoEvents.video_id, log.target_id))
        .limit(MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS + 1);
      if (eventRows.length > MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS) {
        throw new Error("video_status_rebuild_event_limit_exceeded");
      }
      const previousStatus = String(current?.visibility_status ?? "");
      const nextStatus = String(target.visibility_status ?? "");
      // Audit restore is another server-side visibility transition path. Do
      // not let a historical snapshot bypass the same YouTube-public
      // invariant enforced by admin/manage/moderation actions.
      const restoredSourceType = Object.prototype.hasOwnProperty.call(
        target,
        "source_type",
      )
        ? target.source_type
        : current?.source_type;
      const restoredYoutubeVideoId = Object.prototype.hasOwnProperty.call(
        target,
        "youtube_video_id",
      )
        ? target.youtube_video_id
        : current?.youtube_video_id;
      const publicEligibility = validateVideoPublicEligibility(
        {
          source_type: String(restoredSourceType ?? ""),
          youtube_video_id: String(restoredYoutubeVideoId ?? ""),
        },
        nextStatus,
      );
      if (!publicEligibility.ok) {
        throw new Error(publicEligibility.message);
      }
      const transition = await planVideoVisibilityFenceTransition(db, {
        videoId: log.target_id,
        previousStatus: previousStatus as "pending" | "public" | "private" | "voided",
        nextStatus: nextStatus as "pending" | "public" | "private" | "voided",
        actorUserId: userId,
        reason: "audit_restore_visibility",
        now,
      });
      const queue = await buildAfterVideoStatusChangeQueueBatch(db, {
        videoId: log.target_id,
        // A restored primary_event_id may not occur in video_events (legacy
        // video or historical snapshot). Rebuild both old and restored parents
        // in the same atomic queue batch; the helper deduplicates and enforces
        // the existing eight-event fanout limit without another D1 read.
        eventIds: [
          ...eventRows.map((row) => row.event_id),
          String(target.primary_event_id ?? "").trim(),
        ].filter(Boolean),
        creatorXUserId: String(current?.creator_x_user_id ?? "").trim() || null,
        // Restore snapshots can change creator identity independently of event
        // membership. Queue the restored profile too, without another D1 read.
        additionalCreatorXUserIds: [String(target.creator_x_user_id ?? "").trim()],
        primaryEventId: String(current?.primary_event_id ?? "").trim() || null,
        requestedByUserId: userId,
      });
      restoreStatements.push(...transition.mutationStatements, ...queue.statements);
      restoreExpectedMutationChanges.push(
        ...transition.expectedMutationChanges,
        ...queue.expectedChanges,
      );
      visibilityEntity = "video";
      visibilityFenceToken = transition.fenceToken;
      depublicizedFromPublic = transition.depublicizedFromPublic;
      const cacheKeys = new Set<string>();
      const cacheIds = new Set<string>([
        log.target_id,
        String(current?.youtube_video_id ?? "").trim(),
        String(target.youtube_video_id ?? "").trim(),
      ]);
      for (const id of cacheIds) {
        if (id) cacheKeys.add(`videos/${id}.json`);
      }

      // Keep audit restore in lockstep with the normal visibility action. A
      // restore can move a video back to public/private just like moderation;
      // leaving a global projection or a user page cached would otherwise
      // expose the pre-restore state until its TTL expires.
      for (const key of [
        "list/recent.json",
        "list/popular.json",
        "search-index-lite.json",
        ...host.publicCacheKeys.staticObjectKeys,
        "top.json",
        "users/index.json",
        "users/public-x-icon-map.v1.json",
        "users/pickup-creators.v1.json",
      ]) {
        cacheKeys.add(key);
      }

      const creatorIds = new Set<string>([
        String(current?.creator_x_user_id ?? "").trim(),
        String(target.creator_x_user_id ?? "").trim(),
      ]);
      for (const creatorId of creatorIds) {
        for (const key of userPublicCacheKeys(creatorId || null, host.publicCacheKeys.userMaxPages)) {
          cacheKeys.add(key);
        }
      }

      const eventIds = new Set<string>([
        ...eventRows.map((row) => String(row.event_id ?? "").trim()),
        String(current?.primary_event_id ?? "").trim(),
        String(target.primary_event_id ?? "").trim(),
      ]);
      eventIds.delete("");
      // The 8-target budget also applies when legacy primary-event fallback
      // and the before/after primary ID add entries outside video_events.
      if (eventIds.size > MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS) {
        throw new Error("video_status_rebuild_event_limit_exceeded");
      }
      videoExportEventIds = [...eventIds];
      for (const eventId of videoExportEventIds) {
        for (const key of host.publicCacheKeys.eventObjectKeys(eventId)) {
          cacheKeys.add(key);
        }
      }
      publicCacheKeys = [...cacheKeys];
    }

    if (visibilityFenceToken) {
      if (visibilityEntity === "event") {
        await preCommitEventVisibilityTransition({
          eventId: log.target_id,
          fenceToken: visibilityFenceToken,
          reason: "audit_restore_visibility",
        }, host);
      } else if (visibilityEntity === "video") {
        await preCommitVideoVisibilityDepublicization({
          videoId: log.target_id,
          fenceToken: visibilityFenceToken,
          reason: "audit_restore_visibility",
        }, host);
      }
    }

    await mutateWithAudit(db, {
      mutationStatements: restoreStatements,
      expectedMutationChanges:
        restoreExpectedMutationChanges,
      audits: [{
        table_name: log.table_name,
        target_id: log.target_id,
        operation: AuditOperation.RESTORE,
        before: current,
        after: target,
        actor_user_id: userId,
        reason,
        context: `restore:${auditId}`,
        retention_class: "long_audit",
        restore_strategy: RestoreStrategy.none,
        strict: true,
      }],
      postAuditStatements: [
        db.update(auditLogs)
          .set({ restore_status: RestoreStatus.restored })
          .where(and(eq(auditLogs.id, auditId), sql`${auditLogs.restore_status} <> 'restored'`)!),
        db.run(assertChanges(1)),
        db.insert(auditRestoreRuns).values({
          id: restoreRunId,
          audit_log_id: auditId,
          executed_by_user_id: userId,
          reason,
          status: "success",
          error_message: null,
          executed_at: now,
        }),
        db.run(assertChanges(1)),
      ],
      staticRebuildWakeSource: visibilityEntity ? "admin" : undefined,
    }, host.loadQueueWakeHost);
  } catch (error) {
    // Never reflect an arbitrary SQL/provider exception into the HTTP body.
    const message = publicRestoreMutationFailureMessage(error);

    let failedRunId: string | undefined;

    if (visibilityFenceToken) {
      try {
        if (visibilityEntity === "event") {
          await compensateEventVisibilityFenceOnD1Failure(db, {
            eventId: log.target_id,
            fenceToken: visibilityFenceToken,
            allowNonPublicRollback: !depublicizedFromPublic,
          }, host);
        } else if (visibilityEntity === "video") {
          await compensateDepublicizationFenceOnD1Failure(db, {
            videoId: log.target_id,
            fenceToken: visibilityFenceToken,
            traceId: `audit-restore:${restoreRunId}`,
            allowNonPublicRollback: !depublicizedFromPublic,
          }, host);
        }
      } catch {
        // The R2 provider exception may carry credentials or resource metadata.
        // Keep this outcome observable without logging the exception or its cause.
        console.warn("[audit-restore] visibility compensation failed", "provider_error");
      }
    }

    try {
      failedRunId =
        await persistFailedRestoreRun({
          db,
          auditId,
          userId,
          reason,
          reasonCode:
            RestoreFailureReason.mutationFailed,
          message,
          now,
        });
    } catch {
      // D1/Drizzle errors can embed the full SQL statement, parameters,
      // restore reason, user IDs and provider metadata. This failure is
      // observable through a fixed code without ever serializing an Error.
      console.error(JSON.stringify({
        event: "restore_failure_record_failed",
        code: "d1_write_failed",
      }));
    }

    return {
      ok: false,
      message,
      reason_code:
        RestoreFailureReason.mutationFailed,
      restore_status: log.restore_status,
      restore_run_id: failedRunId,
    };
  }

  // Invalidate scheduled exports for every affected video relation/primary
  // after the D1 commit only. Failed/dry-run restores never evict exports.
  if (log.table_name === "videos") {
    for (const eventId of videoExportEventIds) {
      try {
        await host.invalidateEventExportCache(eventId);
      } catch {
        // Match normal video transition fail-soft behavior without leaking
        // provider errors, identifiers or cached response contents.
        console.warn("[audit-restore] event export invalidation failed", "provider_error");
      }
    }
  }
  if (publicCacheKeys.length > 0) {
    await host.deletePublicJsonCaches(publicCacheKeys);
  }
  if (log.table_name === "events") {
    await host.invalidateEventExportCache(log.target_id);
  }

  return { ok: true, message: "復元が完了しました。", restore_run_id: restoreRunId };
}
