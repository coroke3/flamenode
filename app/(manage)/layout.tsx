import * as React from "react";
import { auth } from "@/lib/auth";
import { AuthHeader } from "@/components/layout/AuthHeader";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { CostGuardBanner } from "@/components/layout/CostGuardBanner";
import { buildHeaderUser, type HeaderUser } from "@/lib/auth/headerUser";

/**
 * イベント運営者エリア共通レイアウト。
 * 管理者と異なり、サイドバーは持たず本文を広く使う。
 * 認可は各ページが行う (eventEditors に該当行があるか)。
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

  return (
    <>
      <CostGuardBanner />
      {user ? <AuthHeader user={user} /> : <PublicHeader user={null} />}
      <main
        style={{
          flex: 1,
          width: "min(96%, 1100px)",
          margin: "0 auto",
          padding: "20px 16px 64px",
        }}
      >
        {children}
      </main>
      <PublicFooter />
    </>
  );
}
