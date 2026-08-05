import { appUrl, type NotificationUrlEnv } from "../format";
import { linkLine, buildDiscordPayload, buildNotificationBlocks } from "./common";

/** 初回Discord連携時の利用者向け welcome DM。 */
export function buildWelcomeAccountNotification(
  env?: NotificationUrlEnv,
): ReturnType<
  typeof buildDiscordPayload
> {
  const onboardingPath = "/onboarding";
  const onboardingUrl = linkLine("はじめの設定を開く", onboardingPath, env);
  const rulesUrl = linkLine("利用規約を確認する", "/rules", env);
  const content = buildNotificationBlocks([
    {
      heading: "【FlameNode】アカウント登録が完了しました",
      lines: [
        "FlameNode へようこそ。Discord アカウントとの連携が完了しました。",
        "作品の投稿やイベント参加には、利用規約への同意と X ID 連携申請が必要です。",
      ],
    },
    {
      heading: "■ いま行うこと",
      lines: [
        "1. 利用規約を読み、同意する",
        "2. X ID 連携申請を送信する（運営承認後に投稿が可能になります）",
        onboardingUrl,
        rulesUrl,
      ],
    },
    {
      heading: "■ 補足",
      lines: [
        "設定はいつでもダッシュボードから変更できます。",
        "通知が届かない場合は、Discord の DM 設定で Bot からのメッセージを許可してください。",
      ],
    },
  ]);
  return buildDiscordPayload({ content, url: appUrl(onboardingPath, env) });
}
