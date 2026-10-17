import { z } from "zod";

export const apiEndpointEventIdSchema = z
  .string()
  .trim()
  .min(1, "event_idが不正です。")
  .max(128, "event_idが不正です。");

export function validateApiEndpointEventId(
  rawEventId: string | null | undefined,
): { ok: true; eventId: string } | { ok: false; message: string } {
  const parsed = apiEndpointEventIdSchema.safeParse(rawEventId);
  if (!parsed.success) {
    return { ok: false, message: "event_idが不正です。" };
  }
  return { ok: true, eventId: parsed.data };
}

export function validateEventForApiActivation(
  event: { visibility_status: string } | null | undefined,
  enabled: 0 | 1,
): { ok: true } | { ok: false; message: string } {
  if (!event) {
    return { ok: false, message: "イベントが見つかりません。" };
  }
  if (enabled === 1 && event.visibility_status !== "public") {
    return { ok: false, message: "公開イベントだけAPIを有効化できます。" };
  }
  return { ok: true };
}
