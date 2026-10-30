import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AdminYoutubeSyncResponse } from "@flamenode/contracts";
import { postAdminOp, readYoutubeSync, youtubeSyncFilterParams } from "../../api/adminStaticBuilds.js";
import { AdminVideoManagementTabs } from "../../components/admin/AdminVideoManagementTabs.js";

const FILTERS = [
  ["sync_status", "同期", ["pending", "synced", "failed"]],
  ["privacy", "公開設定", ["public", "private", "unlisted"]],
  ["availability", "利用可否", ["available", "unavailable", "deleted", "private", "embed_disabled"]],
  ["visibility", "FlameNode公開", ["review", "public", "private", "closed"]],
] as const;
const CHECKS = [["failed", "失敗のみ"], ["stale", "14日以上未同期"], ["missing", "YouTube IDなし"]] as const;
function formatTimestamp(value: number | null): string {
  return value == null ? "—" : new Date(value * 1000).toLocaleString("ja-JP");
}
export function YoutubeSync(): React.ReactElement {
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const [data, setData] = React.useState<AdminYoutubeSyncResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const busyRef = React.useRef(false);
  React.useEffect(() => {
    const controller = new AbortController();
    setData(null);
    void readYoutubeSync(query ? "?" + query : "", undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.status === "ok") { setData(result.data); setError(null); }
      else setError(result.status === "anonymous" ? "再ログインが必要です。" : "同期状態を取得できませんでした。");
    });
    return () => controller.abort();
  }, [query, refresh]);
  async function resync(videoId: string): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyId(videoId);
    try {
      const result = await postAdminOp("youtube-sync/videos/" + encodeURIComponent(videoId) + "/resync", {});
      if (result.status !== "ok") setError(result.status === "anonymous" ? "再ログインが必要です。" : "再同期を予約できませんでした。状態を確認してください。");
      else setRefresh(value => value + 1);
    } finally { busyRef.current = false; setBusyId(null); }
  }
  return <div className="fn-public-container fn-page">
    <header className="fn-page-head"><h1>YouTubeメタデータ同期状態</h1>
      <p>video_youtube_metadataと作品情報を照合し、同期失敗・未同期・YouTube IDなしを確認します。</p></header>
    <AdminVideoManagementTabs />
    <form key={query} method="get" className="fn-console-filter-form fn-console-filter-panel"
      onChange={event => setParams(youtubeSyncFilterParams(new FormData(event.currentTarget)))}
      onSubmit={event => {
        event.preventDefault();
        setParams(youtubeSyncFilterParams(new FormData(event.currentTarget)));
      }}>
      {FILTERS.map(([name, label, options]) =>
        <label key={name} className="fn-console-filter-field">{label}
          <select name={name} defaultValue={params.get(name) ?? ""} className="fn-input">
            <option value="">すべて</option>
            {options.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>)}
      {CHECKS.map(([name, label]) =>
        <label key={name} className="fn-console-filter-check">
          <input type="checkbox" name={name} value="1" defaultChecked={params.get(name) === "1"} />{label}
        </label>)}
      <button type="submit" className="fn-btn fn-btn-primary">絞り込み</button>
      <Link to="/admin/youtube-sync" className="fn-btn fn-btn-ghost">解除</Link>
    </form>
    {error && <p role="alert">{error}</p>}
    {!data ? <p role="status">読み込み中または取得失敗</p> : <>
      <p role="status">{data.rows.length}件表示中（最大100件）
        {data.hasMore && "。条件に一致する行がさらにあります。"}
        {data.truncated && "。応答サイズ上限により一部省略されています。"}
      </p>
      <div style={{ overflowX: "auto" }}><table className="fn-table">
        <thead><tr><th>作品</th><th>YouTube ID</th><th>FlameNode</th><th>YouTube</th><th>再生時間</th><th>再生数</th><th>同期</th><th>日時</th><th>操作</th></tr></thead>
        <tbody>{data.rows.length === 0
          ? <tr><td colSpan={9}>該当する同期状態はありません。</td></tr>
          : data.rows.map(row => <tr key={row.video_id}>
            <td><Link to={"/admin/videos/" + encodeURIComponent(row.video_id)}>{row.title}</Link>
              <small>{row.creator_name ?? "—"}</small></td>
            <td>{row.youtube_video_id || "なし"}</td>
            <td>{row.visibility_status}</td>
            <td>{row.youtube_privacy_status ?? "—"} / {row.youtube_availability_status ?? "—"}</td>
            <td>{row.duration_seconds == null ? "—" : String(row.duration_seconds) + "秒"}</td><td>{row.view_count ?? 0}</td>
            <td>{row.sync_status ?? "metadataなし"}
              {row.sync_error && <details><summary>sync_error</summary><pre>{row.sync_error}</pre></details>}</td>
            <td>{formatTimestamp(row.synced_at)} / {formatTimestamp(row.updated_at)}</td>
            <td><Link to={"/admin/videos/" + encodeURIComponent(row.video_id)} className="fn-btn fn-btn-ghost fn-btn-sm">管理</Link>
              <a href={"/" + encodeURIComponent(row.youtube_video_id?.trim() || row.video_id)} target="_blank" rel="noopener noreferrer" className="fn-btn fn-btn-ghost fn-btn-sm">公開</a>
              <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" disabled={busyId !== null}
                aria-label={row.title + " のYouTubeメタデータ再同期を予約"}
                onClick={() => void resync(row.video_id)}>再同期予約</button></td>
          </tr>)}</tbody>
      </table></div>
    </>}
  </div>;
}
