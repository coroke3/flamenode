/**
 * MIG-0656 U03e: SA-056/057 submitted danger DM Outbox candidate.
 * UNMOUNTED. This statement MUST be a postAuditStatement of the SAME
 * mutateWithAudit D1 batch as group+video CAS, strict long audits and queue.
 * No recipient/dedupe prereads; no immediate Queue wake (D-0603-1/D-13-41).
 *
 * CURRENT source: src/lib/actions/slot-admin-danger.ts, slot templates.
 * The requested anchor—not the first row in a DB-ordered group—must supply
 * the CURRENT version-scoped notification dedupe identity.
 */
import { sql, type SQL } from "@flamenode/server-core/sql";
import { escapeDiscordMention } from "@flamenode/server-core/notifications/discordText";
import { MAX_SLOTS_PER_VIDEO } from "@flamenode/domain/slots/limits";
import { slotReleaseNotificationPayload } from "./slotReleaseOutbox.ts";
import type { SubmittedDangerKind, SubmittedDangerSelection } from "./slotSubmittedDangerSelection.ts";

export type SubmittedDangerOutboxPlan = {
  statements: SQL[];
  dedupeKeys: string[];
};

export function slotSubmissionReleasedPayload(
  eventId: string, ids: readonly string[], groupId: string | null,
  origin: string,
): { content: string; event_id: string; url: string } {
  // Reuse the exact safe-origin constraints already used by SA-060/063.
  const base = new URL(origin);
  if (!["https:", "http:"].includes(base.protocol) || base.username ||
      base.password || base.search || base.hash ||
      (base.pathname !== "/" && base.pathname !== "")) {
    throw new Error("slot_submitted_notification_origin_invalid");
  }
  const eventUrl = new URL("/event/" + encodeURIComponent(eventId),base).href;
  const slotsUrl = new URL("/event/" + encodeURIComponent(eventId) + "/slots",base).href;
  const eventName = escapeDiscordMention("イベント");
  const count = ids.length > 1 ? String(ids.length) + "枠" : "1枠";
  // Group ID is an opaque persisted value, not guaranteed display-safe for Discord.
  // Escape visible content only, leaving raw grouping/dedupe/CAS values untouched.
  const content = [
    "【FlameNode】枠の作品提出が解除されました\n" +
      "運営操作により、イベント「" + eventName + "」の" + count +
      "から提出作品が解除されました。\n" +
      "予約枠自体は引き続き確保されています。別の作品を再提出できます。",
    "状態\n対象枠数: " + ids.length +
      (groupId ? "\n提出グループ: " + escapeDiscordMention(groupId) : ""),
    "次にできること\nイベントの枠一覧を開く\n" + slotsUrl +
      "\nイベントページを開く\n" + eventUrl,
  ].join("\n\n");
  return {content, event_id:eventId, url:slotsUrl};
}

export function buildSubmittedDangerOutboxStatements(input:{
  kind: SubmittedDangerKind;
  eventId: string;
  /** ACTUALLY REQUESTED anchor (not the first SQL group row). */
  slotId: string;
  selection: SubmittedDangerSelection;
  siteOrigin: string;
  createdAt: number;
  makeId?: ()=>string;
}): SubmittedDangerOutboxPlan {
  const {kind,eventId,slotId,selection,createdAt} = input;
  if ((kind!=="force-release" && kind!=="keep-reservation") ||
      typeof eventId!=="string" || !eventId.trim() || eventId!==eventId.trim() ||
      typeof slotId!=="string" || !slotId.trim() || slotId!==slotId.trim() ||
      !Number.isSafeInteger(createdAt) || createdAt<0 ||
      !selection?.ok || selection.rows.length<1 ||
      selection.rows.length>MAX_SLOTS_PER_VIDEO) {
    throw Error("slot_submitted_notification_invalid_selection");
  }
  const rows=selection.rows;
  const requested=rows.find(row=>row.id===slotId);
  if (!requested || requested.event_id!==eventId || requested.status!=="submitted" ||
      !Number.isSafeInteger(requested.version) || requested.version<0 ||
      !Number.isSafeInteger(requested.updated_at) ||
      rows.some(row=>row.event_id!==eventId || row.status!=="submitted" ||
        row.reserved_by_user_id!==requested.reserved_by_user_id ||
        row.x_user_id!==requested.x_user_id ||
        row.video_id!==requested.video_id) ||
      new Set(rows.map(row=>row.id)).size!==rows.length ||
      rows.some(row=>!row.id?.trim() || !Number.isSafeInteger(row.version))) {
    throw Error("slot_submitted_notification_invalid_snapshot");
  }
  const raw=requested.reservation_group_id;
  const activeGroup=raw?.trim() || null;
  if (selection.groupId!==activeGroup ||
      (activeGroup===null && rows.length!==1) ||
      rows.some(row=>row.reservation_group_id!==raw)) {
    throw Error("slot_submitted_notification_invalid_group");
  }
  if (kind==="keep-reservation" &&
      (!requested.reserved_by_user_id?.trim() || !selection.videoId)) {
    throw Error("slot_submitted_notification_invalid_subject");
  }
  const recipient=requested.reserved_by_user_id;
  if (!recipient) return {statements:[],dedupeKeys:[]};
  const type=kind==="force-release"?"slot_force_released":"slot_submission_released";
  const dedupeKey=type+":"+eventId+":"+slotId+":"+
    (activeGroup??"solo")+":"+requested.version+":submitted";
  const payload=kind==="force-release"
    ?slotReleaseNotificationPayload(eventId,rows.map(row=>row.id),activeGroup,input.siteOrigin)
    :slotSubmissionReleasedPayload(eventId,rows.map(row=>row.id),activeGroup,input.siteOrigin);
  const id=(input.makeId??(()=>crypto.randomUUID()))();
  if(typeof id!=="string" || !id.trim())throw Error("slot_submitted_notification_invalid_id");
  const payloadJson=JSON.stringify(payload);
  return {
    statements:[sql`
      INSERT INTO notification_outbox
        (id,recipient_user_id,type,payload_json,delivery_route,
         correlation_id,status,attempt_count,processing_started_at,
         lease_token,lease_expires_at,next_attempt_at,last_error,
         processed_at,event_id,dedupe_key,created_at)
      SELECT ${id},u.id,${type},${payloadJson},'dm',
        NULL,'pending',0,NULL,NULL,NULL,NULL,NULL,
        NULL,${eventId},${dedupeKey},${createdAt}
      FROM "user" AS u WHERE u.id=${recipient}
        AND COALESCE(u.is_notification_enabled,1)<>0
        AND NOT EXISTS (
          SELECT 1 FROM notification_outbox existing
          WHERE existing.dedupe_key=${dedupeKey}
            AND existing.status IN ('pending','processing','sent')
        )
      ON CONFLICT DO NOTHING
    `],
    dedupeKeys:[dedupeKey],
  };
}
