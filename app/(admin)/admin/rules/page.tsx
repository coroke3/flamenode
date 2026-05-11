import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { termsVersions } from "@/lib/db/schema";
import { formatUnix } from "@/lib/utils/format";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "規約管理" };
export const dynamic = "force-dynamic";

export default async function AdminRulesPage(): Promise<React.ReactElement> {
  const db = getDatabase();
  const rows = db
    ? await db
        .select()
        .from(termsVersions)
        .orderBy(desc(termsVersions.updated_at))
        .limit(20)
    : [];

  return (
    <div>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>利用規約</h1>
        <Link
          href="/admin/rules/new"
          className="fn-btn fn-btn-primary fn-btn-sm"
        >
          <Icon name="plus" size={12} aria-hidden /> 新規バージョン
        </Link>
      </header>

      <p style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
        変更があった場合、影響度に応じて「再同意必須」を設定すると、次回投稿時にユーザーに同意導線を表示します。
      </p>

      <table className="fn-table" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>バージョン</th>
            <th>状態</th>
            <th>影響度</th>
            <th>公開日</th>
            <th>更新</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>
                <strong>{t.version_label}</strong>
              </td>
              <td>
                {t.status === "published" ? (
                  <span className="fn-badge fn-badge-accent">公開中</span>
                ) : t.status === "draft" ? (
                  <span className="fn-badge fn-badge-soft">下書き</span>
                ) : (
                  <span className="fn-badge fn-badge-neutral">アーカイブ</span>
                )}
              </td>
              <td>
                {t.severity === "major" ? (
                  <span className="fn-badge fn-badge-warning">major</span>
                ) : (
                  <span className="fn-badge fn-badge-soft">minor</span>
                )}
              </td>
              <td>{t.published_at ? formatUnix(t.published_at, { dateOnly: true }) : "—"}</td>
              <td>{formatUnix(t.updated_at)}</td>
              <td>
                <Link
                  href={`/admin/rules/${t.id}/edit`}
                  className="fn-btn fn-btn-ghost fn-btn-sm"
                >
                  編集
                </Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6}>
                <p
                  className="fn-empty-message"
                  style={{ padding: 16, textAlign: "center" }}
                >
                  規約バージョンがまだ登録されていません。
                </p>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
