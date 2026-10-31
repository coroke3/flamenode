import * as React from "react";
import type { AdminApiEndpointsResponse } from "@flamenode/contracts";
import { useLocation } from "react-router-dom";
import {
  eventExportHref,
  readAdminApiEndpoints,
  type EventExportFormat,
  type EventExportRefresh,
  type EventExportUpdate,
} from "../../api/adminApiEndpoints.js";
import type { OpsFetch } from "../../api/read.js";
import { useApiResult } from "../useApiResult.js";

/** CURRENT: src/components/admin/EventExportLinkBuilder.tsx. */
export function AdminEventExportLinks({ eventId }: { eventId: string }): React.ReactElement {
  const [format, setFormat] = React.useState<EventExportFormat>("v5");
  const [update, setUpdate] = React.useState<EventExportUpdate>("realtime");
  const [refresh, setRefresh] = React.useState<EventExportRefresh>(60);
  const [copyState, setCopyState] = React.useState<"idle" | "done" | "error">("idle");
  const href = eventExportHref(eventId, format, update, refresh);

  async function copyUrl(): Promise<void> {
    try {
      await navigator.clipboard.writeText(new URL(href, window.location.origin).toString());
      setCopyState("done");
    } catch {
      setCopyState("error");
    }
  }
  return (
    <div style={{ display: "grid", gap: 8, minWidth: 260 }}>
      <p className="fn-muted fn-text-sm">新規連携はv5、旧EventArchives系のみ旧形式を選択してください。</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label className="fn-field">
          <span className="fn-label">データ形式</span>
          <select className="fn-select" aria-label={`${eventId}のデータ形式`} value={format}
            onChange={(e) => { setFormat(e.target.value as EventExportFormat); setCopyState("idle"); }}>
            <option value="v5">新形式 v5</option>
            <option value="legacy">旧形式互換</option>
          </select>
        </label>
        <label className="fn-field">
          <span className="fn-label">更新方式</span>
          <select className="fn-select" aria-label={`${eventId}の更新方式`} value={update}
            onChange={(e) => { setUpdate(e.target.value as EventExportUpdate); setCopyState("idle"); }}>
            <option value="realtime">リアルタイム</option>
            <option value="scheduled">節約定期更新</option>
          </select>
        </label>
        {update === "scheduled" ? (
          <label className="fn-field">
            <span className="fn-label">更新間隔</span>
            <select className="fn-select" aria-label={`${eventId}の更新間隔`} value={refresh}
              onChange={(e) => { setRefresh(Number(e.target.value) as EventExportRefresh); setCopyState("idle"); }}>
              <option value={15}>15分</option>
              <option value={60}>1時間</option>
              <option value={360}>6時間</option>
              <option value={1440}>24時間</option>
            </select>
          </label>
        ) : null}
      </div>
      <code style={{ overflowWrap: "anywhere" }}>{href}</code>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="fn-btn fn-btn-sm fn-btn-primary" onClick={() => void copyUrl()}>
          {copyState === "done" ? "コピー済み" : "URLをコピー"}
        </button>
        <a className="fn-btn fn-btn-sm fn-btn-ghost" href={href} target="_blank" rel="noreferrer">出力を確認</a>
      </div>
      {copyState === "error" ? <p role="status">URLのコピーに失敗しました。表示されたURLを手動でコピーしてください。</p> : null}
    </div>
  );
}

function formatUpdatedAt(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds)) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(unixSeconds * 1_000));
}

/** Presentational U01. Unmounted until the MIG-0726 shell and MIG-0642 writes are complete. */
export function AdminApiEndpointsView({
  data,
  notice,
  error,
}: {
  data: AdminApiEndpointsResponse;
  notice?: string;
  error?: string;
}): React.ReactElement {
  return (
    <section aria-label="作品情報出力API" className="fn-page">
      <header className="fn-page-head">
        <h1 className="fn-page-title">作品情報出力API</h1>
        <p className="fn-muted">
          イベント単位で公開作品情報リンクを発行・確認します。新形式v5と旧EventArchives互換に対応しています。
        </p>
      </header>
      {notice ? <p className="fn-alert fn-alert-success" role="status">{notice}</p> : null}
      {error ? <p className="fn-alert fn-alert-danger" role="alert">{error}</p> : null}
      <p role="note" className="fn-muted">
        APIの新規発行・無効化は移行準備中です。現在は設定の確認と公開リンクの取得のみ利用できます。
      </p>

      <section className="fn-panel" aria-label="発行可能イベント">
        <h2>公開イベント（最大100件）</h2>
        <p className="fn-muted">
          {data.eventOptions.length}件のイベントが候補にあります。発行・無効化操作は未接続です。
        </p>
      </section>
      <section className="fn-panel" aria-label="発行済みAPI">
        <h2>発行済みイベントAPI</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="fn-table">
            <thead>
              <tr><th scope="col">状態</th><th scope="col">イベント</th>
                <th scope="col">出力リンク</th><th scope="col">更新日</th></tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td>有効 / {row.event_visibility_status ?? "未設定"}</td>
                  <td>
                    <a href={`/manage/events/${encodeURIComponent(row.event_id)}`}>{row.event_title}</a>
                    <div className="fn-muted fn-text-sm">{row.event_id}</div>
                  </td>
                  <td><AdminEventExportLinks eventId={row.event_id} /></td>
                  <td>{formatUpdatedAt(row.updated_at)}</td>
                </tr>
              ))}
              {data.rows.length === 0 ? (
                <tr><td colSpan={4}>発行済みのイベントAPIはありません。</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      <section className="fn-panel">
        <h2>出力仕様</h2>
        <p className="fn-muted">
          v5は公開情報を構造化し、旧形式は公開データから復元可能な項目のみ返します。
          内部ユーザーID、権限、監査・非公開データは含まれず、作品は最大500件です。
        </p>
      </section>
    </section>
  );
}

/** Read-only route candidate: do not register it in OpsRoutes until MIG-0726 owns routing. */
export function AdminApiEndpointsPage({
  fetchFn = (path, init) => fetch(path, init),
}: { fetchFn?: OpsFetch }): React.ReactElement {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const notice = (params.get("notice") ?? "").slice(0, 200);
  const error = (params.get("error") ?? "").slice(0, 200);
  const result = useApiResult(
    (signal) => readAdminApiEndpoints(fetchFn, signal),
    "admin-api-endpoints",
  );

  if (result.status === "loading") return <p role="status">読み込み中…</p>;
  if (result.status === "anonymous") return <p>ログインが必要です。<a href="/entry">ログイン</a></p>;
  if (result.status === "forbidden") return <p>管理者権限が必要です。<a href="/dashboard">ダッシュボードへ</a></p>;
  if (result.status !== "ok") return <p role="alert">API設定を取得できませんでした。再読み込みしてください。</p>;
  return <AdminApiEndpointsView data={result.data} notice={notice} error={error} />;
}
