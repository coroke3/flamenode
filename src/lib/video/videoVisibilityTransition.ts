// Compatibility bridge (MIG-0615, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import "server-only";

import { invalidateEventExportCaches } from "@/lib/api/eventExportCache";
import type { DB } from "@/lib/db/client";
import { buildVideoStatusChangeNotificationBatch } from "@/lib/notifications/videoStatusNotify";
import { deletePublicJsonCaches } from "@/lib/publicData/publicCache";
import { RANDOM_VIDEO_POOL_OBJECT_KEY } from "@/lib/publicData/randomVideoPoolCore";
import {
  eventBaseObjectKey,
  eventComposedObjectKey,
  eventReleaseObjectKey,
  eventSlotsObjectKey,
} from "@/lib/publicData/staticEventDetailCore";
import {
  TOP_LATEST_OBJECT_KEY,
  TOP_NOSTALGIC_OBJECT_KEY,
  TOP_RECOMMENDED_OBJECT_KEY,
  TOP_STATS_OBJECT_KEY,
} from "@/lib/publicData/staticTopSectionsCore";
import { STATIC_USER_MAX_PAGES } from "@/lib/publicData/staticUserProfileCore";
import { YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY } from "@/lib/publicData/staticYoutubeRelatedBlocklistCore";
import { nextVisibilityManifestHost } from "@/lib/publicData/visibilityManifestHost";
import { nextRethrowFrameworkControl } from "@/lib/serverCore/nextPorts";
import {
  compensateDepublicizationFenceOnD1Failure as compensateDepublicizationFenceOnD1FailureCore,
  enqueueVideoVisibilityNotificationsPostCommit as enqueueVideoVisibilityNotificationsPostCommitCore,
  handleVideoVisibilityMutationFailure as handleVideoVisibilityMutationFailureCore,
  planVideoVisibilityTransition as planVideoVisibilityTransitionCore,
  preCommitVideoVisibilityDepublicization as preCommitVideoVisibilityDepublicizationCore,
  runVideoVisibilityTransitionPostCommit as runVideoVisibilityTransitionPostCommitCore,
  type VideoVisibilityTransitionHost,
} from "@flamenode/server-core/visibility/videoTransition";

export {
  planVideoVisibilityFenceTransition,
  visibilityStatusMutationFailureMessage,
  type VideoVisibilityFenceTransitionPlan,
  type VideoVisibilityTransitionContext,
  type VideoVisibilityTransitionPlan,
} from "@flamenode/server-core/visibility/videoTransition";

/** Key constants stay beside their generators in src/lib/publicData; the core receives them here. */
const videoVisibilityTransitionHost: VideoVisibilityTransitionHost = {
  manifest: nextVisibilityManifestHost,
  rethrowFrameworkControl: nextRethrowFrameworkControl,
  publicCacheKeys: {
    staticObjectKeys: [
      RANDOM_VIDEO_POOL_OBJECT_KEY,
      YOUTUBE_RELATED_BLOCKLIST_OBJECT_KEY,
      TOP_RECOMMENDED_OBJECT_KEY,
      TOP_LATEST_OBJECT_KEY,
      TOP_NOSTALGIC_OBJECT_KEY,
      TOP_STATS_OBJECT_KEY,
    ],
    userMaxPages: STATIC_USER_MAX_PAGES,
    eventObjectKeys: (eventId) => [
      eventComposedObjectKey(eventId),
      eventBaseObjectKey(eventId),
      eventSlotsObjectKey(eventId),
      eventReleaseObjectKey(eventId),
    ],
  },
  buildNotificationBatch: buildVideoStatusChangeNotificationBatch,
  invalidateEventExportCaches,
  deletePublicJsonCaches,
  wakeNotificationQueueAfterCommit: async (source) => {
    const { wakeNotificationQueueAfterCommit } = await import(
      "@/lib/queues/wakeNotificationQueueAfterCommit"
    );
    await wakeNotificationQueueAfterCommit(source);
  },
};

export function planVideoVisibilityTransition(
  db: DB,
  input: Parameters<typeof planVideoVisibilityTransitionCore>[1],
) {
  return planVideoVisibilityTransitionCore(db, input, videoVisibilityTransitionHost);
}

export function preCommitVideoVisibilityDepublicization(
  input: Parameters<typeof preCommitVideoVisibilityDepublicizationCore>[0],
) {
  return preCommitVideoVisibilityDepublicizationCore(input, videoVisibilityTransitionHost);
}

export function runVideoVisibilityTransitionPostCommit(
  input: Parameters<typeof runVideoVisibilityTransitionPostCommitCore>[0],
) {
  return runVideoVisibilityTransitionPostCommitCore(input, videoVisibilityTransitionHost);
}

export function compensateDepublicizationFenceOnD1Failure(
  db: DB,
  input: Parameters<typeof compensateDepublicizationFenceOnD1FailureCore>[1],
) {
  return compensateDepublicizationFenceOnD1FailureCore(db, input, videoVisibilityTransitionHost);
}

export function enqueueVideoVisibilityNotificationsPostCommit(
  db: DB,
  notificationBatch: Parameters<typeof enqueueVideoVisibilityNotificationsPostCommitCore>[1],
  context: Parameters<typeof enqueueVideoVisibilityNotificationsPostCommitCore>[2],
) {
  return enqueueVideoVisibilityNotificationsPostCommitCore(
    db,
    notificationBatch,
    context,
    videoVisibilityTransitionHost,
  );
}

export function handleVideoVisibilityMutationFailure(
  db: DB,
  error: unknown,
  input: Parameters<typeof handleVideoVisibilityMutationFailureCore>[2],
) {
  return handleVideoVisibilityMutationFailureCore(db, error, input, videoVisibilityTransitionHost);
}
