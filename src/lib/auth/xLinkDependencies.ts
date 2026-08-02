import "server-only";

import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  eventStaff,
  slots,
  videos,
  xIdentityRequests,
  xUserAccountLinks,
  xUsers,
} from "@/lib/db/schema";
import { getApprovedLinkedXUserIds, countOwnerRoleLinksForXUser } from "./approvedX";

export type XLinkDeletionBlocker =
  | "event_owner_inoperable"
  | "creator_assets_without_alternative"
  | "reserved_or_submitted_slot"
  | "pending_merge_request"
  | "only_approved_link_with_dependencies";

export type XLinkDeletionAssessment = {
  allowed: boolean;
  blockers: XLinkDeletionBlocker[];
  message: string | null;
};

const BLOCKER_MESSAGES: Record<XLinkDeletionBlocker, string> = {
  event_owner_inoperable:
    "この X ID はイベント代表者として残す必要があるため、連携を削除できません。",
  creator_assets_without_alternative:
    "この X ID で作成した作品があり、他に承認済み X ID がないため削除できません。",
  reserved_or_submitted_slot:
    "予約済みまたは提出済みの枠があるため、連携を削除できません。",
  pending_merge_request:
    "統合・差し戻し申請が処理中のため、連携を削除できません。",
  only_approved_link_with_dependencies:
    "他に承認済み X ID がなく、イベント運営や作品管理に必要なため削除できません。",
};

async function hasPendingMergeInvolvingXUser(
  db: DB,
  xUserId: string,
  authUserId: string,
): Promise<boolean> {
  const row = (
    await db
      .select({ id: xIdentityRequests.id })
      .from(xIdentityRequests)
      .where(
        and(
          eq(xIdentityRequests.status, "pending"),
          inArray(xIdentityRequests.request_type, ["merge", "revert_merge"]),
          or(
            eq(xIdentityRequests.requested_by_auth_user_id, authUserId),
            eq(xIdentityRequests.source_x_user_id, xUserId),
            eq(xIdentityRequests.target_x_user_id, xUserId),
          )!,
        )!,
      )
      .limit(1)
  )[0];
  return Boolean(row);
}

async function wouldBreakEventOwnerOperability(
  db: DB,
  xUserId: string,
  authUserId: string,
  linkRole: string,
): Promise<boolean> {
  if (linkRole !== "owner") return false;
  const xRow = (
    await db
      .select({ approval_status: xUsers.approval_status })
      .from(xUsers)
      .where(eq(xUsers.id, xUserId))
      .limit(1)
  )[0];
  if (xRow?.approval_status !== "approved") return false;

  const ownerEvents = await db
    .select({ event_id: eventStaff.event_id })
    .from(eventStaff)
    .where(
      and(
        eq(eventStaff.x_user_id, xUserId),
        eq(eventStaff.permission_preset, "owner"),
      )!,
    );
  if (ownerEvents.length === 0) return false;

  const remainingOwnerLinks = await countOwnerRoleLinksForXUser(db, xUserId);
  if (remainingOwnerLinks > 1) return false;

  const userIsOwnerLink = (
    await db
      .select({ x_user_id: xUserAccountLinks.x_user_id })
      .from(xUserAccountLinks)
      .where(
        and(
          eq(xUserAccountLinks.x_user_id, xUserId),
          eq(xUserAccountLinks.auth_user_id, authUserId),
          eq(xUserAccountLinks.link_role, "owner"),
        )!,
      )
      .limit(1)
  )[0];
  return Boolean(userIsOwnerLink);
}

async function hasCreatorVideosWithoutAlternative(
  db: DB,
  xUserId: string,
  authUserId: string,
): Promise<boolean> {
  const videoCount = (
    await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(videos)
      .where(eq(videos.creator_x_user_id, xUserId))
  )[0];
  if (Number(videoCount?.count ?? 0) === 0) return false;

  const otherApproved = await getApprovedLinkedXUserIds(db, authUserId);
  return otherApproved.filter((id) => id !== xUserId).length === 0;
}

async function hasReservedOrSubmittedSlots(
  db: DB,
  xUserId: string,
  authUserId: string,
): Promise<boolean> {
  const row = (
    await db
      .select({ id: slots.id })
      .from(slots)
      .where(
        and(
          eq(slots.x_user_id, xUserId),
          eq(slots.reserved_by_user_id, authUserId),
          inArray(slots.status, ["reserved", "submitted"]),
        )!,
      )
      .limit(1)
  )[0];
  return Boolean(row);
}

async function hasStaffDependenciesWithoutAlternative(
  db: DB,
  xUserId: string,
  authUserId: string,
): Promise<boolean> {
  const staffCount = (
    await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(eventStaff)
      .where(eq(eventStaff.x_user_id, xUserId))
  )[0];
  const hasVideos = (
    await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(videos)
      .where(eq(videos.creator_x_user_id, xUserId))
  )[0];
  const hasDependencies =
    Number(staffCount?.count ?? 0) > 0 || Number(hasVideos?.count ?? 0) > 0;
  if (!hasDependencies) return false;

  const otherApproved = await getApprovedLinkedXUserIds(db, authUserId);
  return otherApproved.filter((id) => id !== xUserId).length === 0;
}

export async function assessXLinkDeletion(
  db: DB,
  authUserId: string,
  xUserId: string,
  linkRole: string,
): Promise<XLinkDeletionAssessment> {
  const blockers: XLinkDeletionBlocker[] = [];

  if (await wouldBreakEventOwnerOperability(db, xUserId, authUserId, linkRole)) {
    blockers.push("event_owner_inoperable");
  }
  if (await hasCreatorVideosWithoutAlternative(db, xUserId, authUserId)) {
    blockers.push("creator_assets_without_alternative");
  }
  if (await hasReservedOrSubmittedSlots(db, xUserId, authUserId)) {
    blockers.push("reserved_or_submitted_slot");
  }
  if (await hasPendingMergeInvolvingXUser(db, xUserId, authUserId)) {
    blockers.push("pending_merge_request");
  }
  if (await hasStaffDependenciesWithoutAlternative(db, xUserId, authUserId)) {
    blockers.push("only_approved_link_with_dependencies");
  }

  return {
    allowed: blockers.length === 0,
    blockers,
    message: blockers.length > 0 ? BLOCKER_MESSAGES[blockers[0]!] : null,
  };
}

/** DELETE SQL でも blocker 不存在を再確認する fail-closed 条件。 */
export function xLinkDeletionAllowedSql(
  authUserId: string,
  xUserId: string,
): SQL {
  return sql`
    NOT EXISTS (
      SELECT 1
      FROM x_user_account_links AS link
      INNER JOIN x_users AS xu ON xu.id = link.x_user_id
      WHERE link.x_user_id = ${xUserId}
        AND link.auth_user_id = ${authUserId}
        AND link.link_role = 'owner'
        AND xu.approval_status = 'approved'
        AND EXISTS (
          SELECT 1
          FROM event_staff AS es
          WHERE es.x_user_id = ${xUserId}
            AND es.permission_preset = 'owner'
        )
        AND (
          SELECT COUNT(*)
          FROM x_user_account_links AS owner_link
          INNER JOIN x_users AS owner_xu ON owner_xu.id = owner_link.x_user_id
          WHERE owner_link.x_user_id = ${xUserId}
            AND owner_link.link_role = 'owner'
            AND owner_xu.approval_status = 'approved'
        ) <= 1
    )
    AND NOT EXISTS (
      SELECT 1
      FROM videos AS v
      WHERE v.creator_x_user_id = ${xUserId}
        AND NOT EXISTS (
          SELECT 1
          FROM x_user_account_links AS alt
          INNER JOIN x_users AS alt_xu ON alt_xu.id = alt.x_user_id
          WHERE alt.auth_user_id = ${authUserId}
            AND alt.x_user_id <> ${xUserId}
            AND alt_xu.approval_status = 'approved'
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM slots AS s
      WHERE s.x_user_id = ${xUserId}
        AND s.reserved_by_user_id = ${authUserId}
        AND s.status IN ('reserved', 'submitted')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM x_identity_requests AS req
      WHERE req.status = 'pending'
        AND req.request_type IN ('merge', 'revert_merge')
        AND (
          req.requested_by_auth_user_id = ${authUserId}
          OR req.source_x_user_id = ${xUserId}
          OR req.target_x_user_id = ${xUserId}
        )
    )
    AND NOT EXISTS (
      SELECT 1
      WHERE (
        EXISTS (SELECT 1 FROM event_staff WHERE x_user_id = ${xUserId})
        OR EXISTS (SELECT 1 FROM videos WHERE creator_x_user_id = ${xUserId})
      )
      AND NOT EXISTS (
        SELECT 1
        FROM x_user_account_links AS alt
        INNER JOIN x_users AS alt_xu ON alt_xu.id = alt.x_user_id
        WHERE alt.auth_user_id = ${authUserId}
          AND alt.x_user_id <> ${xUserId}
          AND alt_xu.approval_status = 'approved'
      )
    )
  `;
}
