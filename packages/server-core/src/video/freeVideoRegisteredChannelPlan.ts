import { eq } from "drizzle-orm";
import { notificationOutbox, users } from "@flamenode/db/schema";
import type { ServerCoreDb } from "../db.ts";
import { generateId } from "../id.ts";
import { assertValidWebhookPayload, sanitizeDiscordThreadName } from "../notifications/xidRequestChannel.ts";
import type { UnslottedVideoAtomicPlan } from "./unslottedEventPlans.ts";

/**
 * MIG-0651 SA-086 U02 UNMOUNTED: CURRENT event-ops video registration outbox.
 * The host must build the CURRENT channel message and thread name with a
 * trusted actor, event title and validated site origin before calling this.
 * No network request, DB write or Queue wake runs in this builder. The
 * eventual authenticated Hono route must append this plan to the SAME
 * audited D1 transaction as the video and user DM, and only wake after commit.
 */
export async function buildFreeVideoRegisteredChannelPlan(
  db: ServerCoreDb,
  args: {
    videoId: string;
    actorUserId: string;
    eventId: string | null;
    /** Trusted result of CURRENT buildChannelVideoRegisteredNotification. */
    payload: Record<string, unknown>;
    /** Trusted result of CURRENT buildVideoRegisteredOpsThreadName. */
    threadName: string;
    now: number;
  },
): Promise<UnslottedVideoAtomicPlan> {
  const { videoId, actorUserId, eventId, payload, threadName, now } = args;
  if (!videoId?.trim() || !actorUserId?.trim() ||
      !Number.isSafeInteger(now) || now < 0 ||
      (eventId !== null && !eventId?.trim()) ||
      !threadName?.trim() ||
      !payload || typeof payload !== "object" || Array.isArray(payload) ||
      payload.video_id !== videoId ||
      (payload.event_id !== undefined && payload.event_id !== eventId) ||
      typeof payload.url !== "string" || !/^https?:\/\//.test(payload.url)) {
    throw new Error("free_video_registered_channel_invalid");
  }
  const normalizedPayload = {
    ...payload,
    webhook_target: "event" as const,
    thread_name: sanitizeDiscordThreadName(threadName, "[通知] event"),
  };
  // The existing core validator mirrors CURRENT type, content and 8KiB limits.
  assertValidWebhookPayload("discord_webhook", normalizedPayload);
  const recipient = (await db.select({ id: users.id })
    .from(users).where(eq(users.id, actorUserId)).limit(1))[0];
  // CURRENT force=true intentionally allows a channel row with NULL recipient,
  // and bypasses the user notification-enabled preference (ops audit is forced).
  const row: typeof notificationOutbox.$inferSelect = {
    id: generateId(),
    recipient_user_id: recipient?.id ?? null,
    type: "discord_webhook",
    payload_json: JSON.stringify(normalizedPayload),
    delivery_route: "channel",
    correlation_id: null,
    status: "pending",
    attempt_count: 0,
    processing_started_at: null,
    lease_token: null,
    lease_expires_at: null,
    next_attempt_at: null,
    last_error: null,
    processed_at: null,
    event_id: eventId,
    dedupe_key: `channel_video_registered:${videoId}`,
    created_at: now,
  };
  // The active partial UNIQUE index serializes duplicate ops notifications;
  // CURRENT force=true skips dedupe pre-read and uses ON CONFLICT DO NOTHING.
  return {
    statements: [db.insert(notificationOutbox).values(row).onConflictDoNothing()],
    expectedChanges: [null],
    audits: [],
  };
}
