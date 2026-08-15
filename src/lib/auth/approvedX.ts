import "server-only";

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { DB } from "@/lib/db/client";
import { xUserAccountLinks, xUsers } from "@/lib/db/schema";
import type { XUserLinkRole } from "./xIdentity";

export type ApprovedXQueryOptions = {
  linkRoles?: readonly XUserLinkRole[];
};

/**
 * Keep authorization predicates below D1's bind limit even for an account
 * linked to many approved X identities.  Small sets retain the indexed IN
 * plan; larger sets travel as one JSON1 bind instead of overflowing a
 * statement that also contains video/event predicates.
 */
export const APPROVED_X_IDS_IN_ARRAY_MAX = 80;

function uniqueXIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)));
}

export function approvedXIdsWhere(
  column: AnySQLiteColumn,
  ids: readonly string[],
): SQL {
  const unique = uniqueXIds(ids);
  if (unique.length === 0) return sql`false`;
  if (unique.length <= APPROVED_X_IDS_IN_ARRAY_MAX) {
    return inArray(column, unique);
  }
  return sql`EXISTS (
    SELECT 1
    FROM json_each(${JSON.stringify(unique)}) AS approved_x_ids
    WHERE CAST(approved_x_ids.value AS TEXT) = ${column}
  )`;
}

export function approvedXIdsNotWhere(
  column: AnySQLiteColumn,
  ids: readonly string[],
): SQL {
  const unique = uniqueXIds(ids);
  if (unique.length === 0) return sql`true`;
  if (unique.length <= APPROVED_X_IDS_IN_ARRAY_MAX) {
    return sql`NOT (${inArray(column, unique)})`;
  }
  return sql`${column} IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM json_each(${JSON.stringify(unique)}) AS approved_x_ids
    WHERE CAST(approved_x_ids.value AS TEXT) = ${column}
  )`;
}

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
