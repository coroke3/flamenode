import * as React from "react";import { FnTable } from "@/components/ui/FnTable";

import type { Metadata } from "next";
import { desc, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { staticRebuildQueue } from "@/lib/db/schema";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { enqueueStaticRebuildAdmin, retryFailedStaticRebuild } from "@/lib/actions/static-rebuild-admin";
import { formatRelative, formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = { title: "静的JSON再生成" };
export const dynamic = "force-dynamic";

export default async function AdminStaticBuildsPage(): Promise<React.ReactElement> {
  const db = getDatabase();
  let rows: (typeof staticRebuildQueue.$inferSelect)[] = [];
  let counts = { pending: 0, processing: 0, failed: 0 };

  if (db) {
    rows = await db
      .select()
      .from(staticRebuildQueue)
      .orderBy(desc(staticRebuildQueue.updated_at))
      .limit(80);

    const countRows = await db
      .select({
        status: staticRebuildQueue.status,
        c: sql<number>`COUNT(*)`,
      })
      .from(staticRebuildQueue)
      .groupBy(staticRebuildQueue.status);

    for (const r of countRows) {
      const n = Number(r.c ?? 0);
      if (r.status === "pending") counts.pending = n;
      if (r.status === "processing") counts.processing = n;
      if (r.status === "failed") counts.failed = n;
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="静的JSON再生成"
        description="R2 公開用 JSON の編集駆動キュー。Next.js 本体のビルドとは別です。"
      />

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <StatCard label="pending" value={counts.pending} />
        <StatCard label="processing" value={counts.processing} />
        <StatCard label="failed" value={counts.failed} />
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
          手動でキュー投入
        </h2>
        <form action={enqueueStaticRebuildAdmin} className="fn-form-grid">
          <label className="fn-label">
            target_type
            <select name="target_type" className="fn-select" defaultValue="event">
              <option value="top">top</option>
              <option value="events_index">events_index</option>
              <option value="event">event</option>
              <option value="video">video</option>
              <option value="user">user</option>
              <option value="list_recent">list_recent</option>
              <option value="list_popular">list_popular</option>
              <option value="search_index">search_index</option>
            </select>
          </label>
          <label className="fn-label">
            target_id
            <input name="target_id" className="fn-input" placeholder="event id / video id / global" />
          </label>
          <label className="fn-label">
            reason
            <input name="reason" className="fn-input" defaultValue="manual_rebuild" />
          </label>
          <button type="submit" className="fn-btn fn-btn-primary">
            高優先度でキュー投入
          </button>
        </form>
        <p className="fn-muted fn-text-sm" style={{ marginTop: 8 }}>
          json-generator ワーカーが cron で pending を処理します。重い処理はここでは実行しません。
        </p>
      </section>

      <FnTable>
        <thead>
          <tr>
            <th>状態</th>
            <th>対象</th>
            <th>理由</th>
            <th>優先度</th>
            <th>試行</th>
            <th>更新</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="fn-muted">
                キューは空です（編集がなければ再生成されません）。
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id}>
                <td>{row.status}</td>
                <td>
                  <code>
                    {row.target_type}:{row.target_id}
                  </code>
                </td>
                <td>{row.reason ?? "—"}</td>
                <td>{row.priority}</td>
                <td>{row.attempt_count}</td>
                <td title={formatUnix(row.updated_at)}>
                  {formatRelative(row.updated_at)}
                </td>
                <td>
                  {row.status === "failed" ? (
                    <form action={retryFailedStaticRebuild}>
                      <input type="hidden" name="queue_id" value={row.id} />
                      <button type="submit" className="fn-btn fn-btn-ghost fn-btn-sm">
                        再試行
                      </button>
                    </form>
                  ) : null}
                  {row.error ? (
                    <p className="fn-muted fn-text-sm" style={{ maxWidth: 240 }}>
                      {row.error}
                    </p>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </FnTable>
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number;
}): React.ReactElement {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <div className="fn-muted fn-text-sm">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div>
    </div>
  );
}
