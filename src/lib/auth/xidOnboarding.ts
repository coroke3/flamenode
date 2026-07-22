import "server-only";

import { and, eq } from "drizzle-orm";
import { withDatabase } from "@/lib/cloudflare";
import { xIdentityRequests } from "@/lib/db/schema";
import { onboardingHref } from "./onboardingUrls";
import { getLinkedXUserIdsForAuthUser } from "./xIdentity";

const SETTINGS_PATH = "/dashboard/settings";
const ONBOARDING_PATH = "/onboarding";
const RULES_PATH = "/rules";

export function isXIdOnboardingExemptPath(pathname: string): boolean {
  const path = pathname.trim() || "/";
  if (path === SETTINGS_PATH || path.startsWith(`${SETTINGS_PATH}/`)) {
    return true;
  }
  if (path === ONBOARDING_PATH || path.startsWith(`${ONBOARDING_PATH}/`)) {
    return true;
  }
  if (path === RULES_PATH || path.startsWith(`${RULES_PATH}/`)) {
    return true;
  }
  return false;
}

export function buildXIdOnboardingHref(next?: string | null): string {
  const safeNext = next?.trim();
  return onboardingHref(safeNext || undefined);
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

  const needs = await withDatabase(async (db) => {
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
