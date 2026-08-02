import "server-only";

import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { expectedRowCondition } from "@/lib/audit/adapters";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import type { DB } from "@/lib/db/client";
import { publicVisibilityFences, videos } from "@/lib/db/schema";
import {
  buildVideoStatusChangeNotificationBatch,
  type VideoStatusNotificationBatch,
} from "@/lib/notifications/videoStatusNotify";
import { deletePublicJsonCaches } from "@/lib/publicData/publicCache";
import {
  readPublicVisibilityBlockedEntitiesManifest,
  writePublicVisibilityBlockedEntitiesManifest,
} from "@/lib/publicData/publicVisibilityManifest";
import {
  isEntityBlockedInManifest,
  upsertBlockedEntityInManifest,
} from "@/lib/publicData/publicVisibilityManifestCore";
import {
  buildAfterVideoStatusChangeQueueBatch,
} from "@/lib/staticRebuild/hooks";
import type { StaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";

const EMPTY_QUEUE_BATCH: StaticRebuildQueueBatch = {
  statements: [],
  expectedChanges: [],
  acceptedTargetCount: 0,
};
import { generateId } from "@/lib/utils/id";

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
};

function isPublicVisibility(status: string): boolean {
  return status === "public";
}

function videoPublicCacheKey(video: VideoRow): string {
  return `videos/${video.youtube_video_id ?? video.id}.json`;
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

  mutationStatements.push(
    ...notificationBatch.statements,
    ...queueBatch.statements,
  );
  expectedMutationChanges.push(
    ...notificationBatch.expectedChanges,
    ...queueBatch.expectedChanges,
  );

  const publicCacheKeys =
    depublicizedFromPublic ? [videoPublicCacheKey(input.video)] : [];

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
