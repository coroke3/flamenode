import { appUrl } from "../format";
import {
  buildDiscordPayload,
  buildNotificationBlocks,
  escapeDiscordMention,
  linkLine,
} from "./common";

const SETTINGS_PATH = "/dashboard/settings";

/** X ID 連携申請の承認 DM。 */
export function buildXIdApprovedNotification(args: {
  xUserId: string;
  requestId: string;
}): ReturnType<typeof buildDiscordPayload> {
  const xLabel = escapeDiscordMention(`@${args.xUserId}`);
  const settingsUrl = linkLine("X ID 設定を開く", SETTINGS_PATH);
  const content = buildNotificationBlocks([
    {
      heading: "【FlameNode】X ID 連携が承認されました",
      lines: [
        `申請いただいた X ID ${xLabel} の連携が承認されました。`,
        "この X ID 名義で作品投稿やイベント参加ができるようになります。",
      ],
    },
    {
      heading: "■ 次に行うこと",
      lines: [
        "ダッシュボードでアクティブな X ID を確認し、必要なら切り替えてください。",
        settingsUrl,
      ],
    },
    {
      heading: "■ 参考",
      lines: [`申請 ID: ${args.requestId}`],
    },
  ]);
  return buildDiscordPayload({ content, url: appUrl(SETTINGS_PATH) });
}

/** X ID エイリアス（別名）追加の承認 DM。 */
export function buildXIdAliasApprovedNotification(args: {
  xUserId: string;
  requestId: string;
}): ReturnType<typeof buildDiscordPayload> {
  const xLabel = escapeDiscordMention(`@${args.xUserId}`);
  const settingsUrl = linkLine("X ID 設定を開く", SETTINGS_PATH);
  const content = buildNotificationBlocks([
    {
      heading: "【FlameNode】X ID 別名が承認されました",
      lines: [
        `追加申請いただいた X ID ${xLabel} が別名として承認されました。`,
        "投稿時にアクティブ X ID として選択できるようになります。",
      ],
    },
    {
      heading: "■ 次に行うこと",
      lines: [
        "ダッシュボードの X ID 設定から、使用する名義を選び直してください。",
        settingsUrl,
      ],
    },
    {
      heading: "■ 参考",
      lines: [`申請 ID: ${args.requestId}`],
    },
  ]);
  return buildDiscordPayload({ content, url: appUrl(SETTINGS_PATH) });
}

/** X ID 連携申請の却下 DM。 */
export function buildXIdRejectedNotification(args: {
  requestedXId?: string | null;
  requestId: string;
  reason?: string | null;
}): ReturnType<typeof buildDiscordPayload> {
  const xLabel = args.requestedXId
    ? escapeDiscordMention(`@${args.requestedXId}`)
    : "（指定なし）";
  const reasonText =
    args.reason?.trim() ||
    "理由の詳細は運営側で確認中です。不明な点は運営 Discord までお問い合わせください。";
  const settingsUrl = linkLine("X ID 設定を開く", SETTINGS_PATH);
  const content = buildNotificationBlocks([
    {
      heading: "【FlameNode】X ID 連携申請が却下されました",
      lines: [
        `申請いただいた X ID ${xLabel} の連携は承認されませんでした。`,
        "内容を修正して再申請するか、別の X ID で申請し直してください。",
      ],
    },
    {
      heading: "■ 却下理由",
      lines: [reasonText],
    },
    {
      heading: "■ 次に行うこと",
      lines: [
        "X ID 設定画面から申請内容を確認し、必要に応じて再申請してください。",
        settingsUrl,
      ],
    },
    {
      heading: "■ 参考",
      lines: [`申請 ID: ${args.requestId}`],
    },
  ]);
  return buildDiscordPayload({ content, url: appUrl(SETTINGS_PATH) });
}
