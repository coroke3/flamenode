// MIG-0732 U02a: render Hono-authorized X ID merge/revert read views, without any destructive write.
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import type { AdminXIdMergesResponse, AdminXMergeRequestRow } from "@flamenode/contracts";
import { createXIdMergesApi, xMergeReadPath, type XMergeView } from "../../api/xidMerges.js";
import { useApiResult } from "../useApiResult.js";
import { NotFoundView } from "../NotFoundView.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { FnTable } from "../../components/shared/FnTable.js";
import { OpsLink } from "../../components/shared/OpsLink.js";
import { AdminUserManagementTabs } from "../../components/admin/AdminUserManagementTabs.js";

function time(value: number | null): string {
  return value != null && Number.isSafeInteger(value) && value > 0
    ? new Date(value * 1000).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
    : "—";
}
function mergePath(id: string): string {
  return "/admin/x-id-merges?impact=" + encodeURIComponent(id);
}
export function AdminXIdMerges(): React.ReactElement {
  const [params] = useSearchParams();
  const view: XMergeView = params.get("view") === "reverts" ? "reverts" : "requests";
  const impact = view === "requests" ? (params.get("impact") ?? "").trim().slice(0, 128) : "";
  const [refreshKey, setRefreshKey] = React.useState(0);
  const api = React.useMemo(() => createXIdMergesApi((input, init) => fetch(input, init)), []);
  const read = React.useCallback((signal: AbortSignal) => api.get(view, impact, signal), [api, view, impact]);
  const result = useApiResult(read, xMergeReadPath(view, impact), refreshKey);
  React.useEffect(() => {
    if (result.status === "anonymous") window.location.assign("/entry");
    if (result.status === "forbidden") window.location.assign("/dashboard");
  }, [result.status]);
  if (result.status === "loading" || result.status === "anonymous" || result.status === "forbidden") {
    return <p role="status" aria-busy="true">読み込み中...</p>;
  }
  if (result.status === "notFound") return <NotFoundView />;
  if (result.status !== "ok") return <div role="alert"><p>データを取得できませんでした。</p>
    <button type="button" className="fn-btn" onClick={() => setRefreshKey(v => v + 1)}>再読み込み</button>
  </div>;
  return <AdminXIdMergesContent data={result.data} />;
}

export function AdminXIdMergesContent({ data }: { data: AdminXIdMergesResponse }): React.ReactElement {
  const view = data.view;
  const selected = data.requests.find(row => row.id === data.selectedImpactId &&
    (row.status === "pending" || row.status === "approved")) ?? null;
  return <div>
    <ConsolePageHeader title="X ID統合管理"
      description="統合申請の影響確認、承認、実行と、期限内の差し戻しを扱います。復元JSONは画面へ表示しません。" />
    <AdminUserManagementTabs active="merges" />
    <nav aria-label="X ID統合管理ビュー" style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
      <OpsLink href="/admin/x-id-merges" className={"fn-btn fn-btn-sm " + (view === "requests" ? "fn-btn-primary" : "fn-btn-ghost")}>統合申請</OpsLink>
      <OpsLink href="/admin/x-id-merges?view=reverts" className={"fn-btn fn-btn-sm " + (view === "reverts" ? "fn-btn-primary" : "fn-btn-ghost")}>差し戻し申請</OpsLink>
    </nav>
    <p role="status" className="fn-muted fn-text-sm" style={{ marginTop: 12 }}>
      この移行版は閲覧・影響確認のみです。申請作成・承認・却下・実行は管理API移行完了後に有効化します。
    </p>
    {view === "requests" ? <>
      {selected ? <MergeImpactPreview row={selected} /> : null}
      <MergeRequestList data={data} />
    </> : <MergeRevertList data={data} />}
  </div>;
}

function MergeImpactPreview({ row }: { row: AdminXMergeRequestRow }): React.ReactElement {
  const countRows = row.impact.filter(item => item.count > 0);
  const visible = row.preview.slice(0, 50);
  const truncated = row.preview.length > visible.length;
  return <section className="fn-card" aria-label="統合前の確認" style={{ marginTop: 18 }}>
    <div className="fn-card-body">
      <h2>統合前の確認: @{row.source_x_user_id ?? "?"} → @{row.target_x_user_id ?? "?"}</h2>
      <p className="fn-muted fn-text-sm">統合元（実行後に無効化）: {row.source_name ?? "名称未設定"} / 統合先（継続利用）: {row.target_name ?? "名称未設定"}</p>
      <p className="fn-muted fn-text-sm">表示は現在のDBを使った確認用です。実行時に再取得して競合を確認します。</p>
      <ul aria-label="統合対象の件数">
        {countRows.map(item => <li key={item.key}>{item.label}: {item.count.toLocaleString()}件</li>)}
      </ul>
      {visible.length ? <FnTable>
        <thead><tr><th>対象作品（先頭50件）</th><th>統合元の対象</th><th>公開状態</th><th>実行後</th></tr></thead>
        <tbody>{visible.map(item => {
          const changes = [
            item.creator_change ? "投稿者" : "",
            item.member_rows > 0 ? "メンバー " + item.member_rows : "",
            item.chapter_rows > 0 ? "チャプター " + item.chapter_rows : "",
            item.slot_rows > 0 ? "予約枠 " + item.slot_rows : "",
            item.interaction_rows > 0 ? "リアクション " + item.interaction_rows : "",
            item.moderation_rows > 0 ? "審査案件 " + item.moderation_rows : "",
          ].filter(Boolean);
          return <tr key={item.id}>
            <td><OpsLink href={"/admin/videos/" + encodeURIComponent(item.id)}>{item.title || item.id}</OpsLink></td>
            <td>{changes.length ? changes.join(" / ") : "関連参照"}</td>
            <td>{item.visibility_status}</td><td>各対象欄のX IDを統合先へ変更</td>
          </tr>;
        })}</tbody>
      </FnTable> : <p className="fn-muted fn-text-sm">作品への直接参照はありません。</p>}
      {truncated ? <p role="status">作品一覧は先頭50件まで表示しています。</p> : null}
    </div>
  </section>;
}

function MergeRequestList({ data }: { data: AdminXIdMergesResponse }): React.ReactElement {
  return <section style={{ marginTop: 22 }} aria-label="統合申請一覧">
    <FnTable><thead><tr><th>状態</th><th>統合元 → 統合先</th><th>影響範囲</th><th>更新</th><th>監査</th></tr></thead>
      <tbody>{data.requests.map(row => {
        const canPreview = !!row.source_x_user_id && (row.status === "pending" || row.status === "approved");
        return <tr key={row.id}>
          <td><span className="fn-badge">{row.status}</span></td>
          <td><div>@{row.source_x_user_id ?? "?"} → @{row.target_x_user_id ?? "?"}</div>
            <span className="fn-muted fn-text-sm">{row.source_name ?? "?"} → {row.target_name ?? "?"}</span></td>
          <td>{canPreview && row.id !== data.selectedImpactId ?
            <OpsLink href={mergePath(row.id)} className="fn-btn fn-btn-ghost fn-btn-sm">影響範囲を確認</OpsLink> :
            row.impact.length ? row.impact.reduce((sum, item) => sum + item.count, 0).toLocaleString() + " 行" :
            <span className="fn-muted fn-text-sm">完了・却下済み、または未計算</span>}
            {row.status === "done" && row.revert_deadline_at ? <div className="fn-muted fn-text-sm">差し戻し期限: {time(row.revert_deadline_at)}</div> : null}
          </td>
          <td>{time(row.updated_at)}</td>
          <td><OpsLink href={"/admin/audit?table=x_identity_requests&record=" + encodeURIComponent(row.id)} className="fn-btn fn-btn-ghost fn-btn-sm">監査</OpsLink></td>
        </tr>;
      })}
      {!data.requests.length ? <tr><td colSpan={5}>統合申請はありません。</td></tr> : null}
      </tbody>
    </FnTable>
  </section>;
}

function MergeRevertList({ data }: { data: AdminXIdMergesResponse }): React.ReactElement {
  return <section style={{ marginTop: 22 }} aria-label="差し戻し申請一覧">
    <FnTable><thead><tr><th>状態</th><th>親統合申請</th><th>期限</th><th>復元情報</th><th>監査</th></tr></thead>
      <tbody>{data.reverts.map(row =>
        <tr key={row.id}>
          <td><span className="fn-badge">{row.status}</span></td>
          <td className="fn-mono">{row.parent_request_id ?? "—"}</td>
          <td>{time(row.revert_deadline_at)}{row.revert_deadline_at != null && row.revert_deadline_at < data.now ? "（期限切れ）" : ""}</td>
          <td>{row.has_restore_snapshot ? "復元情報あり" : "復元情報なし"}</td>
          <td><OpsLink href={"/admin/audit?table=x_identity_requests&record=" + encodeURIComponent(row.id)} className="fn-btn fn-btn-ghost fn-btn-sm">監査</OpsLink></td>
        </tr>
      )}
      {!data.reverts.length ? <tr><td colSpan={5}>差し戻し申請はありません。</td></tr> : null}
      </tbody>
    </FnTable>
  </section>;
}
