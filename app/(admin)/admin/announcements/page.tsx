import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { announcements, users as usersTable, xUsers as xUsersTable } from "@/lib/db/schema";
import { formatUnix } from "@/lib/utils/format";
import { Icon } from "@/components/ui/Icon";
import { AnnouncementBroadcastButton } from "@/components/admin/AnnouncementBroadcastButton";

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

  // 通知対象件数の dry-run (実 enqueue はしない、ただし運用者に規模感を見せる)
  let audienceCounts = { all: 0, creators: 0, admins: 0 };
  if (db) {
    try {
      const [allRows, creatorRows, adminRows] = await Promise.all([
        db.select({ c: sql<number>`COUNT(*)` }).from(usersTable),
        // approved な X ID を持つユーザー (creators 想定)
        db
          .select({ c: sql<number>`COUNT(DISTINCT ${xUsersTable.linked_discord_user_id})` })
          .from(xUsersTable)
          .where(eq(xUsersTable.approval_status, "approved")),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(usersTable)
          .where(eq(usersTable.role, "admin")),
      ]);
      audienceCounts = {
        all: Number(allRows[0]?.c ?? 0),
        creators: Number(creatorRows[0]?.c ?? 0),
        admins: Number(adminRows[0]?.c ?? 0),
      };
    } catch (e) {
      console.error("[AdminAnnouncementsPage] audience count failed", e);
    }
  }
  // 値を使うための副作用呼び出し抑止 (lint 対策)
  void isNotNull;

  return (
    <div>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>お知らせ管理</h1>
        <Link href="/admin/announcements/new" className="fn-btn fn-btn-primary fn-btn-sm">
          <Icon name="plus" size={12} aria-hidden /> 新規お知らせ
        </Link>
      </header>

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
        <select name="audience" className="fn-select" defaultValue={audienceFilter}>
          <option value="any">対象すべて</option>
          <option value="all">all</option>
          <option value="creators">creators</option>
          <option value="admins">admins</option>
        </select>
        <select name="status" className="fn-select" defaultValue={statusFilter}>
          <option value="any">公開状態すべて</option>
          <option value="published">公開のみ</option>
          <option value="draft">下書きのみ</option>
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
          通知対象件数 (dry-run / 実 enqueue はまだ未実装)
        </strong>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
          <li>
            target_audience=<code>all</code>: 約 <strong>{audienceCounts.all.toLocaleString()}</strong> 件
          </li>
          <li>
            target_audience=<code>creators</code>: 約 <strong>{audienceCounts.creators.toLocaleString()}</strong> 件 (approved X ID 持ちの distinct discord_user_id)
          </li>
          <li>
            target_audience=<code>admins</code>: 約 <strong>{audienceCounts.admins.toLocaleString()}</strong> 件
          </li>
        </ul>
        <p style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
          注意: 公開ボタンを押しても現状は notification_outbox に enqueue されません。
          大量 enqueue は Opus 判断候補としてキューイング戦略を確定してから実装します。
        </p>
      </section>

      <table className="fn-table" style={{ marginTop: 18 }}>
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
      </table>
    </div>
  );
}
