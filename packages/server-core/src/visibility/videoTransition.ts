import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { publicVisibilityFences, videos } from "@flamenode/db/schema";
import { planVideoVisibilityFence, validateVideoPublicEligibility } from "@flamenode/domain/video";
import { expectedRowCondition } from "../audit/expectedRowCondition.ts";
import { AuditMutationError } from "../audit/mutate.ts";
import { runPostCommitBestEffort } from "../audit/postCommit.ts";
import type { WriteAuditLogInput } from "../audit/types.ts";
import type { ServerCoreDb } from "../db.ts";
import { generateId } from "../id.ts";
import type { VideoStatusNotificationArgs, VideoStatusNotificationBatch } from "../notifications/videoStatusNotify.ts";
import { logFlowTrace } from "../observability/flowTrace.ts";
import type { RethrowFrameworkControl } from "../ports.ts";
import type { QueueWakeSource } from "../queues/wakeBudget.ts";
import type { StaticRebuildQueueBatch } from "../staticRebuild/enqueue.ts";
import { buildAfterVideoStatusChangeQueueBatch } from "../staticRebuild/hooks.ts";
import { getPublicVisibilityFence } from "./fenceStore.ts";
import type { VisibilityManifestHost } from "./manifestHost.ts";
import {
  isEntityBlockedInManifest,
  releaseBlockedEntityInManifest,
  upsertBlockedEntityInManifest,
} from "./manifestCore.ts";

const EMPTY_QUEUE_BATCH: StaticRebuildQueueBatch = {
  statements: [],
  expectedChanges: [],
  acceptedTargetCount: 0,
};

/**
 * Object keys the planner clears on every transition. The key constants live next to the
 * generators in src/lib/publicData (they pull in UI and Next types), so the host hands them over.
 */
export type VideoPublicCacheKeyHost = {
  /** Fixed keys that follow "search-index-lite.json" and precede "top.json", in this order. */
  staticObjectKeys: readonly string[];
  /** Number of paged user profile objects (page 1 is users/<id>.json). */
  userMaxPages: number;
  /** [composed, base, slots, release] object keys of an event. */
  eventObjectKeys(eventId: string): string[];
};

/** Everything the video transition needs from src. A function takes the part it uses. */
export type VideoVisibilityTransitionHost = {
  manifest: VisibilityManifestHost;
  rethrowFrameworkControl: RethrowFrameworkControl;
  publicCacheKeys: VideoPublicCacheKeyHost;
  /** Payload builders read NEXT_PUBLIC_SITE_URL, so the host binds them. */
  buildNotificationBatch(
    db: ServerCoreDb,
    args: VideoStatusNotificationArgs,
  ): Promise<VideoStatusNotificationBatch>;
  invalidateEventExportCaches(eventIds: readonly string[]): Promise<void>;
  deletePublicJsonCaches(r2Keys: readonly string[]): Promise<void>;
  /** Loaded lazily by the host so tests and callers that never wake do not evaluate the queue chain. */
  wakeNotificationQueue(source: QueueWakeSource): Promise<unknown>;
};

export type VideoVisibilityTransitionContext =
  | "admin_video_status"
  | "manage_video_status"
  | "admin_moderation_create"
  | "admin_moderation_update";

type VideoRow = typeof videos.$inferSelect;

export type VideoVisibilityTransitionPlan = {
  mutationStatements: BatchItem<"sqlite">[];
  expectedMutationChanges: (number | null)[];
  audits: WriteAuditLogInput[];
  notificationBatch: VideoStatusNotificationBatch;
  queueBatch: StaticRebuildQueueBatch;
  visibilityChanged: boolean;
  fenceToken: string | null;
  depublicizedFromPublic: boolean;
  publicCacheKeys: string[];
  exportEventIds: string[];
  /** Validation failure is returned as data so every caller can surface it. */
  validationError?: string;
};

function videoPublicCacheKeys(video: VideoRow): string[] {
  const keys = new Set<string>([`videos/${video.id}.json`]);
  if (video.youtube_video_id) {
    keys.add(`videos/${video.youtube_video_id}.json`);
  }
  return [...keys];
}

function userPublicCacheKeys(xUserId: string | null, userMaxPages: number): string[] {
  if (!xUserId) return [];
  const keys = [`users/${xUserId}.json`];
  for (let page = 2; page <= userMaxPages; page += 1) {
    keys.push(`users/${xUserId}/works/${page}.json`);
    keys.push(`users/${xUserId}/collabs/${page}.json`);
  }
  return keys;
}

function buildFenceUpsertStatement(
  db: ServerCoreDb,
  input: {
    videoId: string;
    fenceToken: string;
    state: "blocked" | "release_pending";
    reason?: string | null;
    actorUserId: string;
    now: number;
    blockedAt?: number | null;
  },
): BatchItem<"sqlite"> {
  return db
    .insert(publicVisibilityFences)
    .values({
      entity_type: "video",
      entity_id: input.videoId,
      fence_token: input.fenceToken,
      state: input.state,
      reason: input.reason ?? null,
      requirements_json: null,
      blocked_at: input.blockedAt ?? null,
      release_requested_at: input.state === "release_pending" ? input.now : null,
      requested_by_auth_user_id: input.actorUserId,
      updated_at: input.now,
    })
    .onConflictDoUpdate({
      target: [
        publicVisibilityFences.entity_type,
        publicVisibilityFences.entity_id,
      ],
      set: {
        fence_token: input.fenceToken,
        state: input.state,
        reason: input.reason ?? null,
        blocked_at: input.blockedAt ?? null,
        release_requested_at:
          input.state === "release_pending" ? input.now : null,
        requested_by_auth_user_id: input.actorUserId,
        updated_at: input.now,
      },
    });
}

export type VideoVisibilityFenceTransitionPlan = {
  mutationStatements: BatchItem<"sqlite">[];
  expectedMutationChanges: number[];
  fenceToken: string | null;
  depublicizedFromPublic: boolean;
};

/**
 * 既存の videos 更新を別の atomic mutation（監査復元など）が担当する場合に、
 * 公開状態フェンスだけを同じ D1 batch へ追加するための軽量 planner。
 */
export function planVideoVisibilityFenceTransition(
  db: ServerCoreDb,
  input: {
    videoId: string;
    previousStatus: VideoRow["visibility_status"];
    nextStatus: VideoRow["visibility_status"];
    actorUserId: string;
    reason?: string | null;
    now: number;
  },
): VideoVisibilityFenceTransitionPlan {
  const fence = planVideoVisibilityFence(input.previousStatus, input.nextStatus);
  if (!fence) {
    return {
      mutationStatements: [],
      expectedMutationChanges: [],
      fenceToken: null,
      depublicizedFromPublic: false,
    };
  }

  const fenceToken = generateId("vf");
  return {
    mutationStatements: [
      buildFenceUpsertStatement(db, {
        videoId: input.videoId,
        fenceToken,
        state: fence.state,
        reason: input.reason ?? null,
        actorUserId: input.actorUserId,
        now: input.now,
        blockedAt: fence.depublicizedFromPublic ? input.now : null,
      }),
    ],
    expectedMutationChanges: [1],
    fenceToken,
    depublicizedFromPublic: fence.depublicizedFromPublic,
  };
}

export async function planVideoVisibilityTransition(
  db: ServerCoreDb,
  input: {
    video: VideoRow;
    nextStatus: VideoRow["visibility_status"];
    actorUserId: string;
    context: VideoVisibilityTransitionContext;
    reason?: string | null;
    eventIds: string[];
    notificationEventId?: string | null;
    forceNotify?: boolean;
    now?: number;
  },
  host: Pick<VideoVisibilityTransitionHost, "buildNotificationBatch" | "publicCacheKeys">,
): Promise<VideoVisibilityTransitionPlan> {
  const prevStatus = input.video.visibility_status;
  const visibilityChanged = prevStatus !== input.nextStatus;
  const now =
    input.now ??
    Math.max(Math.floor(Date.now() / 1000), input.video.updated_at + 1);

  const publicEligibility = validateVideoPublicEligibility(
    input.video,
    input.nextStatus,
  );
  if (!publicEligibility.ok) {
    return {
      mutationStatements: [],
      expectedMutationChanges: [],
      audits: [],
      notificationBatch: { statements: [], expectedChanges: [] },
      queueBatch: EMPTY_QUEUE_BATCH,
      visibilityChanged,
      fenceToken: null,
      depublicizedFromPublic: false,
      publicCacheKeys: [],
      exportEventIds: [],
      validationError: publicEligibility.message,
    };
  }
  const after: VideoRow = {
    ...input.video,
    visibility_status: input.nextStatus,
    updated_at: now,
  };

  const mutationStatements: BatchItem<"sqlite">[] = [];
  const expectedMutationChanges: (number | null)[] = [];
  const audits: WriteAuditLogInput[] = [];
  let fenceToken: string | null = null;
  let depublicizedFromPublic = false;

  if (visibilityChanged) {
    mutationStatements.push(
      db
        .update(videos)
        .set({
          visibility_status: input.nextStatus,
          updated_at: now,
        })
        .where(
          and(
            eq(videos.id, input.video.id),
            expectedRowCondition({ expectedCurrent: { ...input.video } }),
          )!,
        ),
    );
    expectedMutationChanges.push(1);
    audits.push({
      table_name: "videos",
      target_id: input.video.id,
      operation: "UPDATE",
      before: { ...input.video },
      after: { ...after },
      actor_user_id: input.actorUserId,
      context: input.context,
      reason: input.reason || `statusを${input.nextStatus}へ変更`,
      retention_class: input.nextStatus === "voided" ? "long_audit" : "normal",
      strict: true,
    });

    const fence = planVideoVisibilityFence(prevStatus, input.nextStatus);
    if (fence) {
      depublicizedFromPublic = fence.depublicizedFromPublic;
      fenceToken = generateId("vf");
      mutationStatements.push(
        buildFenceUpsertStatement(db, {
          videoId: input.video.id,
          fenceToken,
          state: fence.state,
          reason: input.reason ?? null,
          actorUserId: input.actorUserId,
          now,
          blockedAt: fence.depublicizedFromPublic ? now : null,
        }),
      );
      expectedMutationChanges.push(1);
    }
  }

  const notificationBatch = visibilityChanged
    ? await host.buildNotificationBatch(db, {
        videoId: input.video.id,
        videoTitle: input.video.title,
        youtubeVideoId: input.video.youtube_video_id,
        prevStatus,
        nextStatus: input.nextStatus,
        reason: input.reason ?? null,
        recipientUserId: input.video.submitted_by_user_id,
        eventId: input.notificationEventId ?? input.video.primary_event_id,
        forceNotify: input.forceNotify,
      })
    : { statements: [], expectedChanges: [] };

  const queueBatch = visibilityChanged
    ? await buildAfterVideoStatusChangeQueueBatch(db, {
        videoId: input.video.id,
        eventIds: input.eventIds,
        creatorXUserId: input.video.creator_x_user_id,
        primaryEventId: input.video.primary_event_id,
        requestedByUserId: input.actorUserId,
      })
    : EMPTY_QUEUE_BATCH;

  mutationStatements.push(...queueBatch.statements);
  expectedMutationChanges.push(...queueBatch.expectedChanges);

  // A previously public payload can remain in Cache API after a private or
  // voided period. Remove it on every visibility transition so a later
  // re-publication cannot serve that stale projection after its fence releases.
  const keyHost = host.publicCacheKeys;
  const publicCacheKeys = visibilityChanged
    ? [
        ...videoPublicCacheKeys(input.video),
        "list/recent.json",
        "list/popular.json",
        "search-index-lite.json",
        ...keyHost.staticObjectKeys,
        "top.json",
        ...(input.video.creator_x_user_id
          ? [
              ...userPublicCacheKeys(input.video.creator_x_user_id, keyHost.userMaxPages),
              "users/index.json",
              "users/public-x-icon-map.v1.json",
              "users/pickup-creators.v1.json",
            ]
          : []),
        ...[...new Set(input.eventIds)]
          .filter(Boolean)
          .flatMap((eventId) => keyHost.eventObjectKeys(eventId)),
      ]
    : [];

  const exportEventIds = visibilityChanged
    ? [...new Set(input.eventIds)].filter(Boolean)
    : [];

  return {
    mutationStatements,
    expectedMutationChanges,
    audits,
    notificationBatch,
    queueBatch,
    visibilityChanged,
    fenceToken,
    depublicizedFromPublic,
    publicCacheKeys,
    exportEventIds,
  };
}

/** 非公開化: R2 block → token 再確認。D1 失敗時も block を自動解除しない。 */
export async function preCommitVideoVisibilityDepublicization(
  input: {
    videoId: string;
    fenceToken: string;
    reason?: string | null;
  },
  host: Pick<VideoVisibilityTransitionHost, "manifest">,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const { manifest, etag } = await host.manifest.read();
  const updated = upsertBlockedEntityInManifest(
    manifest,
    {
      entity_type: "video",
      entity_id: input.videoId,
      fence_token: input.fenceToken,
      blocked_at: now,
      reason: input.reason ?? null,
    },
    now,
  );
  await host.manifest.write(updated, {
    ifMatchEtag: etag,
    mutateOnConflict: (latest) => {
      const current = latest.entities.find(
        (entry) =>
          entry.entity_type === "video" && entry.entity_id === input.videoId,
      );
      if (current && current.fence_token !== input.fenceToken) {
        throw new Error("public_visibility_fence_token_mismatch");
      }
      return upsertBlockedEntityInManifest(
        latest,
        {
          entity_type: "video",
          entity_id: input.videoId,
          fence_token: input.fenceToken,
          blocked_at: Math.floor(Date.now() / 1000),
          reason: input.reason ?? null,
        },
        Math.floor(Date.now() / 1000),
      );
    },
  });
  const { manifest: confirmed } = await host.manifest.read();
  if (
    !isEntityBlockedInManifest(confirmed, "video", input.videoId) ||
    !confirmed.entities.some(
      (entry) =>
        entry.entity_type === "video" &&
        entry.entity_id === input.videoId &&
        entry.fence_token === input.fenceToken,
    )
  ) {
    throw new Error("public_visibility_fence_token_mismatch");
  }
}

export async function runVideoVisibilityTransitionPostCommit(
  input: {
    publicCacheKeys: readonly string[];
    exportEventIds: readonly string[];
    revalidate: () => void;
  },
  host: Pick<VideoVisibilityTransitionHost, "invalidateEventExportCaches" | "deletePublicJsonCaches">,
): Promise<void> {
  // export payload cache は公開 JSON key より影響が小さいので先に消す
  // （subrequest 上限で途中打切りになっても、重要な公開 key の削除を優先して残す）。
  const exportEventIds = [...new Set(input.exportEventIds)].filter(Boolean);
  if (exportEventIds.length > 0) {
    try {
      await host.invalidateEventExportCaches(exportEventIds);
    } catch {
      console.warn("[video-visibility] event_export_cache_invalidation_failed");
    }
  }
  let publicCacheError: unknown;
  if (input.publicCacheKeys.length > 0) {
    try {
      await host.deletePublicJsonCaches(input.publicCacheKeys);
    } catch (error) {
      publicCacheError = error;
    }
  }
  input.revalidate();
  if (publicCacheError) throw publicCacheError;
}

const DEPUBLICIZATION_COMPENSATION_MAX_RETRIES = 3;

function visibilityErrorCode(error: unknown): string {
  if (error instanceof AuditMutationError) return error.name;
  if (error instanceof Error && error.name) return error.name;
  return "UnknownError";
}

/** D1 mutation 失敗後、安全な場合のみ R2 manifest の block を解除する。 */
export async function compensateDepublicizationFenceOnD1Failure(
  db: ServerCoreDb,
  input: {
    videoId: string;
    fenceToken: string;
    traceId: string;
    /**
     * A non-public -> public transition also precommits a block. If its D1
     * transaction is rolled back, the exact token must be removed.
     */
    allowNonPublicRollback?: boolean;
  },
  host: Pick<VideoVisibilityTransitionHost, "manifest">,
): Promise<void> {
  const video = (
    await db
      .select({ visibility_status: videos.visibility_status })
      .from(videos)
      .where(eq(videos.id, input.videoId))
      .limit(1)
  )[0];
  const fence = await getPublicVisibilityFence(db, "video", input.videoId);
  if (
    fence &&
    (fence.state === "blocked" || fence.state === "release_pending") &&
    fence.fence_token === input.fenceToken
  ) {
    logFlowTrace({
      flow: "video_visibility_depublicize",
      phase: "compensate_skipped",
      trace_id: input.traceId,
      result: "skipped",
      error_code: "d1_fence_confirmed",
    });
    return;
  }

  if (
    !video ||
    (video.visibility_status !== "public" && !input.allowNonPublicRollback)
  ) {
    logFlowTrace({
      flow: "video_visibility_depublicize",
      phase: "compensate_skipped",
      trace_id: input.traceId,
      result: "skipped",
      error_code: "video_not_public",
    });
    return;
  }

  for (
    let attempt = 0;
    attempt < DEPUBLICIZATION_COMPENSATION_MAX_RETRIES;
    attempt += 1
  ) {
    const { manifest, etag } = await host.manifest.read();
    const entry = manifest.entities.find(
      (row) =>
        row.entity_type === "video" && row.entity_id === input.videoId,
    );
    if (!entry || entry.fence_token !== input.fenceToken) {
      logFlowTrace({
        flow: "video_visibility_depublicize",
        phase: "compensate_skipped",
        trace_id: input.traceId,
        result: "skipped",
        error_code: entry ? "r2_token_mismatch" : "r2_entry_missing",
      });
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const released = releaseBlockedEntityInManifest(
      manifest,
      "video",
      input.videoId,
      input.fenceToken,
      now,
    );
    if (!released) {
      logFlowTrace({
        flow: "video_visibility_depublicize",
        phase: "compensate_skipped",
        trace_id: input.traceId,
        result: "skipped",
        error_code: "release_manifest_rejected",
      });
      return;
    }
    try {
      await host.manifest.write(released, {
        ifMatchEtag: etag,
      });
      logFlowTrace({
        flow: "video_visibility_depublicize",
        phase: "compensate_succeeded",
        trace_id: input.traceId,
        result: "succeeded",
        committed: true,
      });
      return;
    } catch (error) {
      if (attempt === DEPUBLICIZATION_COMPENSATION_MAX_RETRIES - 1) {
        const error_code = visibilityErrorCode(error);
        logFlowTrace({
          flow: "video_visibility_depublicize",
          phase: "compensate_failed",
          trace_id: input.traceId,
          result: "failed",
          error_code,
        });
        console.warn(
          JSON.stringify({
            service: "visibility_fence",
            flow: "video_visibility_depublicize",
            trace_id: input.traceId,
            video_id: input.videoId,
            fence_token: input.fenceToken,
            stuck_fence_candidate: true,
            error_code,
          }),
        );
      }
    }
  }
}

export async function enqueueVideoVisibilityNotificationsPostCommit(
  _db: ServerCoreDb,
  notificationBatch: VideoStatusNotificationBatch,
  context: { flow: string; traceId: string; wakeSource: QueueWakeSource },
  host: Pick<VideoVisibilityTransitionHost, "wakeNotificationQueue">,
): Promise<void> {
  if (notificationBatch.statements.length === 0) return;

  const tasks = [
    {
      name: "visibility_status_notification",
      run: async () => {
        for (const statement of notificationBatch.statements) {
          await statement;
        }
      },
    },
  ];
  const warnings = await runPostCommitBestEffort(context, tasks);
  if (tasks.length > warnings.length) {
    await runPostCommitBestEffort(context, [
      {
        name: "notification_queue_wake",
        run: async () => {
          await host.wakeNotificationQueue(context.wakeSource);
        },
      },
    ]);
  }
}

export function visibilityStatusMutationFailureMessage(): string {
  return "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。";
}

export async function handleVideoVisibilityMutationFailure(
  db: ServerCoreDb,
  error: unknown,
  input: {
    flow: string;
    traceId: string;
    videoId: string;
    eventId?: string | null;
    depublicizedFromPublic: boolean;
    fenceToken: string | null;
  },
  host: Pick<VideoVisibilityTransitionHost, "manifest" | "rethrowFrameworkControl">,
): Promise<{ ok: false; message: string }> {
  host.rethrowFrameworkControl(error);
  if (input.fenceToken) {
    try {
      await compensateDepublicizationFenceOnD1Failure(
        db,
        {
          videoId: input.videoId,
          fenceToken: input.fenceToken,
          traceId: input.traceId,
          allowNonPublicRollback: !input.depublicizedFromPublic,
        },
        host,
      );
    } catch (compensateError) {
      const compensate_error_code = visibilityErrorCode(compensateError);
      logFlowTrace({
        flow: input.flow,
        phase: "stuck_fence_candidate",
        trace_id: input.traceId,
        result: "failed",
        error_code: compensate_error_code,
        committed: false,
      });
      console.warn(
        JSON.stringify({
          service: "visibility_status",
          flow: input.flow,
          trace_id: input.traceId,
          phase: "stuck_fence_candidate",
          error_code: compensate_error_code,
          video_id: input.videoId,
          ...(input.eventId ? { event_id: input.eventId } : {}),
        }),
      );
    }
  }
  const error_code = visibilityErrorCode(error);
  logFlowTrace({
    flow: input.flow,
    phase: "visibility_mutation_failed",
    trace_id: input.traceId,
    result: "failed",
    error_code,
    committed: false,
  });
  console.warn(
    JSON.stringify({
      service: "visibility_status",
      flow: input.flow,
      trace_id: input.traceId,
      phase: "visibility_mutation_failed",
      error_code,
      video_id: input.videoId,
      ...(input.eventId ? { event_id: input.eventId } : {}),
    }),
  );
  return { ok: false, message: visibilityStatusMutationFailureMessage() };
}
