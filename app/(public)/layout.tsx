import * as React from "react";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { PublicHeader, type PublicHeaderUser } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";
import { getDatabase } from "@/lib/cloudflare";
import { xUsers } from "@/lib/db/schema";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  let headerUser: PublicHeaderUser | null = null;

  try {
    const session = await auth();
    if (session?.user) {
      const sessionUser = session.user as {
        id?: string;
        active_x_user_id?: string | null;
      };
      const xIds: PublicHeaderUser["xIds"] = [];
      const db = getDatabase();

      if (db && sessionUser.id) {
        const rows = await db
          .select({
            x_user_id: xUsers.id,
            x_name: xUsers.x_name,
            icon_url: xUsers.icon_url,
            approval_status: xUsers.approval_status,
          })
          .from(xUsers)
          .where(eq(xUsers.linked_discord_user_id, sessionUser.id));

        xIds.push(
          ...rows.map((row) => ({
            x_user_id: row.x_user_id,
            x_name: row.x_name,
            icon_url: row.icon_url,
            approval_status: row.approval_status ?? "pending",
            is_active: row.x_user_id === sessionUser.active_x_user_id,
          })),
        );
      }

      headerUser = {
        id: sessionUser.id ?? "",
        name: session.user.name ?? "ゲスト",
        image: session.user.image ?? null,
        xIds,
      };
    }
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
