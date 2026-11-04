/**
 * MIG-0659 U02: ops-channel webhook outbox statement for the Hono X ID request routes.
 *
 * Mirrors CURRENT buildOpsChannelWebhookStatement -> buildNotificationOutboxStatement with
 * `force: true` for type `discord_webhook` only: no dedupe pre-read (force), one `user` existence
 * read for the recipient, the row is inserted with ON CONFLICT DO NOTHING in the caller's batch.
 * The statement stays unexecuted until the caller adds it to mutateWithAudit.
 */
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { notificationOutbox, users } from "@flamenode/db/schema";
import type { ServerCoreDb } from "../db.ts";
import {
  assertValidWebhookPayload,
  sanitizeDiscordThreadName,
} from "./xidRequestChannel.ts";

export type OpsWebhookTarget = "account" | "event" | "system";

export type OpsChannelWebhookStatement = Readonly<{
  statement: BatchItem<"sqlite">;
  row: typeof notificationOutbox.$inferSelect;
}>;

export async function buildOpsChannelWebhookStatement(
  db: ServerCoreDb,
  input: {
    target: OpsWebhookTarget;
    threadName: string;
    actorUserId: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
  },
): Promise<OpsChannelWebhookStatement> {
  const payload = {
    ...input.payload,
    webhook_target: input.target,
    thread_name: sanitizeDiscordThreadName(input.threadName, `[通知] ${input.target}`),
  };
  assertValidWebhookPayload("discord_webhook", payload);
  const recipient = (
    await db.select({ id: users.id }).from(users).where(eq(users.id, input.actorUserId)).limit(1)
  )[0];
  const row: typeof notificationOutbox.$inferSelect = {
    id: crypto.randomUUID(),
    recipient_user_id: recipient?.id ?? null,
    type: "discord_webhook",
    payload_json: JSON.stringify(payload),
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
    event_id: null,
    dedupe_key: input.dedupeKey.trim() || null,
    created_at: Math.floor(Date.now() / 1000),
  };
  return {
    statement: db.insert(notificationOutbox).values(row).onConflictDoNothing(),
    row,
  };
}
