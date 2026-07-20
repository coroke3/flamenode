import "server-only";

import { and, eq } from "drizzle-orm";
import { withDatabaseRead } from "@/lib/cloudflare";
import { xIdentityRequests } from "@/lib/db/schema";
import { sanitizeNextPath } from "#utils/next";
import { getLinkedXUserIdsForAuthUser } from "./xIdentity";

const SETTINGS_PATH = "/dashboard/settings";

export function isXIdOnboardingExemptPath(pathname: string): boolean {
  const path = pathname.trim() || "/";
  return path === SETTINGS_PATH || path.startsWith(`${SETTINGS_PATH}/`);
}

export function buildXIdOnboardingHref(next?: string | null): string {
  const qs = new URLSearchParams({ tab: "link", onboarding: "1" });
  const safeNext = next?.trim();
  if (
    safeNext &&
    safeNext !== SETTINGS_PATH &&
    !safeNext.startsWith(`${SETTINGS_PATH}?`)
  ) {
    qs.set("next", sanitizeNextPath(safeNext, "/dashboard"));
  }
  return `${SETTINGS_PATH}?${qs.toString()}`;
}

/**
 * 連携済み X ID も承認待ち申請もないユーザーは初回オンボーディング対象。
 * admin / moderator は運用アカウントのため除外する。
 */
export async function userNeedsXIdOnboarding(
  authUserId: string,
  role?: string | null,
): Promise<boolean> {
  if (role === "admin" || role === "moderator") return false;

  const needs = await withDatabaseRead(async (db) => {
    const [linkedXUserIds, pending] = await Promise.all([
      getLinkedXUserIdsForAuthUser(db, authUserId),
      db
        .select({ id: xIdentityRequests.id })
        .from(xIdentityRequests)
        .where(
          and(
            eq(xIdentityRequests.requested_by_auth_user_id, authUserId),
            eq(xIdentityRequests.status, "pending"),
          )!,
        )
        .limit(1),
    ]);
    return linkedXUserIds.length === 0 && pending.length === 0;
  });

  return needs ?? false;
}
