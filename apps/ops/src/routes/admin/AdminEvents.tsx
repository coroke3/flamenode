import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AdminEventsResponse } from "@flamenode/contracts";
import { eventDisplayState, eventIndexQuery, formatEventUnix, readAdminEvents } from "../../api/adminEvents.js";
import type { OpsFetch, OpsResult } from "../../api/read.js";

/** MIG-0728 U02: CURRENT /admin/events; no router mount until MIG-0726 owner releases it. */
export function AdminEvents({ fetchFn }: { fetchFn?: OpsFetch }): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const key = eventIndexQuery(params);
  const [result, setResult] = React.useState<OpsResult<AdminEventsResponse> | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    setResult(null); // Do not show stale or cross-account privileged data.
    void readAdminEvents(new URLSearchParams(key), fetchFn, controller.signal).then(next => {
      if (!controller.signal.aborted) setResult(next);
    });
    return () => controller.abort();
  }, [key, fetchFn]);

  function change(form: HTMLFormElement): void {
    const fd = new FormData(form);
    const next = new URLSearchParams();
    for (const field of ["q", "filter", "sort"]) {
      const value = fd.get(field);
      if (typeof value === "string") next.set(field, value);
    }
    setParams(eventIndexQuery(next));
  }
  const current = new URLSearchParams(key);
  return <div className="fn-public-container fn-page">
    <header className="fn-page-head">
      <h1>全イベント管理</h1>
      <p>イベントの作成・公開設定・運営メンバー管理を行います。</p>
      <Link className="fn-btn fn-btn-primary" to="/admin/events/new">新規イベント</Link>
    </header>
    <nav aria-label="イベント管理"><Link to="/admin/event-groups">イベントグループ</Link>{" / "}
      <Link to="/admin/events/templates">テンプレート</Link></nav>
    <form className="fn-form-grid" role="search" onSubmit={e => {
      e.preventDefault();
      change(e.currentTarget);
    }}>
      <label>タイトル / ID で検索
        <input className="fn-input" type="search" name="q" defaultValue={current.get("q") ?? ""} key={"q:" + key} />
      </label>
      <label>公開状態
        <select className="fn-select" name="filter" value={current.get("filter") ?? "all"}
          onChange={e => { e.currentTarget.form?.requestSubmit(); }}>
          <option value="all">全イベント</option>
          <option value="public">public</option>
          <option value="private">private</option>
          <option value="accepting">受付中のみ</option>
        </select>
      </label>
      <label>開催日
        <select className="fn-select" name="sort" value={current.get("sort") ?? "newest"}
          onChange={e => { e.currentTarget.form?.requestSubmit(); }}>
          <option value="newest">開催日 新→旧</option>
          <option value="oldest">開催日 旧→新</option>
          <option value="upcoming">開催日 早い順</option>
        </select>
      </label>
      <button type="submit" className="fn-btn">検索</button>
    </form>
    {result == null && <p role="status">読み込み中...</p>}
    {result != null && result.status !== "ok" && <p role="alert">イベントを取得できませんでした。再ログインまたは再読み込みしてください。</p>}
    {result?.status === "ok" && <>
      <p>{result.data.events.length} 件表示中 (上限 60)</p>
      {result.data.events.length === 0 ?
        <section className="fn-card"><p>まだイベントがありません。</p>
          <Link to="/admin/events/new">新規イベントを作成</Link>{" / "}
          <Link to="/admin/events/templates">テンプレートを見る</Link>
        </section>
        : <table className="fn-table"><thead><tr>
          <th>イベント名</th><th>期間</th><th>状態</th><th>操作</th>
        </tr></thead><tbody>
          {result.data.events.map(ev => {
            const state = eventDisplayState(ev, result.data.now);
            const id = encodeURIComponent(ev.id);
            return <tr key={ev.id}>
              <td><strong>{ev.title}</strong><small className="fn-muted">{ev.id}</small></td>
              <td>{formatEventUnix(ev.start_time, true)}{ev.end_time != null ? " 〜 " + formatEventUnix(ev.end_time, true) : ""}</td>
              <td>{state.label}{state.accepting && <span className="fn-badge fn-badge-soft">受付中</span>}</td>
              <td>
                <Link to={"/manage/events/" + id + "/edit"}>運営設定を開く</Link>{" / "}
                <Link to={"/manage/events/" + id}>運営ビュー</Link>{" / "}
                <Link to={"/manage/events/" + id + "/staff"}>運営権限を編集</Link>{" / "}
                <Link to={"/admin/audit?table=events&record=" + id}>監査</Link>
              </td>
            </tr>;
          })}
        </tbody></table>}
    </>}
  </div>;
}
