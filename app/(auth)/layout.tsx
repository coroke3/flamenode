import * as React from "react";
import type { Metadata } from "next";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { CostGuardBanner } from "@/components/layout/CostGuardBanner";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLayoutAuthSurface } from "@/lib/auth/requestAuthContext";
import {
  buildXIdOnboardingHref,
  isXIdOnboardingExemptPath,
} from "@/lib/auth/xidOnboarding";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * 認証エリア共通レイアウト。
 * 認証状態は getLayoutAuthSurface(=getRequestAuthContext) を1回だけ呼ぶ。
 */
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const { currentUser, headerUser, needsXIdOnboarding } =
    await getLayoutAuthSurface();

  if (currentUser && currentUser.is_banned !== 1 && needsXIdOnboarding) {
    const hdrs = await headers();
    const pathname = hdrs.get("x-pathname") ?? "";
    const search = hdrs.get("x-search") ?? "";
    if (pathname && !isXIdOnboardingExemptPath(pathname)) {
      const returnTo = search ? `${pathname}?${search}` : pathname;
      redirect(buildXIdOnboardingHref(returnTo));
    }
  }

  return (
    <div data-fn-surface="personal" className="fn-personal-shell fn-app">
      <CostGuardBanner />
      <PublicHeader user={headerUser} hydrateAccount />
      <main className="fn-main flex-1 w-full">{children}</main>
      <PublicFooter />
    </div>
  );
}
