import { appUrl } from "../format";
import type { DiscordNotificationPayload } from "./types";

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

export function buildSlotDeadlineReminderNotification(args: {
  eventId: string;
  eventTitle: string;
  deadlineText: string;
  slotCount: number;
}): DiscordNotificationPayload {
  const submitUrl = appUrl(`/event/${args.eventId}/slots`);
  const eventUrl = appUrl(`/event/${args.eventId}`);
  const slotLine =
    args.slotCount > 1
      ? `イベント「${args.eventTitle}」で取得している ${args.slotCount} 枠が、まだ未提出のままです。`
      : `イベント「${args.eventTitle}」で取得している投稿枠が、まだ未提出のままです。`;
  return {
    content: [
      "投稿締切が近づいています",
      "",
      slotLine,
      "締切までに作品情報を登録してください。",
      "",
      "投稿締切:",
      args.deadlineText,
      "",
      `投稿する:\n${submitUrl}`,
      "",
      `イベントページ:\n${eventUrl}`,
    ].join("\n"),
    event_id: args.eventId,
    url: submitUrl,
  };
}
