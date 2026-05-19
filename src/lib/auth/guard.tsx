import * as React from "react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { sanitizeNextPath } from "@/lib/utils/next";

export interface AuthSessionUser {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
  is_banned: number;
  role: "user" | "admin" | "moderator";
  active_x_user_id: string | null;
  is_tos_accepted: number;
  accepted_terms_version_id: string | null;
  terms_reaccept_required: number;
}

/** 管理者かどうか。 */
export const isAdmin = (u: { role?: string }): boolean => u.role === "admin";

export interface RequireSessionOptions {
  /**
   * ログイン後に戻したいパス。未指定の場合は `/dashboard` にフォールバックする。
   * 例: `/dashboard/post/slotted?slot=abc`。
   */
  next?: string;
}

/**
 * Server Component で「ログイン済み + バンされていない」を要求するためのガード。
 * 結果として `{ user }` か、ログイン誘導コンポーネントを返す。
 *
 * `options.next` を渡すと、未ログイン誘導の「Discord でログイン」リンクに
 * `/entry?next=...` 形式で同じパスを引き継ぐ。
 */
export async function requireSession(
  options: RequireSessionOptions = {},
): Promise<
  | { ok: true; user: AuthSessionUser }
  | { ok: false; element: React.ReactElement }
> {
  const u = await getCurrentUser();
  if (!u) {
    return {
      ok: false,
      element: <RequireAuthRedirect next={options.next} />,
    };
  }
  if (u.is_banned === 1) {
    return { ok: false, element: <BannedNotice /> };
  }
  return {
    ok: true,
    user: u,
  };
}

function RequireAuthRedirect({
  next,
}: {
  next?: string;
}): React.ReactElement {
  const safeNext = sanitizeNextPath(next, "/dashboard");
  const href = `/entry?next=${encodeURIComponent(safeNext)}`;
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
      <Link href={href} className="fn-btn fn-btn-primary fn-mt-md">
        Discord でログイン
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
