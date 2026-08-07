import {
  buildAllowedMentions,
  buildDiscordPayload,
  buildNotificationBlocks,
  escapeDiscordMention,
  formatJstNow,
  linkLine,
} from "./common";

/** 配送最終失敗時の運営チャンネル @here 通知。 */
export function buildDeliveryFailureOpsNotification(args: {
  outboxId: string;
  notificationType: string;
  recipientUserId: string;
  discordId?: string | null;
  attemptCount: number;
  lastError?: string | null;
}): ReturnType<typeof buildDiscordPayload> {
  const errorText =
    args.lastError?.trim() || "エラー詳細は管理画面の通知ログを確認してください。";
  const content = buildNotificationBlocks([
    {
      heading: "@here 【システム通知】Discord 通知の配送が最終失敗しました",
      lines: [
        "再試行上限に達したため、利用者への Discord 通知を配送できませんでした。",
        "この通知は system フォーラム Webhook へ配送されます。",
        `通知種別: ${escapeDiscordMention(args.notificationType)}`,
        `outbox ID: ${args.outboxId}`,
        `宛先 user_id: ${args.recipientUserId}`,
        args.discordId ? `Discord ID: ${args.discordId}` : "Discord ID: 未連携",
        `試行回数: ${args.attemptCount}`,
        `発生時刻（日本時間）: ${formatJstNow()}`,
      ],
    },
    {
      heading: "■ エラー",
      lines: [errorText],
    },
    {
      heading: "■ 推奨対応",
      lines: [
        "管理画面で payload と宛先の Discord 連携状態を確認する",
        "Bot Token / Webhook URL の設定を確認する",
        "必要な通知だけ手動で再送する",
        linkLine("通知配信状況を開く", "/admin/notifications?status=failed"),
      ],
    },
  ]);
  return buildDiscordPayload({
    content,
    allowedMentions: buildAllowedMentions({ everyone: true }),
  });
}
