import { appUrl } from "../format";
import {
  buildDiscordPayload,
  buildNotificationBlocks,
  escapeDiscordMention,
  formatJstDateTime,
  linkLine,
} from "./common";

/** 枠への作品投稿受付 DM。 */
export function buildSlotVideoSubmittedNotification(args: {
  videoId: string;
  videoTitle: string;
  eventId: string;
  eventTitle: string;
}): ReturnType<typeof buildDiscordPayload> {
  const editUrl = appUrl(`/dashboard/edit/${args.videoId}`);
  const eventUrl = appUrl(`/event/${args.eventId}`);
  const title = escapeDiscordMention(args.videoTitle);
  const eventName = escapeDiscordMention(args.eventTitle);
  const content = buildNotificationBlocks([
    {
      heading: "【FlameNode】枠への投稿を受け付けました",
      lines: [
        `イベント「${eventName}」への作品「${title}」を受け付けました。`,
        "現在は運営確認待ちの状態です。承認されるとイベントページへ反映されます。",
      ],
    },
    {
      heading: "■ 状況",
      lines: ["投稿状態: 審査待ち", `イベント: ${eventName}`],
    },
    {
      heading: "■ 次に行うこと",
      lines: [
        "投稿内容に誤りがないか、編集画面で確認してください。",
        linkLine("投稿内容を確認する", `/dashboard/edit/${args.videoId}`),
        linkLine("イベントページを見る", `/event/${args.eventId}`),
      ],
    },
  ]);
  return buildDiscordPayload({
    content,
    video_id: args.videoId,
    event_id: args.eventId,
    url: editUrl,
  });
}

/** 投稿締切リマインダー DM。 */
export function buildSlotDeadlineReminderNotification(args: {
  eventId: string;
  eventTitle: string;
  deadlineAt: number;
  slotCount: number;
}): ReturnType<typeof buildDiscordPayload> {
  const slotsLabel =
    args.slotCount > 1 ? `予約枠 ${args.slotCount} 件` : "予約枠 1 件";
  const eventName = escapeDiscordMention(args.eventTitle);
  const submitUrl = appUrl(`/event/${args.eventId}/slots`);
  const content = buildNotificationBlocks([
    {
      heading: "【FlameNode】投稿締切が近づいています",
      lines: [
        `イベント「${eventName}」の ${slotsLabel} に、まだ作品が投稿されていません。`,
        "締切を過ぎると枠が解放される場合があります。お早めに投稿を完了してください。",
      ],
    },
    {
      heading: "■ 状況",
      lines: [
        `締切（日本時間）: ${formatJstDateTime(args.deadlineAt)}`,
        `未投稿の枠: ${slotsLabel}`,
      ],
    },
    {
      heading: "■ 次に行うこと",
      lines: [
        "枠一覧から作品を投稿するか、不要な枠は解放してください。",
        linkLine("枠一覧・投稿画面を開く", `/event/${args.eventId}/slots`),
        linkLine("イベントページを見る", `/event/${args.eventId}`),
      ],
    },
  ]);
  return buildDiscordPayload({
    content,
    event_id: args.eventId,
    url: submitUrl,
  });
}

/** 運営による枠強制解放 DM。 */
export function buildSlotForceReleasedNotification(args: {
  eventId: string;
  eventTitle?: string | null;
  slotIds: string[];
  reservationGroupId?: string | null;
}): ReturnType<typeof buildDiscordPayload> {
  const eventName = escapeDiscordMention(args.eventTitle ?? "イベント");
  const slotLabel =
    args.slotIds.length > 1
      ? `予約枠 ${args.slotIds.length} 件`
      : "予約枠 1 件";
  const content = buildNotificationBlocks([
    {
      heading: "【FlameNode】予約枠が解放されました",
      lines: [
        `運営操作により、イベント「${eventName}」の ${slotLabel} が解放されました。`,
        "枠は他の参加者が確保できる状態に戻っています。",
      ],
    },
    {
      heading: "■ 状況",
      lines: [
        `対象枠数: ${args.slotIds.length}`,
        args.reservationGroupId
          ? `予約グループ: ${args.reservationGroupId}`
          : null,
      ],
    },
    {
      heading: "■ 次に行うこと",
      lines: [
        "再度参加する場合は、イベントページから空き枠を確保し直してください。",
        linkLine("イベントページを開く", `/event/${args.eventId}`),
      ],
    },
  ]);
  return buildDiscordPayload({
    content,
    event_id: args.eventId,
    url: appUrl(`/event/${args.eventId}`),
  });
}

/** 運営チャンネル向け: 利用者による枠新規確保通知。 */
export function buildChannelSlotReservedNotification(args: {
  eventId: string;
  eventTitle: string;
  slotCount: number;
  displayName?: string | null;
  xUserId?: string | null;
  userId: string;
  discordId?: string | null;
}): ReturnType<typeof buildDiscordPayload> {
  const eventName = escapeDiscordMention(args.eventTitle);
  const actor =
    args.displayName?.trim() ||
    (args.xUserId ? `@${args.xUserId}` : args.userId);
  const slotsLabel =
    args.slotCount > 1 ? `${args.slotCount} 枠` : "1 枠";
  const content = buildNotificationBlocks([
    {
      heading: "【運営通知】枠が新規確保されました",
      lines: [
        `利用者がイベント「${eventName}」で ${slotsLabel} を確保しました。`,
        `操作者: ${escapeDiscordMention(actor)}`,
        args.discordId ? `Discord ID: ${args.discordId}` : null,
      ],
    },
    {
      heading: "■ 確認",
      lines: [
        linkLine("イベント管理を開く", `/manage/events/${args.eventId}`),
        linkLine("イベントページを見る", `/event/${args.eventId}`),
      ],
    },
  ]);
  return buildDiscordPayload({
    content,
    event_id: args.eventId,
    url: appUrl(`/manage/events/${args.eventId}`),
  });
}
