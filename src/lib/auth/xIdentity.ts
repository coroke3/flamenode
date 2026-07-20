import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { xIdentityRequests, xUserAccountLinks, xUsers } from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";

export type AuthUserId = string;
export type XUserId = string;
export type XUserLinkRole = "owner" | "manager";

export type LinkedXUser = {
  x_user_id: XUserId;
  x_name: string;
  icon_url: string | null;
  youtube_channel_url: string | null;
  profile_text: string | null;
  portfolio_contact: string | null;
  other_social_links: string | null;
  approval_status: string | null;
  link_role: XUserLinkRole;
  created_by_request_id: string | null;
  created_at: number;
  updated_at: number;
  request_requested_at: number | null;
};

export async function getLinkedXUsersForAuthUser(
  db: DB,
  authUserId: AuthUserId,
  options: { approvedOnly?: boolean } = {},
): Promise<LinkedXUser[]> {
  const baseCondition = eq(xUserAccountLinks.auth_user_id, authUserId);
  const condition = options.approvedOnly
    ? and(baseCondition, eq(xUsers.approval_status, "approved"))!
    : baseCondition;
  return db
    .select({
      x_user_id: xUsers.id,
      x_name: xUsers.x_name,
      icon_url: xUsers.icon_url,
      youtube_channel_url: xUsers.youtube_channel_url,
      profile_text: xUsers.profile_text,
      portfolio_contact: xUsers.portfolio_contact,
      other_social_links: xUsers.other_social_links,
      approval_status: xUsers.approval_status,
      link_role: xUserAccountLinks.link_role,
      created_by_request_id: xUserAccountLinks.created_by_request_id,
      created_at: xUserAccountLinks.created_at,
      updated_at: xUserAccountLinks.updated_at,
      request_requested_at: xIdentityRequests.requested_at,
    })
    .from(xUserAccountLinks)
    .innerJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
    .leftJoin(
      xIdentityRequests,
      eq(xIdentityRequests.id, xUserAccountLinks.created_by_request_id),
    )
    .where(condition);
}

export async function getLinkedXUserIdsForAuthUser(
  db: DB,
  authUserId: AuthUserId,
  options: { approvedOnly?: boolean } = {},
): Promise<XUserId[]> {
  const rows = await getLinkedXUsersForAuthUser(db, authUserId, options);
  return Array.from(new Set(rows.map((row) => row.x_user_id)));
}

export async function getLinkedXUserForAuthUser(
  db: DB,
  authUserId: AuthUserId,
  xUserId: XUserId,
): Promise<LinkedXUser | null> {
  const normalizedXUserId = normalizeXId(xUserId);
  if (!normalizedXUserId) return null;
  const rows = await db
    .select({
      x_user_id: xUsers.id,
      x_name: xUsers.x_name,
      icon_url: xUsers.icon_url,
      youtube_channel_url: xUsers.youtube_channel_url,
      profile_text: xUsers.profile_text,
      portfolio_contact: xUsers.portfolio_contact,
      other_social_links: xUsers.other_social_links,
      approval_status: xUsers.approval_status,
      link_role: xUserAccountLinks.link_role,
      created_by_request_id: xUserAccountLinks.created_by_request_id,
      created_at: xUserAccountLinks.created_at,
      updated_at: xUserAccountLinks.updated_at,
      request_requested_at: xIdentityRequests.requested_at,
    })
    .from(xUserAccountLinks)
    .innerJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
    .leftJoin(
      xIdentityRequests,
      eq(xIdentityRequests.id, xUserAccountLinks.created_by_request_id),
    )
    .where(
      and(
        eq(xUserAccountLinks.auth_user_id, authUserId),
        eq(xUserAccountLinks.x_user_id, normalizedXUserId),
      )!,
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function isAuthUserLinkedToXUser(
  db: DB,
  authUserId: AuthUserId,
  xUserId: XUserId,
): Promise<boolean> {
  return (await getLinkedXUserForAuthUser(db, authUserId, xUserId)) !== null;
}

export async function getAuthUserIdsForXUser(
  db: DB,
  xUserId: XUserId,
): Promise<AuthUserId[]> {
  const normalizedXUserId = normalizeXId(xUserId);
  if (!normalizedXUserId) return [];
  const rows = await db
    .select({ auth_user_id: xUserAccountLinks.auth_user_id })
    .from(xUserAccountLinks)
    .where(eq(xUserAccountLinks.x_user_id, normalizedXUserId));
  return Array.from(new Set(rows.map((row) => row.auth_user_id)));
}

export async function filterLinkedXUserIdsForAuthUser(
  db: DB,
  authUserId: AuthUserId,
  candidateXUserIds: readonly string[],
): Promise<XUserId[]> {
  const normalized = Array.from(
    new Set(candidateXUserIds.map(normalizeXId).filter(Boolean)),
  );
  if (normalized.length === 0) return [];
  const rows = await db
    .select({ x_user_id: xUserAccountLinks.x_user_id })
    .from(xUserAccountLinks)
    .where(
      and(
        eq(xUserAccountLinks.auth_user_id, authUserId),
        inArray(xUserAccountLinks.x_user_id, normalized),
      )!,
    );
  return Array.from(new Set(rows.map((row) => row.x_user_id)));
}
