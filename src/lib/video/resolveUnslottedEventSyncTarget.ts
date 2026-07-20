import {
  and,
  eq,
  isNotNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { events, videoEvents } from "@/lib/db/schema";
import {
  compositeAuditTargetId,
  emptyVideoAtomicWritePlan,
  type VideoAtomicWritePlan,
} from "@/lib/video/atomicWritePlan";

export type UnslottedEventSyncErrorCode =
  | "unslotted_event_selection_invalid"
  | "unslotted_event_not_allowed";

export class UnslottedEventSyncError extends Error {
  constructor(readonly code: UnslottedEventSyncErrorCode) {
    super(code);
    this.name = "UnslottedEventSyncError";
  }
}

/** 枠なし投稿専用。event_ids の汎用複数選択形式を0件または1件へ縮約する。 */
export function parseUnslottedEventIdFromForm(formData: FormData): string | null {
  const raw = formData.get("event_ids");
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") {
    throw new UnslottedEventSyncError("unslotted_event_selection_invalid");
  }

  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.some((value) => value.length > 64)) {
    throw new UnslottedEventSyncError("unslotted_event_selection_invalid");
  }
  const unique = Array.from(new Set(values));
  if (unique.length > 1) {
    throw new UnslottedEventSyncError("unslotted_event_selection_invalid");
  }
  return unique[0] ?? null;
}

/** UI、事前検証、保存時再検証で共有する正本条件。 */
export function unslottedEventEligibilityWhere(now: number): SQL {
  return and(
    eq(events.visibility_status, "public"),
    or(
      eq(events.allow_unslotted_posts, 1),
      and(isNotNull(events.end_time), lte(events.end_time, now)),
    ),
  )!;
}

export async function resolveUnslottedEventIdForNewVideo(
  db: DB,
  eventId: string | null,
  now = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  if (!eventId) return null;
  const row = (
    await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), unslottedEventEligibilityWhere(now))!)
      .limit(1)
  )[0];
  if (!row) {
    throw new UnslottedEventSyncError("unslotted_event_not_allowed");
  }
  return row.id;
}

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
