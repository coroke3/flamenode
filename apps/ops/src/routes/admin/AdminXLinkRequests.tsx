import * as React from "react";
import type { AdminXLinkRequestsResponse } from "@flamenode/contracts";
import { createXidLinkRequestsApi } from "../../api/xidLinkRequests.js";
import { useApiResult } from "../useApiResult.js";
import { NotFoundView } from "../NotFoundView.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { FnTable } from "../../components/shared/FnTable.js";
import { OpsLink } from "../../components/shared/OpsLink.js";
import { AdminUserManagementTabs } from "../../components/admin/AdminUserManagementTabs.js";
import { XLinkRequestTable, formatRequestTime } from "../../components/xid/XLinkRequestTable.js";

const READ_PATH = "/api/admin-read/x-link-requests";
function requestTypeLabel(type: string): string {
  if (type === "new_link" || type === "existing_link") return "X ID連携";
  if (type === "alias") return "旧別名申請";
  return type;
}

export function AdminXLinkRequests(): React.ReactElement {
  const api = React.useMemo(() => createXidLinkRequestsApi((input, init) => fetch(input, init)), []);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const read = React.useCallback((signal: AbortSignal) => api.get(signal), [api]);
  const result = useApiResult(read, READ_PATH, refreshKey);
  React.useEffect(() => {
    if (result.status === "anonymous") window.location.assign("/entry");
    if (result.status === "forbidden") window.location.assign("/dashboard");
  }, [result.status]);
  if (result.status === "loading" || result.status === "anonymous" || result.status === "forbidden") {
    return <p role="status" aria-busy="true">読み込み中...</p>;
  }
  if (result.status === "notFound") return <NotFoundView />;
  if (result.status !== "ok") return <div role="alert">
    <p>データを取得できませんでした。</p>
    <button type="button" className="fn-btn" onClick={() => setRefreshKey(n => n + 1)}>再読み込み</button>
  </div>;
  const data: AdminXLinkRequestsResponse = result.data;
  return <div>
    <ConsolePageHeader title="X ID 申請"
      description="X ID連携申請を確認します。統合と差し戻しはX ID統合管理で処理します。" />
    <AdminUserManagementTabs active="link-requests" />
    <nav aria-label="X ID申請管理" style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
      <OpsLink href="/admin/x-id-merges" className="fn-btn fn-btn-sm fn-btn-ghost">統合・差し戻し</OpsLink>
    </nav>
    <XLinkRequestTable rows={data.pending} api={api} onChanged={() => setRefreshKey(n => n + 1)} />
    {data.recentRejected.length > 0 ? <section style={{ marginTop: 28 }}>
      <h2>直近の却下申請</h2>
      <FnTable><thead><tr><th>申請 X ID</th><th>種別</th><th>申請者ユーザー ID</th><th>申請日時</th></tr></thead>
        <tbody>{data.recentRejected.map(row => <tr key={row.id}>
          <td>@{row.requested_x_id ?? "—"}</td>
          <td><span className="fn-badge fn-badge-soft">{requestTypeLabel(row.request_type)}</span></td>
          <td className="fn-mono">{row.requested_by_auth_user_id}</td>
          <td className="fn-muted">{formatRequestTime(row.requested_at)}</td>
        </tr>)}</tbody></FnTable>
    </section> : null}
    <section style={{ marginTop: 28 }}>
      <h2>直近の処理履歴</h2>
      <p className="fn-muted fn-text-sm">
        詳細は <OpsLink href="/admin/audit?table=x_identity_requests">監査ログ</OpsLink> で確認できます。
      </p>
      {data.recentAudit.length > 0 ? <FnTable>
        <thead><tr><th>日時</th><th>テーブル</th><th>操作</th><th>対象 ID</th><th>差分</th></tr></thead>
        <tbody>{data.recentAudit.map(log => <tr key={log.id}>
          <td>{formatRequestTime(log.created_at)}</td>
          <td className="fn-mono">{log.table_name}</td>
          <td>{log.operation}</td>
          <td className="fn-mono">{log.target_id ?? "—"}</td>
          <td>{log.changedKeys.slice(0, 6).join(", ")}</td>
        </tr>)}</tbody>
      </FnTable> : <p className="fn-muted fn-text-sm">履歴はまだありません。</p>}
    </section>
  </div>;
}
