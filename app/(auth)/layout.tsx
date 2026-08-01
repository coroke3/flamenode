import * as React from "react";
import type { Metadata } from "next";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { CostGuardBanner } from "@/components/layout/CostGuardBanner";
import { getLayoutAuthSurface } from "@/lib/auth/requestAuthContext";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * 認証エリア共通レイアウト。
 * 認証状態は getLayoutAuthSurface(=getRequestAuthContext) を1回だけ呼ぶ。
 * X ID 未設定によるオンボーディング強制リダイレクトは行わない。
 */
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const { headerUser } = await getLayoutAuthSurface();

  return (
    <div data-fn-surface="personal" className="fn-personal-shell fn-app">
      <CostGuardBanner />
      <PublicHeader user={headerUser} hydrateAccount />
      <main className="fn-main flex-1 w-full">{children}</main>
      <PublicFooter />
    </div>
  );
}
