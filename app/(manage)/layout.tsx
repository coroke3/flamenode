import * as React from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthHeader } from "@/components/layout/AuthHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { CostGuardBanner } from "@/components/layout/CostGuardBanner";
import { ManageSidebar } from "@/components/layout/ManageSidebar";
import { buildHeaderUser, type HeaderUser } from "@/lib/auth/headerUser";

/**
 * イベント運営者エリア共通レイアウト。
 * 担当イベントがあれば左にサイドバー (クイックナビ) を表示する。
 * 認可は各ページで判定する (eventEditors に該当行があるか)。
 */
export default async function ManageLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  let user: HeaderUser | null = null;
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
    <>
      <CostGuardBanner />
      <AuthHeader user={user} />
      <div
        style={{
          flex: 1,
          width: "min(96%, 1300px)",
          margin: "0 auto",
          padding: "20px 16px 64px",
          display: "flex",
          gap: 24,
          alignItems: "flex-start",
        }}
      >
        <ManageSidebar />
        <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
      </div>
      <PublicFooter />
    </>
  );
}
