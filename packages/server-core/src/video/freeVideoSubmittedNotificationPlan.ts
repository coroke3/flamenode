import { inArray, sql } from "drizzle-orm";
import { notificationOutbox, users } from "@flamenode/db/schema";
import type { ServerCoreDb } from "../db.ts";
import { generateId } from "../id.ts";
import type { UnslottedVideoAtomicPlan } from "./unslottedEventPlans.ts";

/**
 * MIG-0651 / SA-086 U02 UNMOUNTED: CURRENT video_submitted DM outbox parity.
 * The authenticated host supplies the fully formatted CURRENT payload,
 * because public URLs depend on host configuration, not server-core.
 * This builder never sends a DM, mutates D1 or wakes a worker.
 * The recipient opt-out and active dedupe are checked in a single conditional
 * INSERT inside the audited video transaction (zero pre-batch D1 reads).
 * A Queue wake may be scheduled only AFTER the D1 commit.
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
  if (typeof payloadJson !== "string") {
    throw new Error("free_video_submitted_notification_invalid");
  }
  if (new TextEncoder().encode(payloadJson).byteLength > 8192) {
    throw new Error("free_video_submitted_notification_payload_too_large");
  }
  // JSON.stringify may invoke an inherited or own toJSON() hook. Validate
  // the actual persisted JSON, not only the host object's pre-serialization
  // properties: otherwise an in-process object can silently replace the
  // video ID, URL, content or event after the earlier trusted-input checks.
  let serialized: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid serialized payload");
    }
    serialized = parsed as Record<string, unknown>;
  } catch {
    throw new Error("free_video_submitted_notification_invalid");
  }
  if (serialized.video_id !== videoId ||
      typeof serialized.content !== "string" ||
      serialized.content !== payload.content ||
      typeof serialized.url !== "string" ||
      serialized.url !== payload.url ||
      !/^https?:\/\//.test(serialized.url) ||
      serialized.event_id !== payload.event_id ||
      (serialized.event_id !== undefined && serialized.event_id !== eventId)) {
    throw new Error("free_video_submitted_notification_invalid");
  }

  const dedupeKey = `video_submitted:${videoId}`;
  // Resolve the receiver, their current DM opt-out and the active-dedupe
  // predicate inside the SAME D1 batch as the video INSERT. The old builder
  // spent one separate pre-batch SELECT, which is costly under the S3 3-read
  // ceiling and could become stale before the transaction.
  //
  // Always retain this prepared conditional statement, even if the recipient
  // does not exist or opted out. The status is re-evaluated at commit time.
  // The unique partial index plus conflict-ignore retains CURRENT idempotency.
  const stmt = db.run(sql`
    INSERT INTO notification_outbox (
      id, recipient_user_id, type, payload_json, delivery_route,
      correlation_id, status, attempt_count, processing_started_at,
      lease_token, lease_expires_at, next_attempt_at, last_error, processed_at,
      event_id, dedupe_key, created_at
    )
    SELECT
      ${generateId()}, ${users.id}, ${"video_submitted"}, ${payloadJson}, ${"dm"},
      NULL, ${"pending"}, ${0}, NULL, NULL, NULL, NULL, NULL, NULL,
      ${eventId}, ${dedupeKey}, ${now}
    FROM ${users}
    WHERE ${users.id} = ${actorUserId}
      AND COALESCE(${users.is_notification_enabled}, 1) <> 0
      AND NOT EXISTS (
        SELECT 1 FROM ${notificationOutbox}
        WHERE ${notificationOutbox.dedupe_key} = ${dedupeKey}
          AND ${inArray(notificationOutbox.status, ["pending", "processing", "sent"])}
      )
    ON CONFLICT DO NOTHING
  `);
  return { statements: [stmt], expectedChanges: [null], audits: [] };
}
