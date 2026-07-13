/** 通知内で使う絶対URLを組み立てる。 */
export function appUrl(path: string): string {
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_ORIGIN ||
    "http://localhost:3000";
  return `${origin.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
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
  if (typeof content === "string" && content.length > 1000) {
    return { ok: false, reason: "payload.content は 1000 文字以内にしてください" };
  }
  return { ok: true };
}
