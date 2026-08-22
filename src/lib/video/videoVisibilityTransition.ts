import "server-only";

import { unstable_rethrow } from "next/navigation";
import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { AuditMutationError } from "@/lib/audit/mutate";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import type { DB } from "@/lib/db/client";
import { publicVisibilityFences, videos } from "@/lib/db/schema";
import {
  buildVideoStatusChangeNotificationBatch,
  type VideoStatusNotificationBatch,
} from "@/lib/notifications/videoStatusNotify";
import {
  createTraceId,
  logFlowTrace,
} from "@/lib/observability/flowTrace";
import { deletePublicJsonCaches } from "@/lib/publicData/publicCache";
import {
  eventBaseObjectKey,
  eventComposedObjectKey,
  eventSlotsObjectKey,
} from "@/lib/publicData/staticEventDetailCore";
import { RANDOM_VIDEO_POOL_OBJECT_KEY } from "@/lib/publicData/randomVideoPoolCore";
import {
  TOP_LATEST_OBJECT_KEY,
  TOP_NOSTALGIC_OBJECT_KEY,
  TOP_RECOMMENDED_OBJECT_KEY,
  TOP_STATS_OBJECT_KEY,
} from "@/lib/publicData/staticTopSectionsCore";
import { STATIC_USER_MAX_PAGES } from "@/lib/publicData/staticUserProfileCore";
import { YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY } from "@/lib/publicData/staticYoutubeRelatedBlocklistCore";
import {
  readPublicVisibilityBlockedEntitiesManifest,
  writePublicVisibilityBlockedEntitiesManifest,
} from "@/lib/publicData/publicVisibilityManifest";
import {
  isEntityBlockedInManifest,
  releaseBlockedEntityInManifest,
  upsertBlockedEntityInManifest,
} from "@/lib/publicData/publicVisibilityManifestCore";
import { getPublicVisibilityFence } from "@/lib/publicData/publicVisibilityFenceStore";
import {
  buildAfterVideoStatusChangeQueueBatch,
} from "@/lib/staticRebuild/hooks";
import type { StaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import type { QueueWakeSource } from "@/lib/queues/wakeBudget";

const EMPTY_QUEUE_BATCH: StaticRebuildQueueBatch = {
  statements: [],
  expectedChanges: [],
  acceptedTargetCount: 0,
};
import { generateId } from "@/lib/utils/id";
import { validateVideoPublicEligibility } from "@/lib/video/videoPublicEligibility";

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
  /** Validation failure is returned as data so every caller can surface it. */
  validationError?: string;
};

function isPublicVisibility(status: string): boolean {
  return status === "public";
}

function videoPublicCacheKeys(video: VideoRow): string[] {
  const keys = new Set<string>([`videos/${video.id}.json`]);
  if (video.youtube_video_id) {
    keys.add(`videos/${video.youtube_video_id}.json`);
  }
  return [...keys];
}

function userPublicCacheKeys(xUserId: string | null): string[] {
  if (!xUserId) return [];
  const keys = [`users/${xUserId}.json`];
  for (let page = 2; page <= STATIC_USER_MAX_PAGES; page += 1) {
    keys.push(`users/${xUserId}/works/${page}.json`);
    keys.push(`users/${xUserId}/collabs/${page}.json`);
  }
  return keys;
}

function buildFenceUpsertStatement(
  db: DB,
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
  db: DB,
  input: {
    videoId: string;
    previousStatus: VideoRow["visibility_status"];
    nextStatus: VideoRow["visibility_status"];
    actorUserId: string;
    reason?: string | null;
    now: number;
  },
): VideoVisibilityFenceTransitionPlan {
  if (input.previousStatus === input.nextStatus) {
    return {
      mutationStatements: [],
      expectedMutationChanges: [],
      fenceToken: null,
      depublicizedFromPublic: false,
    };
  }

  const depublicizedFromPublic =
    isPublicVisibility(input.previousStatus) &&
    !isPublicVisibility(input.nextStatus);
  const republished =
    !isPublicVisibility(input.previousStatus) &&
    isPublicVisibility(input.nextStatus);
  if (!depublicizedFromPublic && !republished) {
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
        state: republished ? "release_pending" : "blocked",
        reason: input.reason ?? null,
        actorUserId: input.actorUserId,
        now: input.now,
        blockedAt: depublicizedFromPublic ? input.now : null,
      }),
    ],
    expectedMutationChanges: [1],
    fenceToken,
    depublicizedFromPublic,
  };
}

export async function planVideoVisibilityTransition(
  db: DB,
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

    if (
      isPublicVisibility(prevStatus) &&
      !isPublicVisibility(input.nextStatus)
    ) {
      depublicizedFromPublic = true;
      fenceToken = generateId("vf");
      mutationStatements.push(
        buildFenceUpsertStatement(db, {
          videoId: input.video.id,
          fenceToken,
          state: "blocked",
          reason: input.reason ?? null,
          actorUserId: input.actorUserId,
          now,
          blockedAt: now,
        }),
      );
      expectedMutationChanges.push(1);
    } else if (
      !isPublicVisibility(prevStatus) &&
      isPublicVisibility(input.nextStatus)
    ) {
      fenceToken = generateId("vf");
      mutationStatements.push(
        buildFenceUpsertStatement(db, {
          videoId: input.video.id,
          fenceToken,
          state: "release_pending",
          reason: input.reason ?? null,
          actorUserId: input.actorUserId,
          now,
        }),
      );
      expectedMutationChanges.push(1);
    }
  }

  const notificationBatch = visibilityChanged
    ? await buildVideoStatusChangeNotificationBatch(db, {
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
  const publicCacheKeys = visibilityChanged
    ? [
        ...videoPublicCacheKeys(input.video),
        "list/recent.json",
        "list/popular.json",
        "search-index-lite.json",
        RANDOM_VIDEO_POOL_OBJECT_KEY,
        YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY,
        TOP_RECOMMENDED_OBJECT_KEY,
        TOP_LATEST_OBJECT_KEY,
        TOP_NOSTALGIC_OBJECT_KEY,
        TOP_STATS_OBJECT_KEY,
        "top.json",
        ...(input.video.creator_x_user_id
          ? [
              ...userPublicCacheKeys(input.video.creator_x_user_id),
              "users/index.json",
              "users/public-x-icon-map.v1.json",
              "users/pickup-creators.v1.json",
            ]
          : []),
        ...[...new Set(input.eventIds)].filter(Boolean).flatMap((eventId) => [
          eventComposedObjectKey(eventId),
          eventBaseObjectKey(eventId),
          eventSlotsObjectKey(eventId),
        ]),
      ]
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
  };
}

/** 非公開化: R2 block → token 再確認。D1 失敗時も block を自動解除しない。 */
export async function preCommitVideoVisibilityDepublicization(input: {
  videoId: string;
  fenceToken: string;
  reason?: string | null;
}): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const { manifest, etag } = await readPublicVisibilityBlockedEntitiesManifest();
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
  await writePublicVisibilityBlockedEntitiesManifest(updated, {
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
  const { manifest: confirmed } =
    await readPublicVisibilityBlockedEntitiesManifest();
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

export async function runVideoVisibilityTransitionPostCommit(input: {
  publicCacheKeys: readonly string[];
  revalidate: () => void;
}): Promise<void> {
  if (input.publicCacheKeys.length > 0) {
    await deletePublicJsonCaches(input.publicCacheKeys);
  }
  input.revalidate();
}

const DEPUBLICIZATION_COMPENSATION_MAX_RETRIES = 3;

function visibilityErrorCode(error: unknown): string {
  if (error instanceof AuditMutationError) return error.name;
  if (error instanceof Error && error.name) return error.name;
  return "UnknownError";
}

/** D1 mutation 失敗後、安全な場合のみ R2 manifest の block を解除する。 */
export async function compensateDepublicizationFenceOnD1Failure(
  db: DB,
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
    const { manifest, etag } =
      await readPublicVisibilityBlockedEntitiesManifest();
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
      await writePublicVisibilityBlockedEntitiesManifest(released, {
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
  db: DB,
  notificationBatch: VideoStatusNotificationBatch,
  context: { flow: string; traceId: string; wakeSource: QueueWakeSource },
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
          const { wakeNotificationQueueAfterCommit } = await import(
            "@/lib/queues/wakeNotificationQueueAfterCommit"
          );
          await wakeNotificationQueueAfterCommit(context.wakeSource);
        },
      },
    ]);
  }
}

export function visibilityStatusMutationFailureMessage(): string {
  return "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。";
}

export async function handleVideoVisibilityMutationFailure(
  db: DB,
  error: unknown,
  input: {
    flow: string;
    traceId: string;
    videoId: string;
    eventId?: string | null;
    depublicizedFromPublic: boolean;
    fenceToken: string | null;
  },
): Promise<{ ok: false; message: string }> {
  unstable_rethrow(error);
  if (input.fenceToken) {
    try {
      await compensateDepublicizationFenceOnD1Failure(db, {
        videoId: input.videoId,
        fenceToken: input.fenceToken,
        traceId: input.traceId,
        allowNonPublicRollback: !input.depublicizedFromPublic,
      });
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
