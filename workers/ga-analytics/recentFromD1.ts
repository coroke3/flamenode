import { COUNTABLE_PUBLIC_VIDEO_SQL } from "../../packages/server-core/src/visibility/countablePublicVideoSql.ts";
import type { RecentListPayload } from "./ranking.ts";

// Match the complete capped source snapshot used by optimizedRebuild before it
// sorts by scheduled_time. Never silently truncate eligible videos.
export const GA4_RECENT_D1_MAX_ROWS = 5000;

type RecentD1Row = {
  id: unknown;
  title: unknown;
  youtube_video_id: unknown;
  display_name: unknown;
  creator_x_user_id: unknown;
  icon_url: unknown;
  primary_event_id: unknown;
  primary_event_title: unknown;
  scheduled_time: unknown;
};

export type D1RecentListPayload = RecentListPayload & {
  items: Array<{
    id: string;
    title: string;
    youtube_video_id: string | null;
    display_name: string;
    icon_url: string | null;
    primary_event_id: string | null;
    primary_event_title: string | null;
    scheduled_time: number | null;
    status: "public";
  }>;
};

function presentString(value: unknown): string | null {
  if (value == null) return null;
  return String(value).trim() || null;
}

function scheduledUnix(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function loadRecentListFromD1(
  db: D1Database,
  { limit = GA4_RECENT_D1_MAX_ROWS }: { limit?: number } = {},
  signal?: AbortSignal,
): Promise<D1RecentListPayload> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > GA4_RECENT_D1_MAX_ROWS) {
    throw new RangeError("ga4_recent_d1_invalid_limit");
  }
  signal?.throwIfAborted();
  // Use the same countable-public predicate, event visibility join and
  // canonical id-bounded snapshot as optimizedRebuild.ts. Sorting in JS
  // preserves localeCompare tie breaks (SQLite BINARY differs on Unicode ids).
  const result = await db.prepare(
    `SELECT
       v.id, v.title, v.youtube_video_id,
       v.creator_display_name AS display_name,
       v.creator_x_user_id,
       v.creator_icon_url AS icon_url,
       e.id AS primary_event_id,
       e.title AS primary_event_title,
       v.scheduled_time
     FROM videos AS v
     LEFT JOIN events AS e
       ON e.id = v.primary_event_id AND e.visibility_status = 'public'
     WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
     ORDER BY v.id ASC
     LIMIT ?`,
  ).bind(limit + 1).all<RecentD1Row>();
  signal?.throwIfAborted();
  // A malformed D1 response is an operational failure, not a genuinely
  // empty public-video collection. Never silently skip sync on driver errors.
  if (!result || result.success === false || !Array.isArray(result.results)) {
    throw new Error("ga4_recent_d1_invalid_result");
  }
  const rows = result.results;
  if (rows.length > limit) {
    // Publishing a partial allow-list could turn a valid GA4 report into
    // misleading rankings. Preserve the last successful R2 output instead.
    throw new Error("ga4_recent_d1_pool_exceeds_limit");
  }

  const items = rows.map((row) => {
    if (!row || typeof row !== "object") {
      throw new Error("ga4_recent_d1_invalid_public_row");
    }
    const id = presentString(row.id);
    const title = presentString(row.title);
    if (!id || !title) throw new Error("ga4_recent_d1_invalid_public_row");
    return {
      id,
      title,
      youtube_video_id: presentString(row.youtube_video_id),
      display_name:
        presentString(row.display_name) ??
        presentString(row.creator_x_user_id) ??
        "unknown",
      icon_url: presentString(row.icon_url),
      primary_event_id: presentString(row.primary_event_id),
      primary_event_title: presentString(row.primary_event_title),
      scheduled_time: scheduledUnix(row.scheduled_time),
      status: "public" as const,
    };
  });
  items.sort((left, right) =>
    (right.scheduled_time ?? Number.NEGATIVE_INFINITY) -
      (left.scheduled_time ?? Number.NEGATIVE_INFINITY) ||
    left.id.localeCompare(right.id),
  );
  return { items };
}
