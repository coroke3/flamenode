import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";

import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { announcements } from "@/lib/db/schema";
import { formatUnix } from "@/lib/utils/format";
import { Icon } from "@/components/ui/Icon";
import { AnnouncementBroadcastButton } from "@/components/admin/AnnouncementBroadcastButton";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AutoSubmitSelect } from "@/components/forms/AutoSubmitSelect";

export const metadata: Metadata = { title: "お知らせ管理" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams?: Promise<{ audience?: string; status?: string }>;
}

export default async function AdminAnnouncementsPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const sp = (await searchParams) ?? {};
  const audienceFilter =
    sp.audience === "all" || sp.audience === "creators" || sp.audience === "admins"
      ? sp.audience
      : "any";
  const statusFilter =
    sp.status === "published" || sp.status === "draft" ? sp.status : "any";

  const db = getDatabase();
  const conds = [
    audienceFilter !== "any"
      ? eq(announcements.target_audience, audienceFilter)
      : undefined,
    statusFilter === "published"
      ? eq(announcements.is_published, 1)
      : statusFilter === "draft"
        ? eq(announcements.is_published, 0)
        : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
  const rows = db
    ? await (where
        ? db
            .select()
            .from(announcements)
            .where(where)
            .orderBy(desc(announcements.created_at))
            .limit(50)
        : db
            .select()
            .from(announcements)
            .orderBy(desc(announcements.created_at))
            .limit(50))
    : [];

  return (
    <div>
      <AdminPageHeader
        title="お知らせ管理"
        description="ユーザー向けお知らせの作成・配信・状態管理を行います。"
        actions={[
          {
            href: "/admin/announcements/new",
            label: "新規お知らせ",
            icon: <Icon name="plus" size={12} aria-hidden />,
            variant: "primary",
          },
        ]}
      />

      <form
        method="get"
        style={{
          marginTop: 14,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <AutoSubmitSelect name="audience" className="fn-select" defaultValue={audienceFilter}>
          <option value="any">対象すべて</option>
          <option value="all">all</option>
          <option value="creators">creators</option>
          <option value="admins">admins</option>
        </AutoSubmitSelect>
        <AutoSubmitSelect name="status" className="fn-select" defaultValue={statusFilter}>
          <option value="any">公開状態すべて</option>
          <option value="published">公開のみ</option>
          <option value="draft">下書きのみ</option>
        </AutoSubmitSelect>
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
          公開側の取得方針
        </strong>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
          <li>公開側は <code>is_published=1</code> かつ掲載期間内の <code>target_audience=all</code> を最大3件だけ取得します。</li>
          <li>Discord 配信は段階 enqueue のみで、1操作あたり最大50件です。</li>
          <li>対象者数の全件 COUNT は無料枠保護のため管理トップでは実行しません。</li>
        </ul>
        <p style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
          公開後の Discord 配信は各行の broadcast ボタンから段階実行します。
          Worker の送信結果は通知管理で確認できます。
        </p>
      </section>

      <FnTable style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>タイトル</th>
            <th>公開状態</th>
            <th>掲載期間</th>
            <th>更新</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>
                <strong>{a.title}</strong>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {a.id.slice(0, 12)}…
                </div>
              </td>
              <td>
                {a.is_published === 1 ? (
                  <span className="fn-badge fn-badge-accent">公開</span>
                ) : (
                  <span className="fn-badge fn-badge-soft">下書き</span>
                )}
              </td>
              <td>
                {a.publish_at ? formatUnix(a.publish_at, { dateOnly: true }) : "—"}
                {" 〜 "}
                {a.expire_at ? formatUnix(a.expire_at, { dateOnly: true }) : "—"}
              </td>
              <td>{formatUnix(a.updated_at)}</td>
              <td>
                <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                  <Link
                    href={`/admin/announcements/${a.id}/edit`}
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                  >
                    編集
                  </Link>
                  {a.is_published === 1 ? (
                    <AnnouncementBroadcastButton
                      announcementId={a.id}
                      defaultContent={`${a.title}\n\n${a.body.slice(0, 800)}`}
                      defaultAudience={
                        (a.target_audience as "all" | "creators" | "admins") ?? "creators"
                      }
                    />
                  ) : null}
                  <Link
                    href={`/admin/audit?table=announcements&record=${encodeURIComponent(a.id)}`}
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    title="このお知らせの監査ログ"
                  >
                    監査
                  </Link>
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <p
                  className="fn-empty-message"
                  style={{ padding: 16, textAlign: "center" }}
                >
                  お知らせはまだありません。
                </p>
              </td>
            </tr>
          ) : null}
        </tbody>
      </FnTable>
    </div>
  );
}
