import { sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { events, videoEvents } from "@/lib/db/schema";
import {
  compositeAuditTargetId,
  emptyVideoAtomicWritePlan,
  type VideoAtomicWritePlan,
} from "@/lib/video/atomicWritePlan";

export {
  UnslottedEventSyncError,
  parseUnslottedEventIdFromForm,
  type UnslottedEventSyncErrorCode,
} from "@flamenode/domain/video";

import { unslottedEventEligibilityWhere } from "@flamenode/server-core/video/unslottedEventEligibility";
export {
  unslottedEventEligibilityWhere,
  resolveUnslottedEventIdForNewVideo,
} from "@flamenode/server-core/video/unslottedEventEligibility";

/** 画面表示後の状態変更を、作品保存と同じD1 batch内でfail-closedに検出する。 */
export function buildUnslottedEventEligibilityAssertionPlan(
  db: DB,
  eventId: string | null,
  now: number,
): VideoAtomicWritePlan {
  if (!eventId) return emptyVideoAtomicWritePlan();
  return {
    statements: [
      db.run(sql`
        SELECT CASE
          WHEN EXISTS (
            SELECT 1
            FROM ${events}
            WHERE ${events.id} = ${eventId}
              AND ${unslottedEventEligibilityWhere(now)}
          ) THEN 1
          ELSE json_extract('not-valid-json', '$')
        END
      `),
    ],
    expectedChanges: [null],
    audits: [],
  };
}

/** 新規作品専用。汎用の差分同期を使わず、0件または1件を直接追加する。 */
export function buildUnslottedVideoEventPlan(
  db: DB,
  args: {
    videoId: string;
    eventId: string | null;
    actorUserId: string;
  },
): VideoAtomicWritePlan {
  if (!args.eventId) return emptyVideoAtomicWritePlan();
  const row: typeof videoEvents.$inferSelect = {
    video_id: args.videoId,
    event_id: args.eventId,
  };
  return {
    statements: [db.insert(videoEvents).values(row)],
    expectedChanges: [1],
    audits: [
      {
        table_name: "video_events",
        target_id: compositeAuditTargetId(row.video_id, row.event_id),
        operation: "CREATE",
        before: null,
        after: { ...row },
        actor_user_id: args.actorUserId,
        context: "video-save:unslotted-event",
        retention_class: "normal",
        strict: true,
      },
    ],
  };
}
