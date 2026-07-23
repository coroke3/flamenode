import { appUrl, videoPublicPath } from "../format";
import {
  buildDiscordPayload,
  buildNotificationBlocks,
  escapeDiscordMention,
  linkLine,
} from "./common";

/** 自由投稿・未所属作品の受付 DM。 */
export function buildFreeVideoSubmittedNotification(args: {
  videoId: string;
  videoTitle: string;
  youtubeVideoId?: string | null;
  hasLinkedEvent?: boolean;
}): ReturnType<typeof buildDiscordPayload> {
  const videoUrl = appUrl(videoPublicPath(args.videoId, args.youtubeVideoId));
  const title = escapeDiscordMention(args.videoTitle);
  const content = buildNotificationBlocks([
    {
      heading: "【FlameNode】作品を受け付けました",
      lines: [
        `作品「${title}」の登録が完了しました。`,
        "作品ページから内容を確認できます。",
      ],
    },
    {
      heading: "■ 状況",
      lines: [
        "登録種別: 自由投稿",
        args.hasLinkedEvent
          ? "イベントへの紐付けあり（反映まで時間がかかる場合があります）"
          : "イベント未紐付け",
      ],
    },
    {
      heading: "■ 次に行うこと",
      lines: [
        "作品ページで表示を確認し、必要なら編集画面から内容を修正してください。",
        linkLine("作品ページを開く", videoPublicPath(args.videoId, args.youtubeVideoId)),
        linkLine("編集画面を開く", `/dashboard/edit/${args.videoId}`),
      ],
    },
  ]);
  return buildDiscordPayload({
    content,
    video_id: args.videoId,
    url: videoUrl,
  });
}

/** 作品公開（承認）DM。 */
export function buildVideoApprovedNotification(args: {
  videoId: string;
  videoTitle: string;
  youtubeVideoId?: string | null;
  eventId?: string | null;
  eventTitle?: string | null;
  noteStaticDelay?: boolean;
}): ReturnType<typeof buildDiscordPayload> {
  const videoUrl = appUrl(videoPublicPath(args.videoId, args.youtubeVideoId));
  const title = escapeDiscordMention(args.videoTitle);
  const eventLines: string[] = [];
  if (args.eventId) {
    const eventLabel = args.eventTitle
      ? `イベント「${escapeDiscordMention(args.eventTitle)}」`
      : "イベント";
    eventLines.push(linkLine(`${eventLabel}を見る`, `/event/${args.eventId}`));
  }
  const content = buildNotificationBlocks([
    {
      heading: "【FlameNode】作品が公開されました",
      lines: [
        `作品「${title}」が公開されました。`,
        "作品ページや関連イベントページに反映されます。",
      ],
    },
    {
      heading: "■ 状況",
      lines: [
        "公開状態: 公開",
        args.noteStaticDelay
          ? "静的ページへの反映まで数分かかる場合があります"
          : null,
      ],
    },
    {
      heading: "■ 次に行うこと",
      lines: [
        "作品ページで表示を確認してください。",
        linkLine("作品ページを開く", videoPublicPath(args.videoId, args.youtubeVideoId)),
        ...eventLines,
      ],
    },
  ]);
  return buildDiscordPayload({
    content,
    video_id: args.videoId,
    event_id: args.eventId ?? undefined,
    url: videoUrl,
  });
}

/** 作品の公開状態変更（無効化・確認）DM。 */
export function buildVideoVisibilityChangedNotification(args: {
  videoId: string;
  videoTitle: string;
  youtubeVideoId?: string | null;
  reason?: string | null;
}): ReturnType<typeof buildDiscordPayload> {
  const videoUrl = appUrl(videoPublicPath(args.videoId, args.youtubeVideoId));
  const title = escapeDiscordMention(args.videoTitle);
  const reasonText =
    args.reason?.trim() ||
    "理由の詳細は運営側で確認中です。不明な点は運営 Discord までお問い合わせください。";
  const content = buildNotificationBlocks([
    {
      heading: "【FlameNode】作品の公開状態が変更されました",
      lines: [
        `作品「${title}」の公開状態が変更されました。`,
        "運営からの案内や投稿内容を確認し、必要な対応を行ってください。",
      ],
    },
    {
      heading: "■ 理由",
      lines: [reasonText],
    },
    {
      heading: "■ 次に行うこと",
      lines: [
        "作品ページと編集画面を確認してください。",
        linkLine("作品ページを開く", videoPublicPath(args.videoId, args.youtubeVideoId)),
        linkLine("編集画面を開く", `/dashboard/edit/${args.videoId}`),
      ],
    },
  ]);
  return buildDiscordPayload({
    content,
    video_id: args.videoId,
    url: videoUrl,
  });
}

/** 共同編集権限付与 DM。 */
export function buildVideoEditPermissionGrantedNotification(args: {
  videoId: string;
  videoTitle: string;
}): ReturnType<typeof buildDiscordPayload> {
  const editUrl = appUrl(`/dashboard/edit/${args.videoId}`);
  const title = escapeDiscordMention(args.videoTitle);
  const content = buildNotificationBlocks([
    {
      heading: "【FlameNode】作品の編集権限が付与されました",
      lines: [
        `作品「${title}」を共同編集できるようになりました。`,
        "タイトル・紹介文・メンバー情報など、許可された範囲を編集できます。",
      ],
    },
    {
      heading: "■ 次に行うこと",
      lines: [
        "編集画面を開き、担当範囲の修正を行ってください。",
        linkLine("編集画面を開く", `/dashboard/edit/${args.videoId}`),
      ],
    },
  ]);
  return buildDiscordPayload({
    content,
    video_id: args.videoId,
    url: editUrl,
  });
}

/** 運営チャンネル向け: 作品新規登録通知。 */
export function buildChannelVideoRegisteredNotification(args: {
  videoId: string;
  videoTitle: string;
  youtubeVideoId?: string | null;
  registrationKind: "slot" | "free" | "unaffiliated";
  eventId?: string | null;
  eventTitle?: string | null;
  userId: string;
  discordId?: string | null;
}): ReturnType<typeof buildDiscordPayload> {
  const kindLabel =
    args.registrationKind === "slot"
      ? "枠投稿"
      : args.registrationKind === "free"
        ? "自由投稿"
        : "未所属";
  const title = escapeDiscordMention(args.videoTitle);
  const eventLines: string[] = [];
  if (args.eventId) {
    eventLines.push(linkLine("イベントを見る", `/event/${args.eventId}`));
  }
  const content = buildNotificationBlocks([
    {
      heading: "【運営通知】作品が新規登録されました",
      lines: [
        `登録種別: ${kindLabel}`,
        `作品: ${title}`,
        args.eventTitle
          ? `イベント: ${escapeDiscordMention(args.eventTitle)}`
          : null,
        `登録者 user_id: ${args.userId}`,
        args.discordId ? `Discord ID: ${args.discordId}` : null,
      ],
    },
    {
      heading: "■ 確認",
      lines: [
        linkLine("作品ページを見る", videoPublicPath(args.videoId, args.youtubeVideoId)),
        linkLine("管理画面で作品を見る", `/admin/videos?q=${encodeURIComponent(args.videoId)}`),
        ...eventLines,
      ],
    },
  ]);
  return buildDiscordPayload({
    content,
    video_id: args.videoId,
    event_id: args.eventId ?? undefined,
    url: appUrl(videoPublicPath(args.videoId, args.youtubeVideoId)),
  });
}
