import * as React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PublicHeader, type PublicHeaderUser } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { CostGuardBanner } from "@/components/layout/CostGuardBanner";
import { ManageSidebar } from "@/components/layout/ManageSidebar";
import { ManageModeBanner } from "@/components/manage/ManageModeBanner";
import { buildHeaderUser } from "@/lib/auth/headerUser";
import { getCurrentUser } from "@/lib/auth/currentUser";
import {
  buildXIdOnboardingHref,
  isXIdOnboardingExemptPath,
  userNeedsXIdOnboarding,
} from "@/lib/auth/xidOnboarding";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * /manage — イベント運営者向けの現場運用（審査・枠・スタッフ等）。
 * /admin はサイト管理（admin 専用）。非 admin 運営者を /admin に誘導しない。
 * 認可は各ページで event_staff の権限キーを参照する。
 */
export default async function ManageLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  let user: PublicHeaderUser | null = null;
  const sessionUser = await getCurrentUser();
  try {
    const session = await auth();
    user = await buildHeaderUser(session?.user);
  } catch {
    user = null;
  }

  if (!user) redirect("/entry");
  if (!user.management.canAccessAdmin && !user.management.canAccessManage) {
    redirect("/dashboard");
  }

  if (sessionUser && sessionUser.is_banned !== 1) {
    const hdrs = await headers();
    const pathname = hdrs.get("x-pathname") ?? "";
    const search = hdrs.get("x-search") ?? "";
    if (pathname && !isXIdOnboardingExemptPath(pathname)) {
      const needsOnboarding = await userNeedsXIdOnboarding(
        sessionUser.id,
        sessionUser.role,
      );
      if (needsOnboarding) {
        const returnTo = search ? `${pathname}?${search}` : pathname;
        redirect(buildXIdOnboardingHref(returnTo));
      }
    }
  }

  return (
    <div data-manage-shell data-fn-surface="manage">
      <CostGuardBanner />
      <PublicHeader user={user} />
      <div className="manage-shell">
        <ManageSidebar />
        <main className="manage-main">
          <ManageModeBanner />
          {children}
        </main>
      </div>
      <PublicFooter />
    </div>
  );
}
