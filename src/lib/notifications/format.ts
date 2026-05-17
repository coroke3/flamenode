/**
 * 通知 payload に必須キーが入っているかを検証する純粋関数。
 * enqueue 前のサニティチェックに使う。テスト対象。
 */

export interface NotificationPayloadCheck {
  ok: boolean;
  reason?: string;
}

const MAX_PAYLOAD_BYTES = 8 * 1024; // 8KB
const MAX_TYPE_LENGTH = 64;

/**
 * payload と type の最小限の妥当性検査。
 * - type は空でなく 64 文字以内かつ ASCII 英数 + _ のみ
 * - payload は object でシリアライズ後 8KB 以内
 * - content (人間可読本文) があれば 1000 文字以内
 */
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
  const obj = payload as Record<string, unknown>;
  if (obj.content !== undefined) {
    if (typeof obj.content !== "string") {
      return { ok: false, reason: "payload.content は文字列である必要があります" };
    }
    if (obj.content.length > 1000) {
      return { ok: false, reason: "payload.content は 1000 文字以内にしてください" };
    }
  }
  return { ok: true };
}
