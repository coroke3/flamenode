import * as React from "react";
import { auth } from "@/lib/auth";
import { PublicHeader, type PublicHeaderUser } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { buildHeaderUser } from "@/lib/auth/headerUser";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  let headerUser: PublicHeaderUser | null = null;

  try {
    const session = await auth();
    headerUser = await buildHeaderUser(session?.user);
  } catch {
    headerUser = null;
  }

  return (
    <>
      <PublicHeader user={headerUser} />
      <main className="flex-1 w-full">{children}</main>
      <PublicFooter />
    </>
  );
}
