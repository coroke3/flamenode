import { appUrl, videoPublicPath } from "@/lib/url/appUrl";
import type { DiscordNotificationPayload } from "./types";

export function buildVideoEditPermissionGrantedNotification(args: {
  videoId: string;
  videoTitle: string;
}): DiscordNotificationPayload {
  const editUrl = appUrl(`/dashboard/edit/${args.videoId}`);
  return {
    content: [
      "作品の編集権限が付与されました",
      "",
      `作品「${args.videoTitle}」を編集できるようになりました。`,
      "タイトル・紹介文・メンバー情報など、許可された範囲を編集できます。",
      "",
      `編集する:\n${editUrl}`,
    ].join("\n"),
    video_id: args.videoId,
    url: editUrl,
  };
}

export function buildFreeVideoSubmittedNotification(args: {
  videoId: string;
  videoTitle: string;
  youtubeVideoId?: string | null;
  hasLinkedEvent?: boolean;
}): DiscordNotificationPayload {
  const videoUrl = appUrl(videoPublicPath(args.videoId, args.youtubeVideoId));
  const lines = [
    "作品を受け付けました",
    "",
    `作品「${args.videoTitle}」の登録が完了しました。`,
    "作品ページを確認できます。",
    "",
    `作品ページ:\n${videoUrl}`,
  ];
  if (args.hasLinkedEvent) {
    lines.push(
      "",
      "イベントページにも反映されます。",
      "反映まで少し時間がかかる場合があります。",
    );
  }
  return {
    content: lines.join("\n"),
    video_id: args.videoId,
    url: videoUrl,
  };
}

export function buildVideoApprovedNotification(args: {
  videoId: string;
  videoTitle: string;
  youtubeVideoId?: string | null;
  eventId?: string | null;
  eventTitle?: string | null;
  noteStaticDelay?: boolean;
}): DiscordNotificationPayload {
  const videoUrl = appUrl(videoPublicPath(args.videoId, args.youtubeVideoId));
  const lines = [
    "作品が公開されました",
    "",
    `作品「${args.videoTitle}」が公開されました。`,
    "作品ページやイベントページに反映されます。",
    "",
    `作品ページ:\n${videoUrl}`,
  ];
  if (args.eventId) {
    const eventUrl = appUrl(`/event/${args.eventId}`);
    const eventLabel = args.eventTitle ? `イベント「${args.eventTitle}」` : "イベント";
    lines.push("", `${eventLabel}:\n${eventUrl}`);
  }
  if (args.noteStaticDelay) {
    lines.push("", "反映まで少し時間がかかる場合があります。");
  }
  return {
    content: lines.join("\n"),
    video_id: args.videoId,
    event_id: args.eventId ?? undefined,
    url: videoUrl,
  };
}

export function buildVideoVisibilityChangedNotification(args: {
  videoId: string;
  videoTitle: string;
  youtubeVideoId?: string | null;
  reason?: string | null;
}): DiscordNotificationPayload {
  const videoUrl = appUrl(videoPublicPath(args.videoId, args.youtubeVideoId));
  const reasonText =
    args.reason?.trim() || "理由は運営側で確認中です。";
  return {
    content: [
      "作品について確認があります",
      "",
      `作品「${args.videoTitle}」の公開状態が変更されました。`,
      "必要に応じて、投稿内容や運営からの案内を確認してください。",
      "",
      "理由:",
      reasonText,
      "",
      `作品ページ:\n${videoUrl}`,
    ].join("\n"),
    video_id: args.videoId,
    url: videoUrl,
  };
}

export function buildVideoVoidedNotification(args: {
  videoId: string;
  videoTitle: string;
  youtubeVideoId?: string | null;
  reason?: string | null;
}): DiscordNotificationPayload {
  return buildVideoVisibilityChangedNotification(args);
}
