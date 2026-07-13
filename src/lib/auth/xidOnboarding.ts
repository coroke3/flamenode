import "server-only";

import { and, eq } from "drizzle-orm";
import { withDatabase } from "@/lib/cloudflare";
import { xAccountLinkRequests, xUsers } from "@/lib/db/schema";
import { sanitizeNextPath } from "#utils/next";

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
  userId: string,
  role?: string | null,
): Promise<boolean> {
  if (role === "admin" || role === "moderator") return false;

  const needs = await withDatabase(async (db) => {
    const [linked, pending] = await Promise.all([
      db
        .select({ id: xUsers.id })
        .from(xUsers)
        .where(eq(xUsers.linked_user_id, userId))
        .limit(1),
      db
        .select({ id: xAccountLinkRequests.id })
        .from(xAccountLinkRequests)
        .where(
          and(
            eq(xAccountLinkRequests.user_id, userId),
            eq(xAccountLinkRequests.status, "pending"),
          )!,
        )
        .limit(1),
    ]);
    return linked.length === 0 && pending.length === 0;
  });

  return needs ?? false;
}
