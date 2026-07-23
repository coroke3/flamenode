import * as React from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { getLayoutHeaderUser } from "@/lib/auth/layoutHeaderUser";
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
  const user = await getLayoutHeaderUser(false);

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
