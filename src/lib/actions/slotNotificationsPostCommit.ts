import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import { getDatabase } from "@/lib/cloudflare";
import { buildNotificationOutboxStatement } from "@/lib/notifications/enqueue";
import { buildSlotVideoSubmittedNotification } from "@/lib/notifications/templates/slot";

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
        const { buildChannelSlotReservedNotification, buildSlotReservedOpsThreadName } =
          await import("@/lib/notifications/templates/slot");
        const { resolveNotificationActor } = await import(
          "@/lib/notifications/actor"
        );
        const { buildOpsChannelWebhookStatement } = await import(
          "@/lib/notifications/opsWebhook"
        );
        const actor = await resolveNotificationActor(db, input.actorUserId);
        const channelNotification = await buildOpsChannelWebhookStatement(db, {
          target: "event",
          threadName: buildSlotReservedOpsThreadName(input.eventTitle, actor),
          actorUserId: input.actorUserId,
          payload: buildChannelSlotReservedNotification({
            eventId: input.eventId,
            eventTitle: input.eventTitle,
            slotCount: input.slotCount,
            slotDisplayName: input.displayName,
            actor,
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
    creatorDisplayName?: string | null;
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
        const { buildChannelVideoRegisteredNotification, buildVideoRegisteredOpsThreadName } =
          await import("@/lib/notifications/templates/video");
        const { resolveNotificationActor } = await import(
          "@/lib/notifications/actor"
        );
        const { buildOpsChannelWebhookStatement } = await import(
          "@/lib/notifications/opsWebhook"
        );
        const actor = await resolveNotificationActor(db, input.userId);
        const channelNotification = await buildOpsChannelWebhookStatement(db, {
          target: "event",
          threadName: buildVideoRegisteredOpsThreadName(input.videoTitle, actor),
          actorUserId: input.userId,
          payload: buildChannelVideoRegisteredNotification({
            videoId: input.videoId,
            videoTitle: input.videoTitle,
            youtubeVideoId: input.submittedYoutubeId,
            registrationKind: "slot",
            eventId: input.eventId,
            eventTitle: input.eventTitle,
            actor,
            creatorDisplayName: input.creatorDisplayName,
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
