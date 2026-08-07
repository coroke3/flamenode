import {
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
  discordName?: string | null;
  activeXId?: string | null;
  activeXName?: string | null;
  env?: NotificationUrlEnv;
}): ReturnType<typeof buildDiscordPayload> {
  const discordLabel = args.discordName?.trim()
    ? escapeDiscordMention(args.discordName.trim())
    : "未設定";
  const activeXLabel = args.activeXName?.trim()
    ? `${escapeDiscordMention(args.activeXName.trim())} (${args.activeXId?.trim() || "未設定"})`
    : "未設定";
  const content = buildNotificationBlocks([
    {
      heading: "【運営通知】新規アカウントが作成されました",
      lines: [
        "Discord 連携による初回ログインが完了しました。",
        `発生時刻（日本時間）: ${formatJstNow()}`,
      ],
    },
    {
      heading: "■ ユーザー",
      lines: [
        `Discord: ${discordLabel} (${args.discordId})`,
        `user_id: ${args.userId}`,
        `Active X: ${activeXLabel}`,
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
