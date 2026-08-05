import {
  buildAllowedMentions,
  buildDiscordPayload,
  buildNotificationBlocks,
  escapeDiscordMention,
  formatJstNow,
  linkLine,
} from "./common";
import type { NotificationUrlEnv } from "../format";

/** 運営チャンネル向け: 初回アカウント作成通知。 */
export function buildChannelAccountCreatedNotification(args: {
  userId: string;
  discordId: string;
  userName?: string | null;
  env?: NotificationUrlEnv;
}): ReturnType<typeof buildDiscordPayload> {
  const displayName = args.userName?.trim()
    ? escapeDiscordMention(args.userName)
    : args.userId;
  const content = buildNotificationBlocks([
    {
      heading: "【運営通知】新規アカウントが作成されました",
      lines: [
        "Discord 連携による初回ログインが完了しました。",
        `表示名: ${displayName}`,
        `user_id: ${args.userId}`,
        `Discord ID: ${args.discordId}`,
        `発生時刻（日本時間）: ${formatJstNow()}`,
      ],
    },
    {
      heading: "■ 確認",
      lines: [
        linkLine(
          "ユーザー管理を開く",
          `/admin/users?q=${encodeURIComponent(args.userId)}`,
          args.env,
        ),
      ],
    },
  ]);
  return buildDiscordPayload({
    content,
    url: `/admin/users?q=${encodeURIComponent(args.userId)}`,
  });
}

/** 運営チャンネル向け: 枠新規確保（channel エイリアス、slot テンプレートと同一文面）。 */
export { buildChannelSlotReservedNotification } from "./slot";

/** 運営チャンネル向け: 作品新規登録（channel エイリアス）。 */
export { buildChannelVideoRegisteredNotification } from "./video";
