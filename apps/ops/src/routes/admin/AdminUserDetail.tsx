import * as React from "react";
import { useParams } from "react-router-dom";
import type {
  AdminUserDetailAuditRow, AdminUserDetailResponse,
} from "@flamenode/contracts";
import { createAdminUsersApi } from "../../api/adminUsers.js";
import { useApiResult } from "../useApiResult.js";
import { NotFoundView } from "../NotFoundView.js";

const api = createAdminUsersApi();

function dateText(value: number | null): string {
  if (value === null) return "—";
  const date = new Date(value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ja-JP");
}

function AuditRows({ rows, empty }: { rows: AdminUserDetailAuditRow[]; empty: string }): React.ReactElement {
  if (rows.length === 0) return <p className="fn-muted">{empty}</p>;
  return <div style={{ overflowX: "auto" }}><table className="fn-table" style={{ width: "100%" }}>
    <thead><tr><th>日時</th><th>テーブル</th><th>操作</th><th>実行者</th><th>対象</th></tr></thead>
    <tbody>{rows.map((a) => <tr key={a.id}>
      <td>{dateText(a.created_at)}</td>
      <td>{a.table_name}</td>
      <td>{a.operation}</td>
      <td>{a.actor_user_id ?? "—"}</td>
      <td>{a.target_id ?? "—"}</td>
    </tr>)}</tbody>
  </table></div>;
}

/** MIG-0731 U02a: read-only CURRENT detail fields, no role/BAN writes. */
export function AdminUserDetailContent({ data }: { data: AdminUserDetailResponse }): React.ReactElement {
  const { user, xIds, recentVideos, linkRequests } = data;
  return <div className="fn-public-container fn-page">
    <header className="fn-page-head">
      <a href="/admin/users">ユーザー管理へ</a>
      <h1 className="fn-page-title">{user.name ?? user.id}</h1>
      <p>ID: {user.id} / {user.email ?? "email 未取得"} / 登録 {dateText(user.created_at)}</p>
      <nav aria-label="ユーザー管理">
        <span aria-current="page">詳細</span>
        <a style={{ marginLeft: 16 }} href={"/admin/users/" + encodeURIComponent(user.id) + "/edit"}>編集</a>
      </nav>
    </header>
    <section className="fn-card" style={{ padding: 20, marginTop: 16 }}>
      <h2>IDの主体整理</h2>
      <dl>
        <dt>Discord / Auth 主体</dt><dd>{user.discord_id ?? user.id}</dd>
        <dt>Active X ID</dt><dd>{user.active_x_user_id ? "@" + user.active_x_user_id : "未設定"}</dd>
        <dt>紐づく X ID</dt><dd>{xIds.length} 件</dd>
      </dl>
    </section>
    <section className="fn-card" style={{ padding: 20, marginTop: 16 }}>
      <h2>権限と状態</h2>
      <div className="fn-console-badge-row">
        <span className="fn-badge">role: {user.role ?? "user"}</span>
        <span className="fn-badge">BAN: {user.is_banned === 1 ? "ON" : "OFF"}</span>
        <span className="fn-badge">通知: {user.is_notification_enabled === 1 ? "有効" : "停止"}</span>
        <span className="fn-badge">開催権限: {user.can_create_events === 1 ? "ON" : "OFF"}</span>
        <span className="fn-badge">email認証: {user.emailVerified ? "済" : "未"}</span>
        <span className="fn-badge">TOS: {user.is_tos_accepted === 1 ? "同意済" : "未同意"}</span>
        {user.terms_reaccept_required === 1 ? <span className="fn-badge fn-badge-warning">再同意要求中</span> : null}
        <span className="fn-badge">Active X ライク: {data.likeCount}</span>
        <span className="fn-badge">Active X ブックマーク: {data.bookmarkCount}</span>
      </div>
    </section>
    <section className="fn-card" style={{ padding: 20, marginTop: 16 }}>
      <h2>連携 X ID ({xIds.length})</h2>
      {xIds.length === 0 ? <p className="fn-muted">未連携です。</p> :
        <ul>{xIds.map((x, i) => <li key={x.id + ":" + i}>
          <strong>{x.x_name}</strong> @{x.id}
          {user.active_x_user_id === x.id ? " / Active" : ""}
          {" / " + (x.approval_status ?? "未設定")}
          {" "}
          <a href={"/user/" + encodeURIComponent(x.id)}>Xプロフィールを確認</a>
        </li>)}</ul>}
    </section>
    <section className="fn-card" style={{ padding: 20, marginTop: 16 }}>
      <h2>投稿作品 ({recentVideos.length})</h2>
      {recentVideos.length === 0 ? <p className="fn-muted">投稿はありません。</p> :
        <ul>{recentVideos.map((v) => <li key={v.id}>
          {v.title} / {v.status} / {dateText(v.created_at)}
        </li>)}</ul>}
    </section>
    <section className="fn-card" style={{ padding: 20, marginTop: 16 }}>
      <h2>X ID 連携申請履歴 ({linkRequests.length})</h2>
      {linkRequests.length === 0 ? <p className="fn-muted">申請はありません。</p> :
        <div style={{ overflowX: "auto" }}><table className="fn-table">
          <thead><tr><th>申請 X ID</th><th>種別</th><th>target</th><th>状態</th><th>申請日時</th></tr></thead>
          <tbody>{linkRequests.map((r) => <tr key={r.id}>
            <td>{r.requested_x_id ? "@" + r.requested_x_id : "—"}</td>
            <td>{r.link_type ?? "new"}</td><td>{r.target_x_user_id ?? "—"}</td>
            <td>{r.status ?? "pending"}</td><td>{dateText(r.requested_at)}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
    <section className="fn-card" style={{ padding: 20, marginTop: 16 }}>
      <h2>このユーザーへの管理操作 (target_id 一致)</h2>
      <AuditRows rows={data.recentOnUser} empty="該当する履歴はありません。" />
    </section>
    <section className="fn-card" style={{ padding: 20, marginTop: 16 }}>
      <h2>このユーザーが実行した管理操作 (operator 一致)</h2>
      <AuditRows rows={data.recentByOperator} empty="該当する履歴はありません。" />
    </section>
  </div>;
}

/** OpsGate and the Hono /api/admin-read session+admin gate must both authorize. */
export function AdminUserDetail(): React.ReactElement {
  const { id } = useParams<"id">();
  const [refreshKey, setRefreshKey] = React.useState(0);
  const result = useApiResult((signal) => api.getUserDetail(id ?? "", signal),
    "admin-user-detail:" + (id ?? ""), refreshKey);
  React.useEffect(() => {
    if (result.status === "anonymous") window.location.assign("/entry");
    if (result.status === "forbidden") window.location.assign(result.redirect || "/dashboard");
  }, [result]);
  if (!id || result.status === "notFound") return <NotFoundView />;
  if (result.status === "loading" || result.status === "anonymous" || result.status === "forbidden") {
    return <div role="status" aria-busy="true">読み込み中...</div>;
  }
  if (result.status !== "ok") {
    return <section role="alert">
      <p>ユーザー詳細を取得できませんでした。</p>
      <button type="button" className="fn-btn" onClick={() => setRefreshKey((value) => value + 1)}>再試行</button>
    </section>;
  }
  return <AdminUserDetailContent data={result.data} />;
}
