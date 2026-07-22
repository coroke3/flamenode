import * as React from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { PublicHeader, type PublicHeaderUser } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { buildHeaderUser } from "@/lib/auth/headerUser";
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
  const session = await auth();
  const user: PublicHeaderUser | null = session?.user
    ? await buildHeaderUser(session.user, { includeXIds: false })
    : null;

  if (!user) redirect("/entry");
  if (user.role !== "admin") redirect("/dashboard");

  return (
    <div data-admin-shell data-fn-surface="admin">
      <PublicHeader user={user} />
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
