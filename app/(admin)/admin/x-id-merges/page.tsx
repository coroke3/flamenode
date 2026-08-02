import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { xIdentityRequests, xUsers } from "@/lib/db/schema";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AdminUserManagementTabs } from "@/components/admin/AdminUserManagementTabs";
import { Icon } from "@/components/ui/Icon";
import { FnTable } from "@/components/ui/FnTable";
import {
  approveXIdMergeRequest,
  approveXIdMergeRevert,
  createXIdMergeRequest,
  executeXIdMergeRequest,
  rejectXIdMergeRequest,
  rejectXIdMergeRevert,
} from "@/lib/actions/xid-merge-admin";
import {
  fetchXIdMergeImpact,
  summarizeMergeImpact,
  totalMergeImpact,
  type XIdMergeImpactItem,
} from "@/lib/admin/xIdMergeImpact";
import { formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = { title: "X ID統合管理" };
export const dynamic = "force-dynamic";

async function run(action: (formData: FormData) => Promise<unknown>, formData: FormData): Promise<void> {
  "use server";
  await action(formData);
}

interface Props {
  searchParams?: Promise<{ view?: string }>;
}

type MergeRow = typeof xIdentityRequests.$inferSelect & {
  source_name: string | null;
  target_name: string | null;
  impact: XIdMergeImpactItem[];
};

export default async function AdminXIdMergesPage({ searchParams }: Props): Promise<React.ReactElement> {
  const sp = (await searchParams) ?? {};
  const view = sp.view === "reverts" ? "reverts" : "requests";
  const db = getDatabase();
  let requests: MergeRow[] = [];
  let reverts: Array<typeof xIdentityRequests.$inferSelect> = [];

  if (db) {
    const requestRows = await db
      .select({
        id: xIdentityRequests.id,
        request_type: xIdentityRequests.request_type,
        requested_by_auth_user_id: xIdentityRequests.requested_by_auth_user_id,
        requested_x_id: xIdentityRequests.requested_x_id,
        source_x_user_id: xIdentityRequests.source_x_user_id,
        target_x_user_id: xIdentityRequests.target_x_user_id,
        parent_request_id: xIdentityRequests.parent_request_id,
        restore_snapshot_json: xIdentityRequests.restore_snapshot_json,
        revert_deadline_at: xIdentityRequests.revert_deadline_at,
        status: xIdentityRequests.status,
        decision_reason: xIdentityRequests.decision_reason,
        decided_by_auth_user_id: xIdentityRequests.decided_by_auth_user_id,
        decided_at: xIdentityRequests.decided_at,
        requested_at: xIdentityRequests.requested_at,
        updated_at: xIdentityRequests.updated_at,
        source_name: xUsers.x_name,
      })
      .from(xIdentityRequests)
      .leftJoin(xUsers, eq(xUsers.id, xIdentityRequests.source_x_user_id))
      .where(eq(xIdentityRequests.request_type, "merge"))
      .orderBy(desc(xIdentityRequests.updated_at))
      .limit(50);

    requests = await Promise.all(
      requestRows.map(async (row, index) => ({
        ...row,
        target_name: row.target_x_user_id
          ? (
              await db
                .select({ name: xUsers.x_name })
                .from(xUsers)
                .where(eq(xUsers.id, row.target_x_user_id))
                .limit(1)
            )[0]?.name ?? null
          : null,
        impact:
          index < 20 && row.source_x_user_id && (row.status === "pending" || row.status === "approved")
            ? await fetchXIdMergeImpact(db, row.source_x_user_id)
            : [],
      })),
    );
    reverts = await db
      .select()
      .from(xIdentityRequests)
      .where(eq(xIdentityRequests.request_type, "revert_merge"))
      .orderBy(desc(xIdentityRequests.updated_at))
      .limit(100);
  }

  return (
    <div>
      <AdminPageHeader
        title="X ID統合管理"
        description="統合申請の影響確認、承認、実行と、期限内の差し戻しを扱います。復元JSONは画面へ表示しません。"
      />
      <AdminUserManagementTabs active="merges" />
      <nav aria-label="X ID統合管理ビュー" style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Link href="/admin/x-id-merges" className={`fn-btn fn-btn-sm ${view === "requests" ? "fn-btn-primary" : "fn-btn-ghost"}`}>統合申請</Link>
        <Link href="/admin/x-id-merges?view=reverts" className={`fn-btn fn-btn-sm ${view === "reverts" ? "fn-btn-primary" : "fn-btn-ghost"}`}>差し戻し申請</Link>
      </nav>

      {view === "requests" ? (
        <>
          <section style={{ marginTop: 18, padding: "16px 18px", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)" }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>管理者が統合申請を作成</h2>
            <form action={run.bind(null, createXIdMergeRequest)} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input name="from_x_user_id" className="fn-input fn-input-sm" placeholder="統合元 X ID" required />
              <input name="to_x_user_id" className="fn-input fn-input-sm" placeholder="統合先 X ID" required />
              <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm"><Icon name="plus" size={12} aria-hidden />申請作成</button>
            </form>
          </section>
          <MergeRequestTable rows={requests} />
        </>
      ) : (
        <RevertTable rows={reverts} />
      )}
    </div>
  );
}

function MergeRequestTable({ rows }: { rows: MergeRow[] }): React.ReactElement {
  return (
    <section style={{ marginTop: 22 }}>
      <FnTable>
        <thead><tr><th>状態</th><th>統合元 → 統合先</th><th>影響範囲</th><th>更新</th><th></th></tr></thead>
        <tbody>
          {rows.map((row) => {
            const total = totalMergeImpact(row.impact);
            return (
              <tr key={row.id}>
                <td><span className={`fn-badge ${row.status === "done" ? "fn-badge-accent" : row.status === "approved" ? "fn-badge-warning" : row.status === "rejected" ? "fn-badge-soft" : "fn-badge-danger"}`}>{row.status}</span></td>
                <td>
                  <div>@{row.source_x_user_id ?? "?"} → @{row.target_x_user_id ?? "?"}</div>
                  <div className="fn-muted" style={{ fontSize: 11 }}>{row.source_name ?? "?"} → {row.target_name ?? "?"}</div>
                </td>
                <td>
                  {row.impact.length === 0 ? <span className="fn-muted fn-text-sm">完了・却下済み、または未計算</span> : (
                    <details><summary>{total.toLocaleString()} 行 / {summarizeMergeImpact(row.impact)}</summary>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 12 }}>{row.impact.map((item) => <li key={item.key}><code>{item.key}</code>: {item.count}</li>)}</ul>
                    </details>
                  )}
                  {row.status === "done" && row.revert_deadline_at ? <div className="fn-muted" style={{ fontSize: 11, marginTop: 4 }}>差し戻し期限: {formatUnix(row.revert_deadline_at)}</div> : null}
                </td>
                <td className="fn-muted">{formatUnix(row.updated_at)}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {row.status === "pending" ? (
                      <>
                        <form action={run.bind(null, approveXIdMergeRequest)}><input type="hidden" name="id" value={row.id} /><button className="fn-btn fn-btn-primary fn-btn-sm">承認</button></form>
                        <form action={run.bind(null, rejectXIdMergeRequest)}><input type="hidden" name="id" value={row.id} /><button className="fn-btn fn-btn-ghost fn-btn-sm">却下</button></form>
                      </>
                    ) : null}
                    {row.status === "approved" ? (
                      <form action={run.bind(null, executeXIdMergeRequest)} style={{ display: "flex", gap: 4 }}>
                        <input type="hidden" name="id" value={row.id} />
                        <input name="confirm" className="fn-input fn-input-sm" placeholder="MERGE" required style={{ width: 92 }} />
                        <button className="fn-btn fn-btn-danger fn-btn-sm">実行</button>
                      </form>
                    ) : null}
                    <Link href={`/admin/audit?table=x_identity_requests&record=${encodeURIComponent(row.id)}`} className="fn-btn fn-btn-ghost fn-btn-sm">監査</Link>
                  </div>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? <tr><td colSpan={5} style={{ padding: 18, textAlign: "center" }}><span className="fn-muted fn-text-sm">統合申請はありません。</span></td></tr> : null}
        </tbody>
      </FnTable>
    </section>
  );
}

function RevertTable({ rows }: { rows: Array<typeof xIdentityRequests.$inferSelect> }): React.ReactElement {
  const now = Math.floor(Date.now() / 1000);
  return (
    <section style={{ marginTop: 22 }}>
      <FnTable>
        <thead><tr><th>状態</th><th>親統合申請</th><th>期限</th><th>復元情報</th><th></th></tr></thead>
        <tbody>
          {rows.map((row) => {
            const expired = !row.revert_deadline_at || row.revert_deadline_at < now;
            return (
              <tr key={row.id}>
                <td><span className={`fn-badge ${row.status === "pending" ? "fn-badge-danger" : row.status === "done" ? "fn-badge-accent" : "fn-badge-soft"}`}>{row.status}</span></td>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>{row.parent_request_id ?? "—"}</td>
                <td className="fn-muted">{row.revert_deadline_at ? formatUnix(row.revert_deadline_at) : "—"}{expired ? "（期限切れ）" : ""}</td>
                <td><span className="fn-badge fn-badge-neutral">{row.restore_snapshot_json ? "保存済み" : "なし"}</span></td>
                <td>
                  {row.status === "pending" ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {!expired && row.restore_snapshot_json ? (
                        <form action={run.bind(null, approveXIdMergeRevert)} style={{ display: "flex", gap: 4 }}>
                          <input type="hidden" name="id" value={row.id} />
                          <input name="confirm" className="fn-input fn-input-sm" placeholder="REVERT" required style={{ width: 92 }} />
                          <button className="fn-btn fn-btn-danger fn-btn-sm">差し戻す</button>
                        </form>
                      ) : null}
                      <form action={run.bind(null, rejectXIdMergeRevert)}><input type="hidden" name="id" value={row.id} /><button className="fn-btn fn-btn-ghost fn-btn-sm">却下</button></form>
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? <tr><td colSpan={5} style={{ padding: 18, textAlign: "center" }}><span className="fn-muted fn-text-sm">差し戻し申請はありません。</span></td></tr> : null}
        </tbody>
      </FnTable>
    </section>
  );
}
