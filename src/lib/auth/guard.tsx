import * as React from "react";
import Link from "next/link";
import { auth } from "@/lib/auth";

export interface AuthSessionUser {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
  is_banned: number;
  role: "user" | "admin" | "moderator";
  active_x_user_id: string | null;
}

/** 管理者かどうか。 */
export const isAdmin = (u: { role?: string }): boolean => u.role === "admin";

/**
 * Server Component で「ログイン済み + バンされていない」を要求するためのガード。
 * 結果として `{ user }` か、ログイン誘導コンポーネントを返す。
 */
export async function requireSession(): Promise<
  | { ok: true; user: AuthSessionUser }
  | { ok: false; element: React.ReactElement }
> {
  let session;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  if (!session?.user) {
    return { ok: false, element: <RequireAuthRedirect /> };
  }
  const u = session.user as Partial<AuthSessionUser> & { id?: string };
  if (!u.id) return { ok: false, element: <RequireAuthRedirect /> };
  if (u.is_banned === 1) {
    return { ok: false, element: <BannedNotice /> };
  }
  return {
    ok: true,
    user: {
      id: u.id,
      name: u.name ?? "ゲスト",
      email: (u as { email?: string | null }).email ?? null,
      image: u.image ?? null,
      is_banned: u.is_banned ?? 0,
      role: (u.role ?? "user") as "user" | "admin" | "moderator",
      active_x_user_id: u.active_x_user_id ?? null,
    },
  };
}

function RequireAuthRedirect(): React.ReactElement {
  return (
    <div
      style={{
        width: "min(96%, 720px)",
        margin: "60px auto",
        padding: "48px 28px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>ログインが必要です</h1>
      <p style={{ marginTop: 12, color: "var(--text-secondary)" }}>
        この画面はログイン後にご利用いただけます。
      </p>
      <Link href="/entry" className="fn-btn fn-btn-primary fn-mt-md">
        ログインへ
      </Link>
    </div>
  );
}

function BannedNotice(): React.ReactElement {
  return (
    <div
      style={{
        width: "min(96%, 720px)",
        margin: "60px auto",
        padding: "48px 28px",
        background: "var(--bg-surface)",
        border: "1px solid var(--accent-danger)",
        borderRadius: "var(--radius-md)",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--accent-danger)" }}>
        利用が停止されています
      </h1>
      <p style={{ marginTop: 12, color: "var(--text-secondary)" }}>
        現在、このアカウントは利用が停止されています。
        <br />
        詳細は運営までお問い合わせください。
      </p>
    </div>
  );
}
