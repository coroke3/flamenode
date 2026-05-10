import * as React from "react";
import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { announcements } from "@/lib/db/schema";
import { formatUnix } from "@/lib/utils/format";
import { Icon } from "@/components/ui/Icon";

export const metadata: Metadata = { title: "お知らせ管理" };
export const dynamic = "force-dynamic";

export default async function AdminAnnouncementsPage(): Promise<React.ReactElement> {
  const db = getDatabase();
  const rows = db
    ? await db
        .select()
        .from(announcements)
        .orderBy(desc(announcements.created_at))
        .limit(50)
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
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>お知らせ管理</h1>
        <button type="button" className="fn-btn fn-btn-primary fn-btn-sm">
          <Icon name="plus" size={12} aria-hidden /> 新規お知らせ
        </button>
      </header>

      <table className="fn-table" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>タイトル</th>
            <th>公開状態</th>
            <th>掲載期間</th>
            <th>更新</th>
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
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4}>
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
