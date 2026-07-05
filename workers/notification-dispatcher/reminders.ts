/**
 * 投稿締切前リマインドを notification_outbox に enqueue する (D1 直叩き)。
 * Discord API は呼ばない。実送信は dispatch() に任せる。
 */

import type { Env } from "./index.ts";

const REMINDER_LIMIT = 50;
const REMINDER_WINDOW_SEC = 24 * 60 * 60;

type ReminderGroup = {
  event_id: string;
  discord_user_id: string;
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

function buildReminderContent(env: Env, group: ReminderGroup): string {
  const submitPath = `/event/${group.event_id}/slots`;
  const eventPath = `/event/${group.event_id}`;
  const origin = (env.APP_ORIGIN || env.NEXT_PUBLIC_APP_URL || "").trim();
  const base = origin ? origin.replace(/\/$/, "") : "";
  const submitUrl = base ? `${base}${submitPath}` : submitPath;
  const eventUrl = base ? `${base}${eventPath}` : eventPath;
  const slotLine =
    group.slot_count > 1
      ? `イベント「${group.event_title}」で取得している ${group.slot_count} 枠が、まだ未提出のままです。`
      : `イベント「${group.event_title}」で取得している投稿枠が、まだ未提出のままです。`;

  return [
    "投稿締切が近づいています",
    "",
    slotLine,
    "締切までに作品情報を登録してください。",
    "",
    "投稿締切:",
    formatDeadlineJa(group.entry_end_time),
    "",
    `投稿する:\n${submitUrl}`,
    "",
    `イベントページ:\n${eventUrl}`,
  ].join("\n");
}

export async function enqueueSlotDeadlineReminders(
  env: Env,
  limit = REMINDER_LIMIT,
): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now;
  const windowEnd = now + REMINDER_WINDOW_SEC;

  const groupsResult = await env.DB.prepare(
    `SELECT s.event_id,
            s.discord_user_id,
            e.title AS event_title,
            e.entry_end_time,
            COUNT(*) AS slot_count
       FROM slots s
       INNER JOIN events e ON e.id = s.event_id
       INNER JOIN "user" u ON u.discord_id = s.discord_user_id
      WHERE s.status = 'reserved'
        AND s.video_id IS NULL
        AND s.discord_user_id IS NOT NULL
        AND e.visibility_status = 'public'
        AND (e.entry_start_time IS NULL OR e.entry_start_time <= ?1)
        AND e.entry_end_time IS NOT NULL
        AND e.entry_end_time > ?1
        AND e.entry_end_time <= ?2
        AND COALESCE(u.is_notification_enabled, 1) = 1
      GROUP BY s.event_id, s.discord_user_id
      ORDER BY e.entry_end_time ASC
      LIMIT ?3`,
  )
    .bind(windowStart, windowEnd, limit)
    .all<ReminderGroup>();

  const groups = groupsResult.results ?? [];
  let enqueued = 0;

  for (const g of groups) {
    const dedupeKey = `slot_deadline_reminder:${g.event_id}:${g.discord_user_id}:24h`;
    const dup = await env.DB.prepare(
      `SELECT id FROM notification_outbox
        WHERE dedupe_key = ?1
          AND status IN ('pending', 'processing', 'sent')
        LIMIT 1`,
    )
      .bind(dedupeKey)
      .first<{ id: string }>();
    if (dup?.id) continue;

    const id = crypto.randomUUID();
    const payload = JSON.stringify({
      content: buildReminderContent(env, g),
      event_id: g.event_id,
      event_title: g.event_title,
      deadline_at: g.entry_end_time,
      slot_count: g.slot_count,
    });

    try {
      await env.DB.prepare(
        `INSERT INTO notification_outbox (
          id, discord_user_id, type, payload_json, status,
          attempt_count, processing_started_at, next_attempt_at,
          last_error, event_id, dedupe_key, created_at
        ) VALUES (
          ?1, ?2, 'slot_deadline_reminder', ?3, 'pending',
          0, NULL, NULL,
          NULL, ?4, ?5, ?6
        )`,
      )
        .bind(id, g.discord_user_id, payload, g.event_id, dedupeKey, now)
        .run();
      enqueued += 1;
    } catch {
      // UNIQUE dedupe 競合は無視
    }
  }

  return enqueued;
}
