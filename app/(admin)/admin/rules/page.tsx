import * as React from "react";import { FnTable } from "@/components/ui/FnTable";

import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { termsVersions, users as usersTable } from "@/lib/db/schema";
import { formatUnix } from "@/lib/utils/format";
import { Icon } from "@/components/ui/Icon";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { TermsReacceptBroadcastButton } from "@/components/admin/TermsReacceptBroadcastButton";

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

  let userCount = 0;
  let reacceptRequiredCount = 0;
  const currentPublishedTerms = db
    ? (
        await db
          .select()
          .from(termsVersions)
          .where(eq(termsVersions.status, "published"))
          .orderBy(desc(termsVersions.published_at), desc(termsVersions.updated_at))
          .limit(1)
      )[0] ?? null
    : null;
  if (db) {
    try {
      const [allRows, reacceptRows] = await Promise.all([
        db.select({ c: sql<number>`COUNT(*)` }).from(usersTable),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(usersTable)
          .where(eq(usersTable.terms_reaccept_required, 1)),
      ]);
      userCount = Number(allRows[0]?.c ?? 0);
      reacceptRequiredCount = Number(reacceptRows[0]?.c ?? 0);
    } catch (e) {
      console.error("[AdminRulesPage] user count failed", e);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="規約管理"
        description="変更があった場合、影響度に応じて「再同意必須」を設定すると、次回投稿時にユーザーに同意導線を表示します。"
        actions={[
          {
            href: "/admin/rules/new",
            label: "新規バージョン",
            icon: <Icon name="plus" size={12} aria-hidden />,
            variant: "primary",
          },
        ]}
      />

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
            major 公開時に再同意必須になるユーザー: 約{" "}
            <strong>{userCount.toLocaleString()}</strong> 件 (全ユーザー)
          </li>
          <li>
            現在の再同意待ち:{" "}
            <strong>{reacceptRequiredCount.toLocaleString()}</strong> 件
          </li>
          {currentPublishedTerms ? (
            <li>
              通知 enqueue:{" "}
              <TermsReacceptBroadcastButton
                termsId={currentPublishedTerms.id}
                versionLabel={currentPublishedTerms.version_label}
                affectedCount={reacceptRequiredCount}
              />
            </li>
          ) : null}
        </ul>
        <p style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
          Discord 通知は notification_outbox に 50 件ずつ段階 enqueue します。
          送信結果は通知管理で確認できます。
        </p>
      </section>

      <FnTable style={{ marginTop: 18 }}>
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
                <div style={{ display: "inline-flex", gap: 4 }}>
                  <Link
                    href={`/admin/rules/${t.id}/edit`}
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                  >
                    編集
                  </Link>
                  <Link
                    href={`/admin/audit?table=terms_versions&record=${encodeURIComponent(t.id)}`}
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    title="この規約バージョンの監査ログ"
                  >
                    監査
                  </Link>
                </div>
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
      </FnTable>
    </div>
  );
}
