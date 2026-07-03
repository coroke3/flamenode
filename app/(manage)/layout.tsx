import * as React from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PublicHeader, type PublicHeaderUser } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { CostGuardBanner } from "@/components/layout/CostGuardBanner";
import { ManageSidebar } from "@/components/layout/ManageSidebar";
import { ManageModeBanner } from "@/components/manage/ManageModeBanner";
import { buildHeaderUser } from "@/lib/auth/headerUser";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * /manage — イベント運営者向けの現場運用（審査・枠・スタッフ等）。
 * /admin はサイト全体の管理本部（admin 専用）。非 admin 運営者を /admin に誘導しない。
 * 認可は各ページで event_staff.permission_mask を参照する。
 */
export default async function ManageLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  let user: PublicHeaderUser | null = null;
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
