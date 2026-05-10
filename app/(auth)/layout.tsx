import * as React from "react";
import { auth } from "@/lib/auth";
import { AuthHeader } from "@/components/layout/AuthHeader";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { PublicFooter } from "@/components/layout/PublicFooter";

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
  let user: {
    id: string;
    name: string;
    image: string | null;
    xIds: never[];
  } | null = null;

  try {
    const session = await auth();
    if (session?.user) {
      user = {
        id: (session.user as { id?: string }).id ?? "",
        name: session.user.name ?? "ゲスト",
        image: session.user.image ?? null,
        xIds: [],
      };
    }
  } catch {
    user = null;
  }

  return (
    <>
      {user ? (
        <AuthHeader user={user} />
      ) : (
        <PublicHeader user={null} />
      )}
      <main style={{ flex: 1, width: "100%" }}>{children}</main>
      <PublicFooter />
    </>
  );
}
