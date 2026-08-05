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

export type DiscordNotificationPayload = {
  content: string;
  embeds?: Array<Record<string, unknown>>;
  video_id?: string;
  event_id?: string;
  url?: string;
};

/** 通知 payload に必須キーが入っているかを検証する。 */
export interface NotificationPayloadCheck {
  ok: boolean;
  reason?: string;
}

const MAX_PAYLOAD_BYTES = 8 * 1024;
const MAX_TYPE_LENGTH = 64;

export function validateNotificationPayload(
  type: unknown,
  payload: unknown,
): NotificationPayloadCheck {
  if (typeof type !== "string" || type.length === 0) {
    return { ok: false, reason: "type が文字列ではありません" };
  }
  if (type.length > MAX_TYPE_LENGTH) {
    return { ok: false, reason: `type が ${MAX_TYPE_LENGTH} 文字を超えています` };
  }
  if (!/^[a-z0-9_]+$/i.test(type)) {
    return { ok: false, reason: "type は英数と _ のみ使用可能です" };
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "payload はオブジェクトである必要があります" };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return { ok: false, reason: "payload は JSON シリアライズできません" };
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: `payload が ${MAX_PAYLOAD_BYTES} バイトを超えています` };
  }

  const content = (payload as Record<string, unknown>).content;
  if (content !== undefined && typeof content !== "string") {
    return { ok: false, reason: "payload.content は文字列である必要があります" };
  }
  // Discord message content 上限は 2000。長い運用文面を落とさない。
  if (typeof content === "string" && content.length > 2000) {
    return { ok: false, reason: "payload.content は 2000 文字以内にしてください" };
  }
  return { ok: true };
}
