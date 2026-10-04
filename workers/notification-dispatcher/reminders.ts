/** Slot deadline reminder enqueue. Delivery is delegated to fast-jobs. */
export interface ReminderEnv {
  DB: D1Database;
  NEXT_PUBLIC_SITE_URL?: string;
}

const REMINDER_LIMIT = 50;
const REMINDER_WINDOW_SEC = 24 * 60 * 60;

type ReminderGroup = {
  event_id: string;
  recipient_user_id: string;
  event_title: string;
  entry_end_time: number;
  slot_count: number;
};

function formatDeadlineJa(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function requireReminderOrigin(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) throw new Error("NEXT_PUBLIC_SITE_URL is required for reminders");

  let siteUrl: URL;
  try {
    siteUrl = new URL(raw);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL is invalid for reminders");
  }
  const hostname = siteUrl.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  const isLocalhost =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (
    siteUrl.protocol !== "https:" ||
    isLocalhost ||
    siteUrl.username !== "" ||
    siteUrl.password !== "" ||
    (siteUrl.pathname !== "" && siteUrl.pathname !== "/") ||
    siteUrl.search !== "" ||
    siteUrl.hash !== ""
  ) {
    throw new Error("NEXT_PUBLIC_SITE_URL is invalid for reminders");
  }
  return siteUrl.origin;
}

function buildReminderContent(origin: string, group: ReminderGroup): string {
  const submitUrl = `${origin}/event/${group.event_id}/slots`;
  const eventUrl = `${origin}/event/${group.event_id}`;
  const slotsLabel =
    group.slot_count > 1 ? `予約枠 ${group.slot_count} 件` : "予約枠 1 件";
  return [
    "【FlameNode】作品投稿の締切が近づいています",
    "",
    `イベント「${group.event_title}」で確保している ${slotsLabel} が未投稿です。`,
    `投稿締切（日本時間）: ${formatDeadlineJa(group.entry_end_time)}`,
    "",
    "締切を過ぎると枠が解放される場合があります。参加を予定している場合は、期限までに作品を登録してください。",
    "",
    `作品を投稿:\n${submitUrl}`,
    "",
    `イベントを確認:\n${eventUrl}`,
  ].join("\n");
}

function boundedLimit(limit: number): number {
  if (!Number.isFinite(limit)) return REMINDER_LIMIT;
  return Math.min(REMINDER_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * Groups that already hold an active outbox row are excluded before LIMIT.
 * The status list mirrors notification_outbox_active_dedupe_uniq, so a
 * failed/dead_letter reminder stays retryable exactly as the unique index
 * allows, while already-enqueued groups no longer starve later deadlines.
 */
export const REMINDER_GROUPS_SQL = `SELECT s.event_id,
            s.reserved_by_user_id AS recipient_user_id,
            e.title AS event_title,
            e.entry_end_time,
            COUNT(*) AS slot_count
       FROM slots s
       INNER JOIN events e ON e.id = s.event_id
       INNER JOIN "user" u ON u.id = s.reserved_by_user_id
      WHERE s.status = 'reserved'
        AND s.video_id IS NULL
        AND s.reserved_by_user_id IS NOT NULL
        AND e.visibility_status = 'public'
        AND (e.entry_start_time IS NULL OR e.entry_start_time <= ?1)
        AND e.entry_end_time IS NOT NULL
        AND e.entry_end_time > ?1
        AND e.entry_end_time <= ?2
        AND COALESCE(u.is_notification_enabled, 1) = 1
        AND NOT EXISTS (
          SELECT 1
            FROM notification_outbox o
           WHERE o.dedupe_key = 'slot_deadline_reminder:' || s.event_id || ':' || s.reserved_by_user_id || ':24h'
             AND o.status IN ('pending', 'processing', 'sent')
        )
      GROUP BY s.event_id, s.reserved_by_user_id
      ORDER BY e.entry_end_time ASC, s.event_id ASC
      LIMIT ?3`;

/** A concurrent enqueue of the same group is absorbed by the active dedupe unique index. */
export const REMINDER_INSERT_SQL = `INSERT INTO notification_outbox (
          id, recipient_user_id, type, payload_json, status, attempt_count,
          processing_started_at, lease_token, lease_expires_at, next_attempt_at,
          last_error, event_id, dedupe_key, created_at
        ) VALUES (
          ?1, ?2, 'slot_deadline_reminder', ?3, 'pending', 0,
          NULL, NULL, NULL, NULL, NULL, ?4, ?5, ?6
        )
        ON CONFLICT DO NOTHING`;

/** Maximum fifty user-scoped reminders per invocation. */
export async function enqueueSlotDeadlineReminders(
  env: ReminderEnv,
  limit = REMINDER_LIMIT,
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  const origin = requireReminderOrigin(env.NEXT_PUBLIC_SITE_URL);
  const now = Math.floor(Date.now() / 1000);
  const groupsResult = await env.DB.prepare(REMINDER_GROUPS_SQL)
    .bind(now, now + REMINDER_WINDOW_SEC, boundedLimit(limit))
    .all<ReminderGroup>();
  signal?.throwIfAborted();

  const inserts = (groupsResult.results ?? []).map((group) =>
    env.DB.prepare(REMINDER_INSERT_SQL).bind(
      crypto.randomUUID(),
      group.recipient_user_id,
      JSON.stringify({
        content: buildReminderContent(origin, group),
        event_id: group.event_id,
        event_title: group.event_title,
        deadline_at: group.entry_end_time,
        slot_count: group.slot_count,
      }),
      group.event_id,
      // Must stay identical to the NOT EXISTS key in REMINDER_GROUPS_SQL.
      `slot_deadline_reminder:${group.event_id}:${group.recipient_user_id}:24h`,
      now,
    ),
  );
  if (inserts.length === 0) return 0;
  const results = await env.DB.batch(inserts);
  return results.reduce(
    (enqueued, result) => enqueued + Number(result.meta?.changes ?? 0),
    0,
  );
}
