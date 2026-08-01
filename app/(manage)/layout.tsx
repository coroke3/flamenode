import * as React from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { CostGuardBanner } from "@/components/layout/CostGuardBanner";
import { ConsoleShell } from "@/components/layout/ConsoleShell";
import { ConsoleSidebar } from "@/components/layout/ConsoleSidebar";
import { getLayoutAuthSurface } from "@/lib/auth/requestAuthContext";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * /manage — イベント運営者向けの現場運用（審査・枠・スタッフ等）。
 * /admin はサイト管理（admin 専用）。非 admin 運営者を /admin に誘導しない。
 * 認可は各ページで event_staff の権限キーを参照する。
 * X ID 未設定によるオンボーディング強制リダイレクトは行わない。
 */
export default async function ManageLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const { headerUser, enrichmentFailed } = await getLayoutAuthSurface();

  if (!headerUser) redirect("/entry");
  if (enrichmentFailed) {
    redirect("/entry?error=auth_temporarily_unavailable");
  }
  if (!headerUser.management.canAccessAdmin && !headerUser.management.canAccessManage) {
    redirect("/dashboard");
  }

  return (
    <div data-manage-shell data-fn-surface="manage">
      <CostGuardBanner />
      <PublicHeader user={headerUser} hydrateAccount />
      <ConsoleShell
        consoleMode="manage"
        navigation={<ConsoleSidebar consoleMode="manage" />}
      >
        <main className="manage-main">
          {children}
        </main>
      </ConsoleShell>
      <PublicFooter />
    </div>
  );
}
