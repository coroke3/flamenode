/**
 * MIG-0656 U02c-2b: unmounted SA-063 notification effect builder.
 * No pre-read: opt-out, recipient existence and dedupe are checked inside
 * the audited D1 batch. All returned SQL belongs in postAuditStatements.
 * Zero immediate Queue wake under D-0603-1 and D-13-41.
 */
import { sql, type SQL } from "@flamenode/server-core/sql";
import { escapeDiscordMention } from "@flamenode/server-core/notifications/discordText";
import type { SlotReleaseSnapshotRow } from "./slotWriteAssertions.ts";

export type SlotReleaseNotificationPlan = {
  statements: SQL[];
  dedupeKeys: string[];
};

export function slotReleaseNotificationPayload(
  eventId: string, ids: readonly string[], groupId: string | null, origin: string,
): { content: string; event_id: string; url: string } {
  const base = new URL(origin);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password ||
      base.search || base.hash || (base.pathname !== "/" && base.pathname !== "")) {
    throw new Error("slot_release_notification_origin_invalid");
  }
  const url = new URL("/event/" + encodeURIComponent(eventId), base).href;
  const name = escapeDiscordMention("イベント");
  const countLabel = ids.length > 1 ? "予約枠 " + ids.length + " 件" : "予約枠 1 件";
  const paragraphs = [
    "【FlameNode】予約枠が解放されました\n" +
      "運営操作により、イベント「" + name + "」の " + countLabel + " が解放されました。\n" +
      "枠は他の参加者が確保できる状態に戻っています。",
    "■ 状況\n対象枠数: " + ids.length +
      (groupId ? "\n予約グループ: " + groupId : ""),
    "■ 次に行うこと\n" +
      "再度参加する場合は、イベントページから空き枠を確保し直してください。\n" +
      "イベントページを開く\n" + url,
  ];
  return { content: paragraphs.join("\n\n"), event_id: eventId, url };
}

export function buildSlotReleaseOutboxStatements(input: {
  eventId: string;
  rows: readonly SlotReleaseSnapshotRow[];
  siteOrigin: string;
  createdAt: number;
  makeId?: () => string;
}): SlotReleaseNotificationPlan {
  if (!input.eventId.trim() || input.rows.length < 1 || input.rows.length > 3 ||
      !Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
    throw new Error("slot_release_notification_invalid_input");
  }
  const groups = new Map<string, SlotReleaseSnapshotRow[]>();
  const seen = new Set<string>();
  for (const row of input.rows) {
    if (row.event_id !== input.eventId || !row.id?.trim() || seen.has(row.id) ||
        row.status !== "reserved" || !Number.isSafeInteger(row.version) ||
        !Number.isSafeInteger(row.updated_at)) {
      throw new Error("slot_release_notification_invalid_snapshot");
    }
    seen.add(row.id);
    const groupKey = row.reservation_group_id?.trim()
      ? "group:" + row.reservation_group_id : "solo:" + row.id;
    const existing = groups.get(groupKey) ?? [];
    existing.push(row);
    groups.set(groupKey, existing);
  }
  const statements: SQL[] = [], dedupeKeys: string[] = [];
  for (const group of groups.values()) {
    const representative = group[0]!;
    const recipient = representative.reserved_by_user_id;
    if (!recipient) continue;
    const groupId = representative.reservation_group_id?.trim() || null;
    if (group.some(row => row.reserved_by_user_id !== recipient ||
        row.x_user_id !== representative.x_user_id)) {
      throw new Error("slot_release_notification_mixed_owners");
    }
    const dedupeKey = "slot_force_released:" + input.eventId + ":" +
      representative.id + ":" + (groupId ?? "solo") + ":" + representative.version;
    const payloadJson = JSON.stringify(slotReleaseNotificationPayload(
      input.eventId, group.map(row => row.id), groupId, input.siteOrigin,
    ));
    const id = (input.makeId ?? (() => crypto.randomUUID()))();
    if (!id.trim()) throw new Error("slot_release_notification_invalid_id");
    // The unique active-dedupe index also blocks races after the SELECT.
    statements.push(sql`
      INSERT INTO notification_outbox
        (id, recipient_user_id, type, payload_json, delivery_route,
         correlation_id, status, attempt_count, processing_started_at,
         lease_token, lease_expires_at, next_attempt_at, last_error,
         processed_at, event_id, dedupe_key, created_at)
      SELECT ${id}, u.id, 'slot_force_released', ${payloadJson}, 'dm',
             NULL, 'pending', 0, NULL, NULL, NULL, NULL, NULL,
             NULL, ${input.eventId}, ${dedupeKey}, ${input.createdAt}
      FROM "user" AS u
      WHERE u.id = ${recipient} AND COALESCE(u.is_notification_enabled, 1) <> 0
        AND NOT EXISTS (
          SELECT 1 FROM notification_outbox existing
          WHERE existing.dedupe_key = ${dedupeKey}
            AND existing.status IN ('pending', 'processing', 'sent')
        )
      ON CONFLICT DO NOTHING
    `);
    dedupeKeys.push(dedupeKey);
  }
  return { statements, dedupeKeys };
}
