import "server-only";

import { and, eq } from "drizzle-orm";
import { withDatabase } from "@/lib/cloudflare";
import { xAccountLinkRequests, xUsers } from "@/lib/db/schema";
import { sanitizeNextPath } from "#utils/next";

const EXEMPT_PATH_PREFIXES = ["/dashboard/settings"];

export function isXIdOnboardingExemptPath(pathname: string): boolean {
  const path = pathname.trim() || "/";
  return EXEMPT_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function buildXIdOnboardingHref(next?: string | null): string {
  const qs = new URLSearchParams();
  qs.set("tab", "link");
  qs.set("onboarding", "1");
  const safeNext = next?.trim();
  if (
    safeNext &&
    safeNext !== "/dashboard/settings" &&
    !safeNext.startsWith("/dashboard/settings?")
  ) {
    qs.set("next", sanitizeNextPath(safeNext, "/dashboard"));
  }
  return `/dashboard/settings?${qs.toString()}`;
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
    const linked = await db
      .select({ id: xUsers.id })
      .from(xUsers)
      .where(eq(xUsers.linked_discord_user_id, userId))
      .limit(1);
    if (linked.length > 0) return false;

    const pending = await db
      .select({ id: xAccountLinkRequests.id })
      .from(xAccountLinkRequests)
      .where(
        and(
          eq(xAccountLinkRequests.discord_user_id, userId),
          eq(xAccountLinkRequests.status, "pending"),
        )!,
      )
      .limit(1);
    if (pending.length > 0) return false;

    return true;
  });

  return needs ?? false;
}
