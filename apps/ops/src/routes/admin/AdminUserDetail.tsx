import * as React from "react";
import { useParams } from "react-router-dom";
import type {
  AdminUserDetailAuditRow, AdminUserDetailResponse,
} from "@flamenode/contracts";
import { createAdminUsersApi } from "../../api/adminUsers.js";
import { useApiResult } from "../useApiResult.js";
import { NotFoundView } from "../NotFoundView.js";
import { FnTable } from "../../components/shared/FnTable.js";
import { formatAdminUserCreatedRelative } from "./AdminUsers.js";

const api = createAdminUsersApi();

/** CURRENT video timestamps display a JST date only; audit/history dates are relative. */
const videoDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
});
export function formatAdminVideoDate(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const date = new Date(value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? "—" : videoDateFormatter.format(date);
}

/** CURRENT shows the actor on the target timeline, but the record on the operator timeline. */
function AuditRows({ rows, empty, timeline }: {
  rows: AdminUserDetailAuditRow[];
  empty: string;
  timeline: "target" | "operator";
}): React.ReactElement {
  if (rows.length === 0) return <p className="fn-muted">{empty}</p>;
  return <FnTable>
    <thead><tr>
      <th>日時</th><th>テーブル</th><th>操作</th>
      <th>{timeline === "target" ? "実行者" : "レコード"}</th>
    </tr></thead>
    <tbody>{rows.map((a) => <tr key={a.id}>
      <td className="fn-muted fn-td-nowrap">{formatAdminUserCreatedRelative(a.created_at)}</td>
      <td className="fn-td-mono">{a.table_name}</td>
      <td><span className={"fn-badge " + (a.operation === "DELETE"
        ? "fn-badge-danger" : a.operation === "CREATE"
          ? "fn-badge-accent" : "fn-badge-soft")}>{a.operation}</span></td>
      <td className={timeline === "target" ? "fn-td-secondary" : "fn-td-mono fn-td-ellipsis"}>
        {timeline === "target"
          ? (a.actor_user_id ?? "-")
          : a.target_id
            ? <a href={"/admin/audit?record=" + encodeURIComponent(a.target_id)}>{a.target_id}</a>
            : "—"}
      </td>
    </tr>)}</tbody>
  </FnTable>;
}

/** MIG-0731 U02a: read-only CURRENT detail fields, no role/BAN writes. */
export function AdminUserDetailContent({ data }: { data: AdminUserDetailResponse }): React.ReactElement {
  const { user, xIds, recentVideos, linkRequests } = data;
  return <div className="fn-public-container fn-page">
    <header className="fn-page-head">
      <a href="/admin/users">ユーザー管理へ</a>
      <h1 className="fn-page-title">{user.name ?? user.id}</h1>
      <p>ID: {user.id} / {user.email ?? "email 未取得"} / 登録 {formatAdminUserCreatedRelative(user.created_at)}</p>
      {user.emailVerified
        ? <p className="fn-console-note">email認証 {formatAdminUserCreatedRelative(user.emailVerified)}</p>
        : null}
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
        <span className={"fn-badge " + (user.role === "admin" ? "fn-badge-accent"
          : user.role === "moderator" ? "fn-badge-warning" : "fn-badge-soft")}>
          role: {user.role ?? "user"}
        </span>
        <span className={"fn-badge " + (user.is_banned === 1 ? "fn-badge-danger" : "fn-badge-soft")}>
          BAN: {user.is_banned === 1 ? "ON" : "OFF"}
        </span>
        <span className="fn-badge fn-badge-soft">通知: {user.is_notification_enabled === 1 ? "有効" : "停止"}</span>
        <span className={"fn-badge " + (user.can_create_events === 1 ? "fn-badge-accent" : "fn-badge-neutral")}>
          開催権限: {user.can_create_events === 1 ? "ON" : "OFF"}
        </span>
        <span className="fn-badge fn-badge-soft">
          Active X: {user.active_x_user_id ? "@" + user.active_x_user_id : "-"}
        </span>
        <span className={"fn-badge " + (user.emailVerified ? "fn-badge-accent" : "fn-badge-warning")}>
          email 認証: {user.emailVerified ? "済" : "未"}
        </span>
        <span className={"fn-badge " + (user.is_tos_accepted === 1 ? "fn-badge-accent" : "fn-badge-danger")}>
          TOS: {user.is_tos_accepted === 1 ? "同意済" : "未同意"}
        </span>
        {user.terms_reaccept_required === 1 ? <span className="fn-badge fn-badge-warning">再同意要求中</span> : null}
        {user.active_x_user_id ? <>
          <span className="fn-badge fn-badge-soft">Active X ライク: {data.likeCount}</span>
          <span className="fn-badge fn-badge-soft">Active X ブックマーク: {data.bookmarkCount}</span>
        </> : null}
      </div>
    </section>
    <section className="fn-card" style={{ padding: 20, marginTop: 16 }}>
      <h2>連携 X ID ({xIds.length})</h2>
      {xIds.length === 0 ? <p className="fn-muted">未連携です。</p> :
        <div className="fn-console-xid-grid">{xIds.map((x, i) =>
          <section key={x.id + "-user-xid-" + i}
            className={"fn-console-xid-card" + (user.active_x_user_id === x.id
              ? " fn-console-xid-card--active" : "")}>
            <div><strong>{x.x_name}</strong>
              <div className="fn-muted fn-text-sm">@{x.id}</div>
            </div>
            <div className="fn-console-badge-row">
              {user.active_x_user_id === x.id
                ? <span className="fn-badge fn-badge-soft">Active</span> : null}
              {x.approval_status === "approved"
                ? <span className="fn-badge fn-badge-accent">承認</span>
                : x.approval_status === "pending"
                  ? <span className="fn-badge fn-badge-warning">待ち</span>
                  : <span className="fn-badge fn-badge-danger">却下</span>}
            </div>
            <a className="fn-btn fn-btn-ghost fn-btn-sm" href={"/user/" + encodeURIComponent(x.id)}>
              Xプロフィールを確認
            </a>
          </section>)}
        </div>}
    </section>
    <section className="fn-card" style={{ padding: 20, marginTop: 16 }}>
      <h2>投稿作品 ({recentVideos.length})</h2>
      {recentVideos.length === 0 ? <p className="fn-muted">投稿はありません。</p> :
        <ul>{recentVideos.map((v) => <li key={v.id}>
          <a href={"/admin/videos/" + encodeURIComponent(v.id)}>{v.title}</a> / {v.status} / {formatAdminVideoDate(v.created_at)}
        </li>)}</ul>}
    </section>
    <section className="fn-card" style={{ padding: 20, marginTop: 16 }}>
      <h2>X ID 連携申請履歴 ({linkRequests.length})</h2>
      {linkRequests.length === 0 ? <p className="fn-muted">申請はありません。</p> :
        <FnTable>
          <thead><tr><th>申請 X ID</th><th>種別</th><th>target</th><th>状態</th><th>申請日時</th></tr></thead>
          <tbody>{linkRequests.map((r) => <tr key={r.id}>
            <td>{r.requested_x_id ? "@" + r.requested_x_id : "—"}</td>
            <td><span className={"fn-badge " + (r.link_type === "merge"
              ? "fn-badge-danger" : r.link_type === "alias"
                ? "fn-badge-warning" : "fn-badge-soft")}>{r.link_type ?? "new"}</span></td>
            <td className="fn-td-mono">{r.target_x_user_id ?? "—"}</td>
            <td><span className={"fn-badge " + (r.status === "approved"
              ? "fn-badge-accent" : r.status === "rejected"
                ? "fn-badge-danger" : "fn-badge-warning")}>{r.status ?? "pending"}</span></td>
            <td className="fn-muted fn-td-muted">{formatAdminUserCreatedRelative(r.requested_at)}</td>
          </tr>)}</tbody>
        </FnTable>
    </section>
    <section className="fn-card" style={{ padding: 20, marginTop: 16 }}>
      <h2>このユーザーへの管理操作 (target_id 一致)</h2>
      <AuditRows rows={data.recentOnUser} empty="該当する履歴はありません。" timeline="target" />
    </section>
    <section className="fn-card" style={{ padding: 20, marginTop: 16 }}>
      <h2>このユーザーが実行した管理操作 (operator 一致)</h2>
      <AuditRows rows={data.recentByOperator} empty="該当する履歴はありません。" timeline="operator" />
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
