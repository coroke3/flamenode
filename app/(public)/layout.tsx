import * as React from "react";
import { auth } from "@/lib/auth";
import { PublicHeader, type PublicHeaderUser } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  let headerUser: PublicHeaderUser | null = null;
  try {
    const session = await auth();
    if (session?.user) {
      headerUser = {
        id: (session.user as { id?: string }).id ?? "",
        name: session.user.name ?? "ゲスト",
        image: session.user.image ?? null,
        // X ID 一覧は実運用ではユーザーごとに DB から取得する。
        // 認証構成が未完了でも UI が壊れないよう、空配列で初期化する。
        xIds: [],
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
