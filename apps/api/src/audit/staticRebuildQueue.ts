/**
 * MIG-0602 U02 / MIG-0603 U02b: static_rebuild_queue write (one JSON1 UPSERT) for the top_announcements and video targets.
 * Mirrors CURRENT src/lib/staticRebuild/enqueue.ts buildStaticRebuildQueueBatch
 * (one JSON1 chunk, active-row UPSERT) as called by
 * buildAnnouncementChangeQueueBatch (priority "normal"). The row is written in
 * the same D1 batch as the mutation; there is no external Queue message for
 * announcements (CURRENT passes no staticRebuildWakeSource).
 */
import { generateId, type SqlStatement } from "./mutateWithAudit.ts";

export function buildAnnouncementChangeQueueStatement(opts: {
  reason: string;
  requestedByUserId?: string;
}): { statement: SqlStatement; expectedChanges: 1 } {
  // CURRENT buildAnnouncementChangeQueueBatch drops requestedByUserId (null).
  return buildStaticRebuildQueueStatement({
    targetType: "top_announcements",
    targetId: "global",
    reason: opts.reason,
    requestedByUserId: null,
  });
}

/**
 * MIG-0603: one target, priority "normal" (CURRENT default), same single JSON1
 * UPSERT statement (3 binds) as buildStaticRebuildQueueBatch for one item.
 */
export function buildStaticRebuildQueueStatement(item: {
  targetType: string;
  targetId: string;
  reason: string;
  requestedByUserId: string | null;
}): { statement: SqlStatement; expectedChanges: 1 } {
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify([
    {
      id: generateId("srb"),
      target_type: item.targetType,
      target_id: item.targetId,
      reason: item.reason,
      priority: "normal",
      requested_by_user_id: item.requestedByUserId,
    },
  ]);
  return {
    expectedChanges: 1,
    statement: {
      sql: `
        INSERT INTO static_rebuild_queue (
          id, target_type, target_id, reason, priority, status,
          attempt_count, requested_by_user_id, created_at, updated_at
        )
        SELECT
          json_extract(incoming.value, '$.id'),
          json_extract(incoming.value, '$.target_type'),
          json_extract(incoming.value, '$.target_id'),
          json_extract(incoming.value, '$.reason'),
          json_extract(incoming.value, '$.priority'),
          'pending', 0,
          json_extract(incoming.value, '$.requested_by_user_id'),
          ?, ?
        FROM json_each(?) AS incoming
        WHERE 1 = 1
        ON CONFLICT(target_type, target_id) WHERE status IN ('pending', 'processing')
        DO UPDATE SET
          reason = CASE
            WHEN excluded.reason IN ('video_visibility_update', 'event_id_rename_old_cleanup')
              THEN excluded.reason
            WHEN static_rebuild_queue.reason IN ('video_visibility_update', 'event_id_rename_old_cleanup')
              THEN static_rebuild_queue.reason
            WHEN (CASE excluded.priority WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END)
              >= (CASE static_rebuild_queue.priority WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END)
            THEN excluded.reason
            ELSE static_rebuild_queue.reason
          END,
          priority = CASE
            WHEN static_rebuild_queue.priority = 'high' OR excluded.priority = 'high' THEN 'high'
            WHEN static_rebuild_queue.priority = 'normal' OR excluded.priority = 'normal' THEN 'normal'
            ELSE 'low'
          END,
          requested_by_user_id = COALESCE(
            excluded.requested_by_user_id,
            static_rebuild_queue.requested_by_user_id
          ),
          updated_at = MAX(static_rebuild_queue.updated_at + 1, excluded.updated_at)
      `,
      params: [now, now, payload],
    },
  };
}
