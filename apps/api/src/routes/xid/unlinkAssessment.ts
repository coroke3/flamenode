/**
 * MIG-0636 U05 / SA-103 CURRENT src/lib/auth/xLinkDependencies.ts parity.
 * One read-only dependency probe before any authenticated unlink. This DOES
 * NOT authorize deletion: the future DELETE must recheck each predicate in
 * its atomic SQL CAS to close races with newly created dependencies.
 */
export type XUnlinkBlocker =
  | "event_owner_inoperable"
  | "creator_assets_without_alternative"
  | "reserved_or_submitted_slot"
  | "pending_merge_request"
  | "only_approved_link_with_dependencies";

const messages: Record<XUnlinkBlocker, string> = {
  event_owner_inoperable: "この X ID はイベント代表者として残す必要があるため、連携を削除できません。",
  creator_assets_without_alternative: "この X ID で作成した作品があり、他に承認済み X ID がないため削除できません。",
  reserved_or_submitted_slot: "予約済みまたは提出済みの枠があるため、連携を削除できません。",
  pending_merge_request: "統合・差し戻し申請が処理中のため、連携を削除できません。",
  only_approved_link_with_dependencies: "他に承認済み X ID がなく、イベント運営や作品管理に必要なため削除できません。",
};

export type UnlinkAssessment = {
  linked: boolean;
  allowed: boolean;
  blockers: XUnlinkBlocker[];
  message: string | null;
};

type UnlinkFacts = {
  link_present: number;
  owner_blocked: number;
  video_blocked: number;
  slot_blocked: number;
  pending_blocked: number;
  dependency_blocked: number;
};

/** The query is fixed and all user-supplied parameters are bound. No writes. */
export async function assessXUnlinkD1(
  db: D1Database,
  authUserId: string,
  xUserId: string,
): Promise<UnlinkAssessment> {
  const row = await db.prepare(`
    WITH actor AS (
      SELECT ? AS auth_id, ? AS xid
    ), link AS (
      SELECT l.link_role, x.approval_status
      FROM x_user_account_links l
      INNER JOIN x_users x ON x.id = l.x_user_id
      JOIN actor a ON a.auth_id = l.auth_user_id AND a.xid = l.x_user_id
      LIMIT 1
    ), alt AS (
      SELECT EXISTS (
        SELECT 1 FROM x_user_account_links l
        INNER JOIN x_users x ON x.id = l.x_user_id
        JOIN actor a ON a.auth_id = l.auth_user_id
        WHERE l.x_user_id <> a.xid AND x.approval_status = 'approved'
      ) AS has_alt
    )
    SELECT
      EXISTS (SELECT 1 FROM link) AS link_present,
      (EXISTS (SELECT 1 FROM link WHERE link_role = 'owner' AND approval_status = 'approved')
       AND EXISTS (SELECT 1 FROM event_staff es JOIN actor a ON es.x_user_id = a.xid
                   WHERE es.permission_preset = 'owner')
       AND (SELECT COUNT(*) FROM x_user_account_links l
            INNER JOIN x_users x ON x.id = l.x_user_id
            JOIN actor a ON a.xid = l.x_user_id
            WHERE l.link_role = 'owner' AND x.approval_status = 'approved') <= 1
      ) AS owner_blocked,
      (EXISTS (SELECT 1 FROM videos v JOIN actor a ON a.xid = v.creator_x_user_id)
       AND NOT (SELECT has_alt FROM alt)
      ) AS video_blocked,
      EXISTS (SELECT 1 FROM slots s JOIN actor a ON s.x_user_id = a.xid
              AND s.reserved_by_user_id = a.auth_id
              WHERE s.status IN ('reserved', 'submitted')) AS slot_blocked,
      EXISTS (SELECT 1 FROM x_identity_requests r JOIN actor a
              WHERE r.status = 'pending' AND r.request_type IN ('merge', 'revert_merge')
                AND (r.requested_by_auth_user_id = a.auth_id
                     OR r.source_x_user_id = a.xid OR r.target_x_user_id = a.xid)
             ) AS pending_blocked,
      ((EXISTS (SELECT 1 FROM event_staff es JOIN actor a ON es.x_user_id = a.xid)
        OR EXISTS (SELECT 1 FROM videos v JOIN actor a ON v.creator_x_user_id = a.xid))
       AND NOT (SELECT has_alt FROM alt)
      ) AS dependency_blocked
  `).bind(authUserId, xUserId).first<UnlinkFacts>();
  if (!row) throw new Error("xid.unlinkAssessment: no facts returned");
  const blockers: XUnlinkBlocker[] = [];
  if (row.owner_blocked) blockers.push("event_owner_inoperable");
  if (row.video_blocked) blockers.push("creator_assets_without_alternative");
  if (row.slot_blocked) blockers.push("reserved_or_submitted_slot");
  if (row.pending_blocked) blockers.push("pending_merge_request");
  if (row.dependency_blocked) blockers.push("only_approved_link_with_dependencies");
  const linked = row.link_present === 1;
  return { linked, allowed: linked && blockers.length === 0,
    blockers, message: blockers.length ? messages[blockers[0]!] : null };
}
