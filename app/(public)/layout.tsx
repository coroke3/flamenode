import * as React from "react";
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

export const dynamic = "force-dynamic";

function isPublicOnboardingExemptPath(pathname: string): boolean {
  if (isXIdOnboardingExemptPath(pathname)) return true;
  return pathname === "/rules" || pathname.startsWith("/rules/");
}

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const sessionUser = await getCurrentUser();
  const session = await auth();
  const headerUser: PublicHeaderUser | null = await buildHeaderUser(session?.user);

  if (sessionUser && sessionUser.is_banned !== 1) {
    const hdrs = await headers();
    const pathname = hdrs.get("x-pathname") ?? "";
    const search = hdrs.get("x-search") ?? "";
    if (pathname && !isPublicOnboardingExemptPath(pathname)) {
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
    <div data-fn-surface="public" className="fn-public-shell fn-app">
      <CostGuardBanner />
      <PublicHeader user={headerUser} />
      <main className="fn-main flex-1 w-full">{children}</main>
      <PublicFooter />
    </div>
  );
}
