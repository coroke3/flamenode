import * as React from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PublicHeader, type PublicHeaderUser } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { CostGuardBanner } from "@/components/layout/CostGuardBanner";
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
 * 認証エリア共通レイアウト。
 * 個別ページ (dashboard / post / settings 等) のガードはページ側で行い、
 * このレイアウトはセッション有無に応じてヘッダーだけ出し分ける。
 * これにより `/entry` (ログイン誘導画面) も同じレイアウト下で動かせる。
 */
export default async function AuthLayout({
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
    <div data-fn-surface="personal" className="fn-personal-shell fn-app">
      <CostGuardBanner />
      <PublicHeader user={user} />
      <main className="fn-main flex-1 w-full">{children}</main>
      <PublicFooter />
    </div>
  );
}
