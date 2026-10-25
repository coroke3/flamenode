import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { xUserAccountLinks, xUsers } from "@flamenode/db/schema";
import type { ServerCoreDb } from "../db.ts";

export type XUserLinkRole = "owner" | "manager";

export type ApprovedXQueryOptions = {
  linkRoles?: readonly XUserLinkRole[];
};

export const APPROVED_X_IDS_IN_ARRAY_MAX = 80;

function uniqueXIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)));
}

/** JSON membership is materialized once, so the outer column can use its index. */
export function approvedXIdsWhere(column: AnySQLiteColumn, ids: readonly string[]): SQL {
  const unique = uniqueXIds(ids);
  if (unique.length === 0) return sql`false`;
  if (unique.length <= APPROVED_X_IDS_IN_ARRAY_MAX) return inArray(column, unique);
  return sql`${column} IN (
    SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(unique)})
    WHERE value IS NOT NULL
  )`;
}

export function approvedXIdsNotWhere(column: AnySQLiteColumn, ids: readonly string[]): SQL {
  const unique = uniqueXIds(ids);
  if (unique.length === 0) return sql`true`;
  if (unique.length <= APPROVED_X_IDS_IN_ARRAY_MAX) return sql`NOT (${inArray(column, unique)})`;
  return sql`${column} IS NOT NULL AND ${column} NOT IN (
    SELECT CAST(value AS TEXT) FROM json_each(${JSON.stringify(unique)})
    WHERE value IS NOT NULL
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
  db: ServerCoreDb,
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
  db: ServerCoreDb,
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
  db: ServerCoreDb,
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
