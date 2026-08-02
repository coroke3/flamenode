import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { xUserAccountLinks, xUsers } from "@/lib/db/schema";
import type { XUserLinkRole } from "./xIdentity";

export type ApprovedXQueryOptions = {
  linkRoles?: readonly XUserLinkRole[];
};

function approvedLinkConditions(
  authUserId: string,
  options: ApprovedXQueryOptions = {},
) {
  const conditions = [
    eq(xUserAccountLinks.auth_user_id, authUserId),
    eq(xUsers.approval_status, "approved"),
  ];
  if (options.linkRoles && options.linkRoles.length > 0) {
    conditions.push(inArray(xUserAccountLinks.link_role, [...options.linkRoles]));
  }
  return and(...conditions)!;
}

/** 認可用途: x_user_account_links + approval_status=approved (+ link_role)。imported は含めない。 */
export async function getApprovedLinkedXUserIds(
  db: DB,
  authUserId: string,
  options: ApprovedXQueryOptions = {},
): Promise<string[]> {
  const rows = await db
    .select({ x_user_id: xUserAccountLinks.x_user_id })
    .from(xUserAccountLinks)
    .innerJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
    .where(approvedLinkConditions(authUserId, options));
  return Array.from(new Set(rows.map((row) => row.x_user_id)));
}

export async function isApprovedLinkedXUser(
  db: DB,
  authUserId: string,
  xUserId: string,
  options: ApprovedXQueryOptions = {},
): Promise<boolean> {
  const row = (
    await db
      .select({ x_user_id: xUserAccountLinks.x_user_id })
      .from(xUserAccountLinks)
      .innerJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
      .where(
        and(
          approvedLinkConditions(authUserId, options),
          eq(xUserAccountLinks.x_user_id, xUserId),
        )!,
      )
      .limit(1)
  )[0];
  return Boolean(row);
}

/** event owner operability: approved かつ owner role link が1件以上ある X ID。 */
export async function countOwnerRoleLinksForXUser(
  db: DB,
  xUserId: string,
): Promise<number> {
  const rows = await db
    .select({ auth_user_id: xUserAccountLinks.auth_user_id })
    .from(xUserAccountLinks)
    .innerJoin(xUsers, eq(xUsers.id, xUserAccountLinks.x_user_id))
    .where(
      and(
        eq(xUserAccountLinks.x_user_id, xUserId),
        eq(xUserAccountLinks.link_role, "owner"),
        eq(xUsers.approval_status, "approved"),
      )!,
    );
  return rows.length;
}
