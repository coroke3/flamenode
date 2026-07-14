import { appUrl, type DiscordNotificationPayload } from "../format";

export function buildSlotVideoSubmittedNotification(args: {
  videoId: string;
  videoTitle: string;
  eventId: string;
  eventTitle: string;
}): DiscordNotificationPayload {
  const editUrl = appUrl(`/dashboard/edit/${args.videoId}`);
  const eventUrl = appUrl(`/event/${args.eventId}`);
  return {
    content: [
      "投稿を受け付けました",
      "",
      `イベント「${args.eventTitle}」への作品「${args.videoTitle}」を受け付けました。`,
      "現在、運営確認待ちです。",
      "",
      `投稿内容を確認:\n${editUrl}`,
      "",
      `イベントページ:\n${eventUrl}`,
    ].join("\n"),
    video_id: args.videoId,
    event_id: args.eventId,
    url: editUrl,
  };
}