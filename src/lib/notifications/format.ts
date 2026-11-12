export type NotificationUrlEnv = {
  NEXT_PUBLIC_SITE_URL?: string;
  NODE_ENV?: string;
};

/** 通知リンクの正本originを検証する。 */
export function notificationSiteOrigin(
  env: NotificationUrlEnv = process.env,
): string {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) throw new Error("NEXT_PUBLIC_SITE_URL_MISSING");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL_INVALID_ORIGIN");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error("NEXT_PUBLIC_SITE_URL_INVALID_ORIGIN");
  }
  if (
    env.NODE_ENV === "production" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]")
  ) {
    throw new Error("NEXT_PUBLIC_SITE_URL_LOCALHOST_FORBIDDEN");
  }
  return url.origin;
}

/** 通知内で使う絶対URLを、設定済み公開originからだけ組み立てる。 */
export function appUrl(
  path: string,
  env: NotificationUrlEnv = process.env,
): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || /^[/\\]{2}/.test(path)) {
    throw new Error("NOTIFICATION_PATH_MUST_BE_RELATIVE");
  }
  const origin = notificationSiteOrigin(env);
  const target = new URL(path.startsWith("/") ? path : `/${path}`, `${origin}/`);
  if (target.origin !== origin) throw new Error("NOTIFICATION_PATH_INVALID");
  return target.href;
}

export function videoPublicPath(
  videoId: string,
  youtubeVideoId?: string | null,
): string {
  return `/${youtubeVideoId?.trim() || videoId}`;
}

import type { OpsWebhookTarget } from "./forum";

export type DiscordNotificationPayload = {
  content: string;
  embeds?: Array<Record<string, unknown>>;
  video_id?: string;
  event_id?: string;
  url?: string;
  webhook_target?: OpsWebhookTarget;
  thread_name?: string;
};

/** 通知 payload に必須キーが入っているかを検証する。 */
// Shared validator is pure and byte-identical to CURRENT; Next keeps its public import path.
export { validateNotificationPayload, type NotificationPayloadCheck } from "@flamenode/domain/notifications/payload";
