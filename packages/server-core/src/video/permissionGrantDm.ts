import { escapeDiscordMention } from "../notifications/discordText.ts";

/**
 * SA-082..084 CURRENT-compatible permission grant DM template.
 *
 * The host MUST construct editUrl using its validated public site origin;
 * this pure function does not read process.env, perform D1 writes, send
 * Discord messages or permit untrusted origin input from request JSON.
 */
export function buildPermissionGrantDm(input: {
  videoId: string;
  videoTitle: string;
  editUrl: string;
}): { content: string; video_id: string; url: string } {
  const title = escapeDiscordMention(input.videoTitle);
  const content = [
    "【FlameNode】作品の編集権限が付与されました",
    [
      `作品「${title}」を共同編集できるようになりました。`,
      "タイトル・紹介文・メンバー情報など、許可された範囲を編集できます。",
    ].join("\n"),
    "■ 次に行うこと",
    [
      "編集画面を開き、担当範囲の修正を行ってください。",
      "編集画面を開く",
      input.editUrl,
    ].join("\n"),
  ].join("\n\n");
  return { content, video_id: input.videoId, url: input.editUrl };
}
