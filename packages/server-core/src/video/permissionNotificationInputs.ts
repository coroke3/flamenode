import { selectVideoPermissionNotificationTargets } from "@flamenode/domain/video";

/**
 * SA-082..084: pure permission-grant notification envelope builder.
 * The caller MUST first resolve recipients from approved, linked and opted-in
 * X users. The payload factory is a host port: CURRENT may use its Next
 * notification template and Hono must supply an origin-validated equivalent.
 *
 * This helper is not a write, an authorization decision or a Queue wake.
 * The caller must persist every envelope via the atomic outbox D1 batch.
 */
export function buildPermissionGrantNotificationInputs<TPayload extends Record<string, unknown>>(
  input: {
    links: readonly { x_user_id: string; auth_user_id: string }[];
    actorUserId: string;
    videoId: string;
    videoTitle: string;
    eventId: string | null;
    buildPayload: (video: { videoId: string; videoTitle: string }) => TPayload;
  },
): Array<{
  recipientUserId: string;
  dedupeKey: string;
  type: "video_edit_permission_granted";
  payload: TPayload;
  eventId: string | null;
}> {
  const recipients = selectVideoPermissionNotificationTargets(
    input.links,
    input.actorUserId,
    input.videoId,
  );
  return recipients.map((target) => ({
    ...target,
    type: "video_edit_permission_granted" as const,
    payload: input.buildPayload({
      videoId: input.videoId,
      videoTitle: input.videoTitle,
    }),
    eventId: input.eventId,
  }));
}
