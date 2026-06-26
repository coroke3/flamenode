import * as React from "react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { sanitizeNextPath } from "#utils/next";

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
   * 例: `/entry/slotted?slot=abc`。
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
    <div className="fn-public-container fn-page fn-guard-shell">
      <div className="fn-empty fn-guard-card">
        <h1 className="fn-guard-title">ログインが必要です</h1>
        <p className="fn-empty-message">
          この画面はログイン後にご利用いただけます。
        </p>
        <Link href={href} className="fn-btn fn-btn-primary fn-mt-md">
          Discord でログイン
        </Link>
      </div>
    </div>
  );
}

function BannedNotice(): React.ReactElement {
  return (
    <div className="fn-public-container fn-page fn-guard-shell">
      <div className="fn-empty fn-guard-card fn-guard-card--danger">
        <h1 className="fn-guard-title fn-guard-title--danger">
          利用が停止されています
        </h1>
        <p className="fn-empty-message">
          現在、このアカウントは利用が停止されています。
          詳細は運営までお問い合わせください。
        </p>
      </div>
    </div>
  );
}
