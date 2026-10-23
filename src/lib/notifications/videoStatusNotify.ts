// Compatibility bridge (MIG-0614, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import "server-only";

import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  buildVideoStatusChangeNotificationBatch as buildVideoStatusChangeNotificationBatchCore,
  type VideoStatusNotificationArgs,
  type VideoStatusNotificationBatch,
} from "@flamenode/server-core/notifications/videoStatusNotify";
import {
  buildVideoApprovedNotification,
  buildVideoVisibilityChangedNotification,
} from "./templates/video";

export {
  VIDEO_STATUS_NOTIFICATION_PREFETCH_QUERY_COUNT,
  type VideoStatusNotificationBatch,
} from "@flamenode/server-core/notifications/videoStatusNotify";

/** Payload builders read NEXT_PUBLIC_SITE_URL, so they stay in src and are handed to the core. */
export function buildVideoStatusChangeNotificationBatch(
  db: LibSQLDatabase<any>,
  args: VideoStatusNotificationArgs,
): Promise<VideoStatusNotificationBatch> {
  return buildVideoStatusChangeNotificationBatchCore(db, args, {
    buildVideoApprovedNotification,
    buildVideoVisibilityChangedNotification,
  });
}
