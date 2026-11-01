import * as React from "react";
import { useSearchParams } from "react-router-dom";
import type { AdminUserRow, AdminUsersResponse, AdminXUserRow } from "@flamenode/contracts";
import { createAdminUsersApi, normalizeUsersTab, usersPageHref } from "../../api/adminUsers.js";
import { AdminUserManagementTabs } from "../../components/admin/AdminUserManagementTabs.js";
import { useApiResult } from "../useApiResult.js";
import { NotFoundView } from "../NotFoundView.js";
import { GlobalEditableFieldsPanel } from "./GlobalEditableFieldsPanel.js";

const api = createAdminUsersApi();
const statusOptions = [
  ["", "すべて"], ["active", "有効"], ["banned", "BAN"], ["admin", "admin"],
  ["moderator", "moderator"], ["can_create_events", "開催権限あり"],
  ["tos_not_accepted", "TOS未同意"], ["no_active_x", "active Xなし"],
] as const;

function formatCreatedAt(value: number): string {
  const date = new Date(value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("ja-JP");
}
function DiscordRows({ rows }: { rows: AdminUserRow[] }): React.ReactElement {
  return (
    <table className="fn-table" style={{ width: "100%", marginTop: 18 }}>
      <thead><tr><th>Discord</th><th>Active X ID</th><th>ロール</th><th>登録</th><th /></tr></thead>
      <tbody>
        {rows.map((user) => (
          <tr key={user.id}>
            <td>
              <strong>{user.name ?? "—"}</strong>
              <small style={{ display: "block" }}>{user.id.slice(0, 12)}...</small>
            </td>
            <td>{user.active_x_user_id
              ? <><strong>{user.active_x_name ?? "@" + user.active_x_user_id}</strong>
                  <a style={{ display: "block" }} href={"/user/" + encodeURIComponent(user.active_x_user_id)}>
                    {"@" + user.active_x_user_id}
                  </a></>
              : "—"}</td>
            <td>
              {user.is_banned === 1 ? <span className="fn-badge fn-badge-danger">BAN</span>
                : <span className="fn-badge">{(user.role ?? "user").toUpperCase()}</span>}
              {user.can_create_events === 1 ? <span className="fn-badge fn-badge-accent">開催可</span> : null}
            </td>
            <td>{formatCreatedAt(user.created_at)}</td>
            <td>
              <a className="fn-btn fn-btn-ghost fn-btn-sm" href={"/admin/users/" + encodeURIComponent(user.id)}>詳細</a>
              <a className="fn-btn fn-btn-ghost fn-btn-sm" href={"/admin/audit?actor=" + encodeURIComponent(user.id)}>監査</a>
            </td>
          </tr>
        ))}
        {rows.length === 0 ? <tr><td colSpan={5}>対象ユーザーが見つかりません。</td></tr> : null}
      </tbody>
    </table>
  );
}
function XIdRows({ rows }: { rows: AdminXUserRow[] }): React.ReactElement {
  const label = (status: AdminXUserRow["approval_status"]) =>
    status === "approved" ? "承認済み" : status === "rejected" ? "却下"
      : status === "pending" ? "承認待ち" : "未設定";
  return (
    <table className="fn-table" style={{ width: "100%", marginTop: 18 }}>
      <thead><tr><th>X ID</th><th>Discord連携</th><th>状態</th><th /></tr></thead>
      <tbody>
        {rows.map((x) => <tr key={x.id}>
          <td><strong>{x.x_name}</strong><small style={{ display: "block" }}>@{x.id}</small></td>
          <td>{x.primary_auth_user_id
            ? <><strong>{x.primary_auth_user_name ?? "認証ユーザー"}</strong>
                <small style={{ display: "block" }}>{x.primary_auth_user_id.slice(0, 14)}...
                {x.linked_auth_user_count > 1 ? " ほか " + (x.linked_auth_user_count - 1) + "件" : ""}</small></>
            : <span className="fn-badge fn-badge-warning">Discord未連携</span>}</td>
          <td><span className="fn-badge">{label(x.approval_status)}</span>
            {x.active_holder_count > 0 ? <span className="fn-badge fn-badge-soft">active</span> : null}
          </td>
          <td><a className="fn-btn fn-btn-ghost fn-btn-sm"
            href={x.primary_auth_user_id
              ? "/admin/users/" + encodeURIComponent(x.primary_auth_user_id)
              : "/admin/x-link-requests"}>
            {x.primary_auth_user_id ? "詳細" : "申請を見る"}
          </a></td>
        </tr>)}
        {rows.length === 0 ? <tr><td colSpan={4}>対象 X ID が見つかりません。</td></tr> : null}
      </tbody>
    </table>
  );
}
function UserListContent({ data, onSaved }: { data: AdminUsersResponse; onSaved: () => void }): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = normalizeUsersTab(searchParams.get("view"));
  const q = searchParams.get("q") ?? "";
  const status = searchParams.get("status") ?? "";
  const page = data.paging.page;
  const totalPages = Math.max(1, Math.ceil(data.paging.total / data.paging.pageSize));
  function submitFilters(form: HTMLFormElement): void {
    const formData = new FormData(form);
    const params = new URLSearchParams({ view });
    const nextQ = formData.get("q");
    const nextStatus = formData.get("status");
    if (typeof nextQ === "string" && nextQ) params.set("q", nextQ);
    if (view === "discord" && typeof nextStatus === "string" && nextStatus) params.set("status", nextStatus);
    setSearchParams(params);
  }
  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head">
        <h1 className="fn-page-title">{view === "permissions" ? "権限管理" : "ユーザー管理"}</h1>
        <p>{view === "permissions" ? "一般作品でユーザーに開放する編集項目を管理します。" :
          "Discordログイン済みユーザーと X ID の現在の紐付けを確認・管理します。"}</p>
      </header>
      <AdminUserManagementTabs view={view} q={q} status={status} />
      {data.degraded ? <p role="alert">ユーザー情報を取得できませんでした。再度お試しください。</p> : null}
      {view === "permissions" ? <GlobalEditableFieldsPanel settings={data.permissionSettings} onSaved={onSaved} /> : (
        <>
          <form key={searchParams.toString()} action="/admin/users" onSubmit={(event) => {
            event.preventDefault(); submitFilters(event.currentTarget);
          }} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
            <input className="fn-input" type="search" name="q" defaultValue={q}
              placeholder="Discord / X ID / 名前" aria-label="ユーザー検索" />
            {view === "discord" ? (
              <select className="fn-select" name="status" aria-label="状態"
                defaultValue={status} onChange={(event) => {
                  if (event.currentTarget.form) submitFilters(event.currentTarget.form);
                }}>
                {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            ) : null}
            <button className="fn-btn fn-btn-primary" type="submit">検索</button>
            {q || status ? <a className="fn-btn fn-btn-ghost" href={"/admin/users?view=" + view}>解除</a> : null}
          </form>
          {view === "xid" ? <XIdRows rows={data.xUsers} /> : <DiscordRows rows={data.users} />}
          <nav aria-label="ページ切替" style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
            {page > 1 ? <a href={usersPageHref({ view, q, status }, page - 1)}>前へ</a> : null}
            <span>{page} / {totalPages} ページ（{data.paging.total}件）</span>
            {page < totalPages ? <a href={usersPageHref({ view, q, status }, page + 1)}>次へ</a> : null}
          </nav>
        </>
      )}
    </div>
  );
}
/** Guarded by OpsGate AND server-side admin-read auth. Never retain data after 401/403. */
export function AdminUsers(): React.ReactElement {
  const [params] = useSearchParams();
  const [refreshKey, setRefreshKey] = React.useState(0);
  const queryKey = params.toString();
  const query = {
    view: params.get("view"), q: params.get("q"),
    status: params.get("status"), page: params.get("page"),
  };
  const result = useApiResult(
    async (signal) => {
      const response = await api.getUsers(query, signal);
      return response.status === "redirect" ? { status: "notFound" as const } : response;
    },
    "admin-users:" + queryKey, refreshKey,
  );
  React.useEffect(() => {
    if (normalizeUsersTab(params.get("view")) === "links") window.location.assign("/admin/x-link-requests");
    if (result.status === "anonymous") window.location.assign("/entry");
    if (result.status === "forbidden") window.location.assign(result.redirect || "/dashboard");
  }, [result, params]);
  if (result.status === "loading" || normalizeUsersTab(params.get("view")) === "links" ||
      result.status === "anonymous" || result.status === "forbidden") {
    return <div role="status" aria-busy="true">読み込み中...</div>;
  }
  if (result.status === "notFound") return <NotFoundView />;
  if (result.status !== "ok") {
    return <section role="alert">
      <p>ユーザー管理画面を取得できませんでした。</p>
      <button type="button" className="fn-btn" onClick={() => setRefreshKey((x) => x + 1)}>再試行</button>
    </section>;
  }
  return <UserListContent data={result.data} onSaved={() => setRefreshKey((x) => x + 1)} />;
}
