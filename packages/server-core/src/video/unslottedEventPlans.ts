import { sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { events, videoEvents } from "@flamenode/db/schema";
import type { WriteAuditLogInput } from "../audit/types.ts";
import type { ServerCoreDb } from "../db.ts";
import { unslottedEventEligibilityWhere } from "./unslottedEventEligibility.ts";

/** Structural parity with CURRENT VideoAtomicWritePlan; caller owns the D1 transaction. */
export type UnslottedVideoAtomicPlan = {
  statements: BatchItem<"sqlite">[];
  expectedChanges: (number | null)[];
  audits: WriteAuditLogInput[];
};

function emptyUnslottedVideoAtomicPlan(): UnslottedVideoAtomicPlan {
  return { statements: [], expectedChanges: [], audits: [] };
}

function compositeUnslottedAuditTargetId(...parts: readonly string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join(":");
}

/** 画面表示後の状態変更を、作品保存と同じD1 batch内でfail-closedに検出する。 */
export function buildUnslottedEventEligibilityAssertionPlan(
  db: ServerCoreDb,
  eventId: string | null,
  now: number,
): UnslottedVideoAtomicPlan {
  if (!eventId) return emptyUnslottedVideoAtomicPlan();
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
  db: ServerCoreDb,
  args: {
    videoId: string;
    eventId: string | null;
    actorUserId: string;
  },
): UnslottedVideoAtomicPlan {
  if (!args.eventId) return emptyUnslottedVideoAtomicPlan();
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
        target_id: compositeUnslottedAuditTargetId(row.video_id, row.event_id),
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
