import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { termsVersions, users as usersTable } from "@/lib/db/schema";
import { formatUnix } from "@/lib/utils/format";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "規約管理" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams?: Promise<{ status?: string }>;
}

export default async function AdminRulesPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const sp = (await searchParams) ?? {};
  const statusFilter =
    sp.status === "published" ||
    sp.status === "draft" ||
    sp.status === "archived"
      ? sp.status
      : "any";

  const db = getDatabase();
  const rows = db
    ? await (statusFilter === "any"
        ? db
            .select()
            .from(termsVersions)
            .orderBy(desc(termsVersions.updated_at))
            .limit(20)
        : db
            .select()
            .from(termsVersions)
            .where(eq(termsVersions.status, statusFilter))
            .orderBy(desc(termsVersions.updated_at))
            .limit(20))
    : [];

  // dry-run: major 公開時に再同意が必要になるユーザー数
  let userCount = 0;
  if (db) {
    try {
      const r = await db.select({ c: sql<number>`COUNT(*)` }).from(usersTable);
      userCount = Number(r[0]?.c ?? 0);
    } catch (e) {
      console.error("[AdminRulesPage] user count failed", e);
    }
  }

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

      <form
        method="get"
        style={{
          marginTop: 12,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <select name="status" className="fn-select" defaultValue={statusFilter}>
          <option value="any">全状態</option>
          <option value="published">公開中</option>
          <option value="draft">下書き</option>
          <option value="archived">アーカイブ</option>
        </select>
        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm">
          絞り込み
        </button>
      </form>

      <section
        style={{
          marginTop: 16,
          padding: "12px 14px",
          background: "var(--bg-surface)",
          border: "1px dashed var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          fontSize: 12,
          color: "var(--text-secondary)",
        }}
      >
        <strong style={{ color: "var(--text-primary)" }}>
          major 公開時の影響範囲 (dry-run)
        </strong>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
          <li>
            <code>terms_reaccept_required = 1</code> が立つユーザー: 約{" "}
            <strong>{userCount.toLocaleString()}</strong> 件 (全ユーザー)
          </li>
          <li>
            通知 enqueue: <strong>0 件</strong> (Opus 判断候補のため未実装)
          </li>
        </ul>
        <p style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
          注意: major 公開時の Discord 通知 enqueue は notification_outbox の容量と
          Discord Webhook rate-limit を考慮してから実装します。現状はサイト内表示のみ。
        </p>
      </section>

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
