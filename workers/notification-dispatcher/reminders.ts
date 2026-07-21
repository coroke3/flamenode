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
  const submitPath = `/event/${group.event_id}/slots`;
  const eventPath = `/event/${group.event_id}`;
  const submitUrl = `${origin}${submitPath}`;
  const eventUrl = `${origin}${eventPath}`;
  const slots = group.slot_count > 1 ? `予約枠 ${group.slot_count} 件` : "予約枠";
  return [
    "投稿締切が近づいています。",
    `${group.event_title} の ${slots} が未投稿です。`,
    `締切: ${formatDeadlineJa(group.entry_end_time)}`,
    `投稿する: ${submitUrl}`,
    `イベント: ${eventUrl}`,
  ].join("\n");
}

function boundedLimit(limit: number): number {
  if (!Number.isFinite(limit)) return REMINDER_LIMIT;
  return Math.min(REMINDER_LIMIT, Math.max(1, Math.floor(limit)));
}

/** Maximum fifty user-scoped reminders per invocation. */
export async function enqueueSlotDeadlineReminders(
  env: ReminderEnv,
  limit = REMINDER_LIMIT,
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  const origin = requireReminderOrigin(env.NEXT_PUBLIC_SITE_URL);
  const now = Math.floor(Date.now() / 1000);
  const groupsResult = await env.DB.prepare(
    `SELECT s.event_id,
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
      GROUP BY s.event_id, s.reserved_by_user_id
      ORDER BY e.entry_end_time ASC, s.event_id ASC
      LIMIT ?3`,
  )
    .bind(now, now + REMINDER_WINDOW_SEC, boundedLimit(limit))
    .all<ReminderGroup>();
  signal?.throwIfAborted();

  let enqueued = 0;
  for (const group of groupsResult.results ?? []) {
    signal?.throwIfAborted();
    const dedupeKey = `slot_deadline_reminder:${group.event_id}:${group.recipient_user_id}:24h`;
    const payload = JSON.stringify({
      content: buildReminderContent(origin, group),
      event_id: group.event_id,
      event_title: group.event_title,
      deadline_at: group.entry_end_time,
      slot_count: group.slot_count,
    });
    try {
      await env.DB.prepare(
        `INSERT INTO notification_outbox (
          id, recipient_user_id, type, payload_json, status, attempt_count,
          processing_started_at, lease_token, lease_expires_at, next_attempt_at,
          last_error, event_id, dedupe_key, created_at
        ) VALUES (
          ?1, ?2, 'slot_deadline_reminder', ?3, 'pending', 0,
          NULL, NULL, NULL, NULL, NULL, ?4, ?5, ?6
        )`,
      )
        .bind(
          crypto.randomUUID(),
          group.recipient_user_id,
          payload,
          group.event_id,
          dedupeKey,
          now,
        )
        .run();
      signal?.throwIfAborted();
      enqueued += 1;
    } catch (error) {
      if (!/unique|constraint/i.test(String(error))) throw error;
    }
  }
  return enqueued;
}
