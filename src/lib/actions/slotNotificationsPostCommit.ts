import { eq } from "drizzle-orm";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { getDatabase } from "@/lib/cloudflare";
import { users } from "@/lib/db/schema";
import { buildNotificationOutboxStatement } from "@/lib/notifications/enqueue";
import { buildSlotVideoSubmittedNotification } from "@/lib/notifications/templates/slot";
import { buildChannelSlotReservedNotification } from "@/lib/notifications/templates/slot";

type DB = NonNullable<ReturnType<typeof getDatabase>>;

export async function enqueueSlotReserveOpsWebhookPostCommit(
  db: DB,
  input: {
    actorUserId: string;
    eventId: string;
    eventTitle: string;
    slotCount: number;
    displayName: string;
    xUserId: string | null;
    anchorSlotId: string;
    groupId: string | null;
  },
  context: { flow: string; traceId: string },
): Promise<void> {
  await runPostCommitBestEffort(context, [
    {
      name: "ops_webhook_notification",
      run: async () => {
        const { buildOpsChannelWebhookStatement } = await import(
          "@/lib/notifications/opsWebhook"
        );
        const actor = (
          await db
            .select({ discord_id: users.discord_id })
            .from(users)
            .where(eq(users.id, input.actorUserId))
            .limit(1)
        )[0];
        const channelNotification = await buildOpsChannelWebhookStatement(db, {
          actorUserId: input.actorUserId,
          payload: buildChannelSlotReservedNotification({
            eventId: input.eventId,
            eventTitle: input.eventTitle,
            slotCount: input.slotCount,
            displayName: input.displayName,
            xUserId: input.xUserId,
            userId: input.actorUserId,
            discordId: actor?.discord_id,
          }),
          dedupeKey: `channel_slot_reserved:${input.eventId}:${input.actorUserId}:${input.anchorSlotId}:${input.groupId ?? "solo"}`,
          eventId: input.eventId,
        });
        if (!channelNotification) return;
        await channelNotification.statement;
        const { wakeNotificationQueueAfterCommit } = await import(
          "@/lib/queues/wakeNotificationQueueAfterCommit"
        );
        await wakeNotificationQueueAfterCommit("web");
      },
    },
  ]);
}

export async function enqueueSlotSubmitNotificationsPostCommit(
  db: DB,
  input: {
    userId: string;
    videoId: string;
    videoTitle: string;
    slotId: string;
    eventId: string;
    eventTitle: string;
    submittedYoutubeId: string | null;
  },
  context: { flow: string; traceId: string },
): Promise<void> {
  await runPostCommitBestEffort(context, [
    {
      name: "slot_submit_notifications",
      run: async () => {
        const notification = await buildNotificationOutboxStatement(db, {
          recipientUserId: input.userId,
          type: "slot_video_submitted",
          dedupeKey: `slot_video_submitted:${input.videoId}:${input.slotId}`,
          payload: buildSlotVideoSubmittedNotification({
            videoId: input.videoId,
            videoTitle: input.videoTitle,
            eventId: input.eventId,
            eventTitle: input.eventTitle,
          }),
          eventId: input.eventId,
        });
        const { buildChannelVideoRegisteredNotification } = await import(
          "@/lib/notifications/templates/video"
        );
        const { buildOpsChannelWebhookStatement } = await import(
          "@/lib/notifications/opsWebhook"
        );
        const actor = (
          await db
            .select({ discord_id: users.discord_id })
            .from(users)
            .where(eq(users.id, input.userId))
            .limit(1)
        )[0];
        const channelNotification = await buildOpsChannelWebhookStatement(db, {
          actorUserId: input.userId,
          payload: buildChannelVideoRegisteredNotification({
            videoId: input.videoId,
            videoTitle: input.videoTitle,
            youtubeVideoId: input.submittedYoutubeId,
            registrationKind: "slot",
            eventId: input.eventId,
            eventTitle: input.eventTitle,
            userId: input.userId,
            discordId: actor?.discord_id,
          }),
          dedupeKey: `channel_video_registered:${input.videoId}`,
          eventId: input.eventId,
        });
        const statements = [
          notification?.statement,
          channelNotification?.statement,
        ].filter((statement): statement is NonNullable<typeof statement> =>
          Boolean(statement),
        );
        for (const statement of statements) {
          await statement;
        }
        if (statements.length > 0) {
          const { wakeNotificationQueueAfterCommit } = await import(
            "@/lib/queues/wakeNotificationQueueAfterCommit"
          );
          await wakeNotificationQueueAfterCommit("web");
        }
      },
    },
  ]);
}
