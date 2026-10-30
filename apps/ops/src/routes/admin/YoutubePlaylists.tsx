import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AdminYoutubePlaylistsResponse } from "@flamenode/contracts";
import { readYoutubePlaylists } from "../../api/adminStaticBuilds.js";
import { AdminVideoManagementTabs } from "../../components/admin/AdminVideoManagementTabs.js";

export function YoutubePlaylists(): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const [data, setData] = React.useState<AdminYoutubePlaylistsResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    setData(null);
    void readYoutubePlaylists(query ? "?" + query : "", undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.status === "ok") { setData(result.data); setError(null); }
      else setError(result.status === "anonymous" ? "再ログインが必要です。" : "再生リストを取得できませんでした。");
    });
    return () => controller.abort();
  }, [query]);
  return <div className="fn-public-container fn-page">
    <header className="fn-page-head"><h1>イベント再生リスト同期</h1></header>
    <AdminVideoManagementTabs />
    <form key={query} onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const next = new URLSearchParams();
      for (const key of ["enabled", "status"]) {
        const value = String(form.get(key) ?? "");
        if (value) next.set(key, value);
      }
      setParams(next);
    }}>
      <label>有効 <select name="enabled" defaultValue={params.get("enabled") ?? ""}>
        <option value="">すべて</option><option value="1">有効</option><option value="0">無効</option>
      </select></label>
      <label>状態 <select name="status" defaultValue={params.get("status") ?? ""}>
        {["", "disabled", "idle", "scanning", "synced", "deferred", "failed"].map(value =>
          <option key={value} value={value}>{value || "すべて"}</option>)}
      </select></label>
      <button type="submit" className="fn-btn fn-btn-primary">絞り込み</button>
      <Link to="/admin/youtube-sync/playlists" className="fn-btn fn-btn-ghost">解除</Link>
    </form>
    {error && <p role="alert">{error}</p>}
    {!data ? <p role="status">読み込み中または取得失敗</p> : <>
      <p role="status">{data.rows.length}件表示中（最大100件）
        {data.hasMore && "。条件に一致する行がさらにあります。"}</p>
      <div style={{ overflowX: "auto" }}><table className="fn-table">
        <thead><tr><th>イベント</th><th>再生リスト</th><th>状態</th><th>健全性</th><th>動画数</th><th>最終同期</th><th>エラー</th></tr></thead>
        <tbody>{data.rows.length === 0 ? <tr><td colSpan={7}>該当する再生リストはありません。</td></tr> :
          data.rows.map(row => <tr key={row.event_id}>
            <td><Link to={"/manage/events/" + encodeURIComponent(row.event_id)}>{row.event_title}</Link></td>
            <td>{row.playlist_id ?? "—"} / {row.enabled ? "有効" : "無効"}</td>
            <td>{row.sync_status} / {row.sync_mode}</td>
            <td>{row.health.level}（{row.health.reason}）</td>
            <td>登録 {row.linked_count} / 対象 {row.eligible_count} / 同期 {row.synced_count}</td>
            <td>{row.last_synced_at == null ? "—" : new Date(row.last_synced_at * 1000).toLocaleString("ja-JP")}</td>
            <td>{row.last_error ?? "—"}</td>
          </tr>)}</tbody>
      </table></div>
    </>}
  </div>;
}
