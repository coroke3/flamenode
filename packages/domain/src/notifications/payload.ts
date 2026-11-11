/**
 * Cross-runtime notification payload validation.
 *
 * Bit-for-bit policy of CURRENT src/lib/notifications/format.ts, except
 * TextEncoder replaces Node Buffer so Hono/Workers can use it without a Node
 * polyfill. No URL, secret, network, DB or authorization side effects.
 */
export interface NotificationPayloadCheck {
  ok: boolean;
  reason?: string;
}
const MAX_PAYLOAD_BYTES = 8 * 1024;
const MAX_TYPE_LENGTH = 64;
const WEBHOOK_TARGETS = new Set(["account", "event", "system"]);

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
  if (new TextEncoder().encode(serialized).byteLength > MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: `payload が ${MAX_PAYLOAD_BYTES} バイトを超えています` };
  }

  const record = payload as Record<string, unknown>;
  const content = record.content;
  if (content !== undefined && typeof content !== "string") {
    return { ok: false, reason: "payload.content は文字列である必要があります" };
  }
  if (typeof content === "string" && content.length > 2000) {
    return { ok: false, reason: "payload.content は 2000 文字以内にしてください" };
  }
  const webhookTarget = record.webhook_target;
  if (webhookTarget !== undefined &&
      (typeof webhookTarget !== "string" || !WEBHOOK_TARGETS.has(webhookTarget))) {
    return { ok: false, reason: "payload.webhook_target が不正です" };
  }
  const threadName = record.thread_name;
  if (threadName !== undefined) {
    if (typeof threadName !== "string") {
      return { ok: false, reason: "payload.thread_name は文字列である必要があります" };
    }
    if (threadName.length > 100) {
      return { ok: false, reason: "payload.thread_name は 100 文字以内にしてください" };
    }
  }
  return { ok: true };
}
