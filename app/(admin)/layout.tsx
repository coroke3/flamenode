import * as React from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { CostGuardBanner } from "@/components/layout/CostGuardBanner";
import { getLayoutAuthSurface } from "@/lib/auth/requestAuthContext";
import { ConsoleShell } from "@/components/layout/ConsoleShell";
import { ConsoleSidebar } from "@/components/layout/ConsoleSidebar";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const { headerUser, enrichmentFailed } = await getLayoutAuthSurface();

  if (!headerUser) redirect("/entry");
  if (enrichmentFailed) {
    redirect("/entry?error=auth_temporarily_unavailable");
  }
  if (headerUser.role !== "admin") redirect("/dashboard");

  return (
    <div data-admin-shell data-fn-surface="admin">
      <CostGuardBanner source="admin" />
      <PublicHeader user={headerUser} hydrateAccount />
      <ConsoleShell
        consoleMode="admin"
        navigation={<ConsoleSidebar consoleMode="admin" />}
      >
        <main className="admin-main">{children}</main>
      </ConsoleShell>
      <PublicFooter />
    </div>
  );
}
