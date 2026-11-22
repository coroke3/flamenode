import { eq, inArray, sql } from "drizzle-orm";
import { notificationOutbox, users } from "@flamenode/db/schema";
import type { ServerCoreDb } from "../db.ts";
import { generateId } from "../id.ts";
import type { UnslottedVideoAtomicPlan } from "./unslottedEventPlans.ts";

/**
 * MIG-0651 / SA-086 U02 UNMOUNTED: CURRENT video_submitted DM outbox parity.
 * The authenticated host supplies the fully formatted CURRENT payload,
 * because public URLs depend on host configuration, not server-core.
 * This builder never sends a DM, mutates D1 or wakes a worker.
 * Caller must include the returned INSERT in the same audited D1 transaction
 * as the video and enqueue wake only AFTER commit.
 */
export async function buildFreeVideoSubmittedNotificationPlan(
  db: ServerCoreDb,
  args: {
    videoId: string;
    actorUserId: string;
    eventId: string | null;
    /** Trusted result of the CURRENT free-video template, not request JSON. */
    payload: Record<string, unknown>;
    now: number;
  },
): Promise<UnslottedVideoAtomicPlan> {
  const { videoId, actorUserId, eventId, payload, now } = args;
  if (!videoId?.trim() || !actorUserId?.trim() ||
      !Number.isSafeInteger(now) || now < 0 ||
      (eventId !== null && !eventId?.trim()) ||
      !payload || typeof payload !== "object" || Array.isArray(payload) ||
      payload.video_id !== videoId ||
      typeof payload.content !== "string" ||
      payload.content.length === 0 || payload.content.length > 2000) {
    throw new Error("free_video_submitted_notification_invalid");
  }
  let payloadJson: string;
  try {
    payloadJson = JSON.stringify(payload);
  } catch {
    throw new Error("free_video_submitted_notification_invalid");
  }
  if (new TextEncoder().encode(payloadJson).byteLength > 8192) {
    throw new Error("free_video_submitted_notification_payload_too_large");
  }
  if (typeof payload.url !== "string" ||
      !/^https?:\/\//.test(payload.url) ||
      (payload.event_id !== undefined && payload.event_id !== eventId)) {
    throw new Error("free_video_submitted_notification_invalid");
  }

  const dedupeKey = `video_submitted:${videoId}`;
  // S3: inspect recipient preference and active-dedupe in ONE bounded D1
  // SELECT. Two sequential pre-reads would violate the 3-read S3 ceiling once
  // session/writeGuard and audit metadata are included. The partial UNIQUE
  // index and ON CONFLICT DO NOTHING still resolve an in-flight duplicate.
  const recipient = (await db.select({
    id: users.id,
    enabled: users.is_notification_enabled,
    activeDedupe: sql<number>`EXISTS (
      SELECT 1 FROM ${notificationOutbox}
      WHERE ${notificationOutbox.dedupe_key} = ${dedupeKey}
        AND ${inArray(notificationOutbox.status, ["pending", "processing", "sent"])}
    )`.as("active_dedupe"),
  }).from(users).where(eq(users.id, actorUserId)).limit(1))[0];
  if (!recipient?.id || recipient.enabled === 0 || recipient.activeDedupe !== 0) {
    return { statements: [], expectedChanges: [], audits: [] };
  }
  const row: typeof notificationOutbox.$inferSelect = {
    id: generateId(),
    recipient_user_id: recipient.id,
    type: "video_submitted",
    payload_json: payloadJson,
    delivery_route: "dm",
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
    dedupe_key: dedupeKey,
    created_at: now,
  };
  // CURRENT uses conflict-ignore for the active-dedupe unique index;
  // a concurrent identical notification does not fail video creation.
  return {
    statements: [db.insert(notificationOutbox).values(row).onConflictDoNothing()],
    expectedChanges: [null],
    audits: [],
  };
}
