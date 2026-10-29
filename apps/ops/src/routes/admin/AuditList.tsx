import * as React from "react";
import type { AdminAuditListResponse } from "@flamenode/contracts";
import { createAdminAuditApi, type AuditAuditApi } from "../../api/adminAudit.js";
import type { OpsFetch, OpsResult } from "../../api/read.js";
import { auditViewHref, parseAuditListQuery, type AuditListQuery, type AuditView } from "../../lib/auditListQuery.js";
import { useApiResult, type OpsDataState } from "../useApiResult.js";

type AuditRow = AdminAuditListResponse["rows"][number];
type Operator = AdminAuditListResponse["operators"][number];
const VIEWS: readonly { mode: AuditView; label: string }[] = [
  { mode: "table", label: "テーブル" },
  { mode: "timeline", label: "タイムライン" },
  { mode: "cards", label: "カード" },
];
const TABLES = ["videos","events","users","x_users","slots","video_chapters","video_members",
  "event_staff","x_identity_requests","notification_outbox","system_settings"];
const OPERATIONS = ["CREATE","UPDATE","DELETE","RESTORE","STATUS_CHANGE","MERGE","SYSTEM"];
const STATUSES: readonly [string, string][] = [
  ["restorable","復元可能"],["restored","復元済み"],["expired","期限切れ"],
  ["not_restorable","復元不可"],["blocked","競合"],["failed","失敗"],
];

function dateLabel(seconds: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(seconds * 1000));
}
export function parseChangedKeys(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((key): key is string => typeof key === "string") : [];
  } catch { return []; }
}

/** Unmounted until the shared Ops router owner and MIG-0662 merge gates are satisfied. */
export function AuditList({
  search = typeof window === "undefined" ? "" : window.location.search,
  fetchFn = fetch,
}: { search?: string; fetchFn?: OpsFetch }): React.ReactElement {
  const query = React.useMemo(() => parseAuditListQuery(search), [search]);
  const api = React.useMemo(() => createAdminAuditApi(fetchFn), [fetchFn]);
  const data = useApiResult(
    (signal) => api.list(query, signal),
    JSON.stringify(query),
  );
  return <AuditListContent query={query} state={data} api={api} />;
}

/** Stateless view is exported for parity/SSR tests; access control remains server-side. */
export function AuditListContent({ query, state, api }: {
  query: AuditListQuery; state: OpsDataState<AdminAuditListResponse>; api: AuditAuditApi;
}): React.ReactElement {
  return (
    <section className="fn-public-container fn-page" aria-label="監査ログ">
      <header className="fn-page-head">
        <h1 className="fn-page-title">監査ログ</h1>
        <p>管理操作を新しい順に表示します。before / after の変更キーをサマリで確認できます。</p>
      </header>
      <nav aria-label="監査メニュー" className="fn-panel-actions">
        <a href="/admin/audit" aria-current="page">監査一覧</a>
        <a href="/admin/audit/restore">復元履歴</a>
        <a href="/admin/audit/settings">監査設定</a>
      </nav>
      <AuditFilterForm query={query} />
      {state.status === "loading" ? <p role="status">読み込み中...</p>
        : state.status === "anonymous" ? <p role="alert">セッションが期限切れです。<a href="/entry">ログイン</a></p>
        : state.status === "forbidden" ? <p role="alert">監査ログを閲覧する権限がありません。</p>
        : state.status === "unsupported" ? <p role="alert">監査ログAPIは現在利用できません。</p>
        : state.status === "notFound" ? <p role="alert">監査ログが見つかりません。</p>
        : state.status === "unavailable" ? <p role="alert">監査ログの取得に失敗しました。<a href={auditViewHref(query, query.view)}>再読み込み</a></p>
        : <AuditResults query={query} data={state.data} api={api} />}
    </section>
  );
}
function FilterSelect({ name, value, options }: {
  name: string; value: string; options: readonly [string,string][];
}): React.ReactElement {
  return <label className="fn-audit-filter">
    <span>{name === "restore_status" ? "復元ステータス" : name === "table" ? "テーブル" : "操作種別"}</span>
    <select name={name} defaultValue={value} className="fn-input">
      <option value="">すべて</option>
      {options.map(([option, label]) => <option key={option} value={option}>{label}</option>)}
    </select>
  </label>;
}
function AuditFilterForm({ query }: { query: AuditListQuery }): React.ReactElement {
  return <form method="get" action="/admin/audit" className="fn-panel fn-audit-filters"
    style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
    <FilterSelect name="table" value={query.table} options={TABLES.map(x => [x,x] as [string,string])} />
    <FilterSelect name="operation" value={query.operation} options={OPERATIONS.map(x => [x,x] as [string,string])} />
    <FilterSelect name="restore_status" value={query.restore_status} options={STATUSES} />
    <label>実行者 user_id<input className="fn-input" name="actor" defaultValue={query.actor} placeholder="user_id 完全一致"/></label>
    <label>対象レコード ID<input className="fn-input" name="record" defaultValue={query.record} placeholder="target_id 完全一致"/></label>
    <label>件数 (最大 100)<input className="fn-input" name="limit" type="number" min={1} max={100} defaultValue={query.limit}/></label>
    <label>since (YYYY-MM-DD, JST)<input className="fn-input" name="since" type="date" defaultValue={query.since}/></label>
    <label>until (YYYY-MM-DD, JST)<input className="fn-input" name="until" type="date" defaultValue={query.until}/></label>
    <input type="hidden" name="view" value={query.view}/>
    <button type="submit" className="fn-btn fn-btn-primary">絞り込む</button>
  </form>;
}
function AuditResults({ query, data, api }: {
  query: AuditListQuery; data: AdminAuditListResponse; api: AuditAuditApi;
}): React.ReactElement {
  const operators = new Map(data.operators.map(operator => [operator.id, operator]));
  return <>
    <div className="fn-panel-actions" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span>{data.rows.length} 件表示中 (上限 {data.limit})</span>
      <nav role="tablist" aria-label="表示切替">
        {VIEWS.map(({mode,label}) => <a key={mode} role="tab" aria-selected={query.view === mode}
          className={"fn-btn fn-btn-sm " + (query.view === mode ? "fn-btn-primary" : "fn-btn-ghost")}
          href={auditViewHref(query,mode)}>{label}</a>)}
      </nav>
    </div>
    {data.truncated && <p role="status" className="fn-entry-status fn-entry-status--warn">
      応答サイズの制限により一部の結果を省略しました。検索条件を絞り込んでください。
    </p>}
    {data.rows.length === 0 ? <p className="fn-empty-message">該当する監査ログはありません。</p>
      : query.view === "table" ? <div style={{overflowX: "auto"}}><table className="fn-table">
        <thead><tr><th>日時</th><th>操作</th><th>対象</th><th>実行者</th><th>差分</th><th>詳細</th></tr></thead>
        <tbody>{data.rows.map(row => <tr key={row.id}>
          <td>{dateLabel(row.created_at)}</td><td><OperationLabel operation={row.operation}/></td>
          <td><AuditTarget row={row}/></td><td><ActorLabel row={row} operators={operators}/></td>
          <td><AuditSummary row={row} api={api}/></td>
          <td><a href={"/admin/audit/" + encodeURIComponent(row.id)}>詳細</a></td>
        </tr>)}</tbody></table></div>
        : <div className={query.view === "cards" ? "fn-grid" : "fn-timeline"} role="list">
          {data.rows.map(row => <article key={row.id} className="fn-panel" role="listitem">
            <p><time>{dateLabel(row.created_at)}</time> <OperationLabel operation={row.operation}/></p>
            <p><AuditTarget row={row}/></p>
            <p><ActorLabel row={row} operators={operators}/></p>
            <AuditSummary row={row} api={api}/>
            <p><a href={"/admin/audit/" + encodeURIComponent(row.id)}>詳細を見る</a></p>
          </article>)}
        </div>}
  </>;
}
function OperationLabel({ operation }: {operation: string}): React.ReactElement {
  const tone = operation === "DELETE" ? "danger" : operation === "CREATE" ? "accent" :
    operation === "RESTORE" ? "warning" : "soft";
  return <span className={"fn-badge fn-badge-" + tone}>{operation}</span>;
}
function AuditTarget({ row }: { row: AuditRow }): React.ReactElement {
  const id = encodeURIComponent(row.target_id);
  const href = row.table_name === "videos" ? "/admin/videos/" + id
    : row.table_name === "events" ? "/manage/events/" + id + "/edit"
    : row.table_name === "users" ? "/admin/users/" + id
    : row.table_name === "x_users" ? "/admin/users?view=xid&q=" + id
    : row.table_name === "x_identity_requests" ? "/admin/x-link-requests?record=" + id
    : null;
  return <span><strong>{row.table_name}</strong> <code>{row.target_id}</code> {href && <a href={href}>管理</a>}</span>;
}
function ActorLabel({ row, operators }: { row: AuditRow; operators: Map<string,Operator> }): React.ReactElement {
  const operator = operators.get(row.actor_user_id);
  return <span title={row.actor_user_id}>{operator?.x_name || operator?.name || row.actor_user_id}</span>;
}
function AuditSummary({ row, api }: { row: AuditRow; api: AuditAuditApi }): React.ReactElement {
  const keys = parseChangedKeys(row.changed_keys_json);
  if (row.operation === "CREATE") return <span>新規作成</span>;
  if (row.operation === "DELETE") return <span>削除</span>;
  return <div>{row.operation === "UPDATE" ? keys.length + " キー変更" : row.operation}
    {keys.length > 0 && <code> {keys.slice(0,6).join(", ")}{keys.length>6 ? " ほか " + (keys.length-6) + " 件" : ""}</code>}
    {row.payload.before !== null || row.payload.after !== null
      ? <AuditDiff row={row} api={api} /> : null}
  </div>;
}
export function AuditDiff({ row, api }: { row: AuditRow; api: AuditAuditApi }): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<{status:"loading"} | {status:"unavailable"} |
    {status:"ok"; before: string|null; after: string|null}>({status:"loading"});
  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState({status:"loading"});
    void Promise.all([
      api.payload(row.id,"before",controller.signal),
      api.payload(row.id,"after",controller.signal),
    ]).then(([before,after]) => {
      if (controller.signal.aborted) return;
      if (before.status !== "ok" || after.status !== "ok") setState({status:"unavailable"});
      else setState({status:"ok",before:before.data,after:after.data});
    }).catch(() => {if (!controller.signal.aborted) setState({status:"unavailable"});});
    return () => controller.abort();
  }, [open,row.id,api]);
  return <>
    <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" aria-expanded={open}
      onClick={() => setOpen(value => !value)}>{open ? "閉じる" : "差分"}</button>
    {open && <div className="fn-panel" role="region" aria-label="変更差分">
      {state.status === "loading" ? <p role="status">差分を読み込み中...</p>
        : state.status === "unavailable" ? <p role="alert">差分の取得に失敗しました。</p>
        : <div className="fn-grid">
          <section><h4>変更前</h4><pre style={{whiteSpace:"pre-wrap", overflowWrap:"anywhere"}}>{state.before ?? "(null)"}</pre></section>
          <section><h4>変更後</h4><pre style={{whiteSpace:"pre-wrap", overflowWrap:"anywhere"}}>{state.after ?? "(null)"}</pre></section>
        </div>}
    </div>}
  </>;
}
