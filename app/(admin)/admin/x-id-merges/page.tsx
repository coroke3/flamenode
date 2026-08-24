import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, inArray } from "drizzle-orm";
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
  fetchXIdMergePreview,
  summarizeMergeImpact,
  totalMergeImpact,
  type XIdMergeImpactItem,
  type XIdMergePreviewRow,
} from "@/lib/admin/xIdMergeImpact";
import { formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = { title: "X ID統合管理" };
export const dynamic = "force-dynamic";

async function run(action: (formData: FormData) => Promise<unknown>, formData: FormData): Promise<void> {
  "use server";
  await action(formData);
}

interface Props {
  searchParams?: Promise<{ view?: string; impact?: string }>;
}

type MergeRow = typeof xIdentityRequests.$inferSelect & {
  source_name: string | null;
  target_name: string | null;
  impact: XIdMergeImpactItem[];
  preview: XIdMergePreviewRow[];
};

export default async function AdminXIdMergesPage({ searchParams }: Props): Promise<React.ReactElement> {
  const sp = (await searchParams) ?? {};
  const view = sp.view === "reverts" ? "reverts" : "requests";
  const selectedImpactId = (sp.impact ?? "").trim().slice(0, 128);
  const db = getDatabase();
  let requests: MergeRow[] = [];
  let reverts: Array<typeof xIdentityRequests.$inferSelect> = [];

  if (db && view === "requests") {
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
        slot_bind_status: xIdentityRequests.slot_bind_status,
        slot_bind_attempt_count: xIdentityRequests.slot_bind_attempt_count,
        slot_bind_updated_at: xIdentityRequests.slot_bind_updated_at,
        requested_at: xIdentityRequests.requested_at,
        updated_at: xIdentityRequests.updated_at,
        source_name: xUsers.x_name,
      })
      .from(xIdentityRequests)
      .leftJoin(xUsers, eq(xUsers.id, xIdentityRequests.source_x_user_id))
      .where(eq(xIdentityRequests.request_type, "merge"))
      .orderBy(desc(xIdentityRequests.updated_at))
      .limit(50);

    // 統合先名を申請ごとに再読込すると、最大50件のN+1 D1 queryになる。
    // 一覧に必要なIDだけを1回で取得し、表示順・null扱いは従来の個別lookupと揃える。
    const targetXUserIds = Array.from(
      new Set(
        requestRows
          .map((row) => row.target_x_user_id)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const targetNameRows =
      targetXUserIds.length > 0
        ? await db
            .select({ id: xUsers.id, name: xUsers.x_name })
            .from(xUsers)
            .where(inArray(xUsers.id, targetXUserIds))
        : [];
    const targetNameById = new Map(
      targetNameRows.map((row) => [row.id, row.name] as const),
    );

    // Impact counts are intentionally loaded only after an administrator selects
    // one pending/approved request. The normal list must not scan unrelated
    // impact tables for every visible row.
    const selectedRequest = requestRows.find(
      (row) =>
        row.id === selectedImpactId &&
        Boolean(row.source_x_user_id) &&
        (row.status === "pending" || row.status === "approved"),
    );
    const selectedImpact = selectedRequest?.source_x_user_id
      ? await fetchXIdMergeImpact(db, selectedRequest.source_x_user_id)
      : [];
    const selectedPreview = selectedRequest?.source_x_user_id
      ? await fetchXIdMergePreview(db, selectedRequest.source_x_user_id)
      : [];

    requests = requestRows.map((row) => ({
      ...row,
      target_name: row.target_x_user_id
        ? targetNameById.get(row.target_x_user_id) ?? null
        : null,
      impact: row.id === selectedImpactId ? selectedImpact : [],
      preview: row.id === selectedImpactId ? selectedPreview : [],
    }));
  } else if (db) {
    reverts = await db
      .select()
      .from(xIdentityRequests)
      .where(eq(xIdentityRequests.request_type, "revert_merge"))
      .orderBy(desc(xIdentityRequests.updated_at))
      .limit(100);
  }

  const selectedPreviewRow = requests.find(
    (row) =>
      row.id === selectedImpactId &&
      (row.status === "pending" || row.status === "approved"),
  ) ?? null;

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
          {selectedPreviewRow ? <MergePreviewPanel row={selectedPreviewRow} /> : null}
          <MergeRequestTable rows={requests} selectedImpactId={selectedImpactId} />
        </>
      ) : (
        <RevertTable rows={reverts} />
      )}
    </div>
  );
}

function MergePreviewPanel({ row }: { row: MergeRow }): React.ReactElement {
  const previewLimit = 50;
  const hasMore = row.preview.length > previewLimit;
  const visibleRows = row.preview.slice(0, previewLimit);
  const impactRows = row.impact.filter((item) => item.count > 0);
  return (
    <section className="fn-card" style={{ marginTop: 18 }} aria-labelledby={`merge-preview-${row.id}`}>
      <div className="fn-card-body" style={{ display: "grid", gap: 12 }}>
        <div>
          <h2 id={`merge-preview-${row.id}`} style={{ margin: 0, fontSize: 16 }}>
            統合前の確認: @{row.source_x_user_id ?? "?"} → @{row.target_x_user_id ?? "?"}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, marginTop: 10 }}>
            <div style={{ padding: "9px 10px", border: "1px solid color-mix(in srgb, var(--accent-danger) 38%, var(--border-subtle))", borderRadius: "var(--radius-sm)" }}>
              <strong style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>統合元（実行後は無効化）</strong>
              <span style={{ display: "block", marginTop: 3 }}>@{row.source_x_user_id ?? "?"}</span>
              <span className="fn-muted" style={{ display: "block", marginTop: 2, fontSize: 11 }}>{row.source_name ?? "名称未設定"}</span>
            </div>
            <div style={{ padding: "9px 10px", border: "1px solid color-mix(in srgb, var(--accent-primary) 42%, var(--border-subtle))", borderRadius: "var(--radius-sm)" }}>
              <strong style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>統合先（実行後も利用）</strong>
              <span style={{ display: "block", marginTop: 3 }}>@{row.target_x_user_id ?? "?"}</span>
              <span className="fn-muted" style={{ display: "block", marginTop: 2, fontSize: 11 }}>{row.target_name ?? "名称未設定"}</span>
            </div>
          </div>
          <p className="fn-muted" style={{ margin: "6px 0 0", fontSize: 12, lineHeight: 1.6 }}>
            実行時に統合元の参照を統合先へ付け替え、統合元は通常の選択対象から外れる無効状態にします。
            作品レコードは削除せず、作品投稿者・合作メンバー・チャプター・予約枠・審査案件の参照を更新します。
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
          <span className="fn-badge fn-badge-danger">統合元: 無効化（alias・監査・差し戻し用に内部保持）</span>
          <span className="fn-badge fn-badge-accent">統合先: 継続利用</span>
          <span className="fn-badge fn-badge-neutral">作品一覧: {visibleRows.length}{hasMore ? "+" : ""}件</span>
        </div>
        {impactRows.length > 0 ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12 }} aria-label="統合対象の件数">
            {impactRows.map((item) => (
              <span className="fn-badge fn-badge-neutral" key={item.key}>
                {item.label}: {item.count.toLocaleString()}件
              </span>
            ))}
          </div>
        ) : null}
        {visibleRows.length > 0 ? (
          <div className="fn-table-scroll">
            <table className="fn-table" style={{ minWidth: 680 }}>
              <thead>
                <tr>
                  <th>対象作品（先頭50件）</th>
                  <th>統合元の対象</th>
                  <th>公開状態</th>
                  <th>実行後</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((item) => {
                  const changes = [
                    item.creator_change ? "投稿者" : "",
                    item.member_rows > 0 ? `メンバー ${item.member_rows}` : "",
                    item.chapter_rows > 0 ? `チャプター ${item.chapter_rows}` : "",
                    item.slot_rows > 0 ? `予約枠 ${item.slot_rows}` : "",
                    item.interaction_rows > 0 ? `リアクション ${item.interaction_rows}` : "",
                    item.moderation_rows > 0 ? `審査案件 ${item.moderation_rows}` : "",
                  ].filter(Boolean);
                  return (
                    <tr key={item.id}>
                      <td>
                        <Link href={`/admin/videos/${encodeURIComponent(item.id)}`}>
                          {item.title || item.id}
                        </Link>
                        <div className="fn-muted" style={{ fontSize: 11 }}>{item.id}</div>
                      </td>
                      <td>{changes.length > 0 ? changes.join(" / ") : "関連参照"}</td>
                      <td className="fn-muted">{item.visibility_status}</td>
                      <td>各対象欄のX IDが統合先へ変更</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
            作品への直接参照はありません。認証ユーザー、スタッフ、予約枠、aliasなどの影響は下の件数で確認できます。
          </p>
        )}
        {hasMore ? (
          <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
            作品一覧は先頭50件まで表示しています。実行時は一覧外の対象も同じ原子処理で更新します。
          </p>
        ) : null}
        <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
          表示は現在のDBから取得した確認用です。実行時に再取得し、競合や不整合があれば全体を中止します。
        </p>
      </div>
    </section>
  );
}

function MergeRequestTable({
  rows,
  selectedImpactId,
}: {
  rows: MergeRow[];
  selectedImpactId: string;
}): React.ReactElement {
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
                  {row.impact.length === 0 ? (
                    row.id === selectedImpactId ? (
                      <span className="fn-muted fn-text-sm">完了・却下済み、または未計算</span>
                    ) : row.source_x_user_id &&
                      (row.status === "pending" || row.status === "approved") ? (
                      <Link
                        href={`/admin/x-id-merges?impact=${encodeURIComponent(row.id)}`}
                        className="fn-btn fn-btn-ghost fn-btn-sm"
                      >
                        影響範囲を確認
                      </Link>
                    ) : (
                      <span className="fn-muted fn-text-sm">完了・却下済み、または未計算</span>
                    )
                  ) : (
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
