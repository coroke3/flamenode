import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AdminYoutubePlaylistsResponse } from "@flamenode/contracts";
import { readYoutubePlaylists } from "../../api/adminStaticBuilds.js";
import { AdminVideoManagementTabs } from "../../components/admin/AdminVideoManagementTabs.js";

const HEALTH_REASON: Record<string, string> = {
  disabled:"無効", failed:"同期失敗", deferred:"繰り越し", scanning:"同期中",
  overdue:"予定時刻超過", missing_schedule:"次回予定なし", never_synced:"未同期",
  never_full_scan:"全件確認未実行", out_of_sync:"未反映あり",
  last_error:"直近エラーあり", healthy:"正常", unknown_status:"不明な状態",
};
const HEALTH_LEVEL: Record<string,string> = {
  critical:"要対応", warn:"注意", running:"実行中", ok:"正常", unknown:"未確認",
};
function formatTimestamp(value: number | null): string {
  return value == null ? "—" : new Date(value * 1000).toLocaleString("ja-JP");
}
function intervalLabel(minutes: number): string {
  if (minutes % 10080 === 0) return String(minutes / 10080) + "週間";
  if (minutes % 1440 === 0) return String(minutes / 1440) + "日";
  if (minutes % 60 === 0) return String(minutes / 60) + "時間";
  return String(minutes) + "分";
}
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
  const rows = data?.rows ?? [];
  const waiting = rows.reduce((sum, row) => sum + Math.max(0, row.eligible_count - row.synced_count), 0);
  const failed = rows.filter(row => row.sync_status === "failed").length;
  return <div className="fn-public-container fn-page">
    <header className="fn-page-head"><h1>イベント再生リスト同期</h1>
      <p>同期を明示的に設定したイベントのYouTube再生リストへの反映状況です。</p></header>
    <AdminVideoManagementTabs />
    {data && <section className="fn-admin-stat-grid" style={{ display:"flex", gap:16, flexWrap:"wrap", marginBottom:18 }}>
      <div className="fn-card" style={{padding:12}}>設定イベント <strong>{rows.length}</strong></div>
      <div className="fn-card" style={{padding:12}}>同期待ち作品 <strong>{waiting}</strong></div>
      <div className="fn-card" style={{padding:12}}>失敗イベント <strong>{failed}</strong></div>
    </section>}
    <form key={query} method="get" className="fn-console-filter-form fn-console-filter-panel"
      onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const next = new URLSearchParams();
        for (const key of ["enabled", "status"]) {
          const value = String(form.get(key) ?? "");
          if (value) next.set(key, value);
        }
        setParams(next);
      }}>
      <label>有効状態 <select name="enabled" defaultValue={params.get("enabled") ?? ""} className="fn-select">
        <option value="">すべて</option><option value="1">有効のみ</option><option value="0">無効のみ</option>
      </select></label>
      <label>同期状態 <select name="status" defaultValue={params.get("status") ?? ""} className="fn-select">
        {["", "disabled", "idle", "scanning", "synced", "deferred", "failed"].map(value =>
          <option key={value} value={value}>{value || "すべて"}</option>)}
      </select></label>
      <button type="submit" className="fn-btn fn-btn-primary">絞り込む</button>
      <Link to="/admin/youtube-sync/playlists" className="fn-btn fn-btn-ghost">解除</Link>
    </form>
    {error && <p role="alert">{error}</p>}
    {!data ? <p role="status">読み込み中または取得失敗</p> : <>
      <p role="status">{rows.length}件表示中（最大100件）
        {data.hasMore && "。条件に一致する設定がさらにあります。健全性順は表示中の100件内です。"}</p>
      <div style={{ overflowX:"auto" }}><table className="fn-table">
        <thead><tr><th>イベント</th><th>設定</th><th>作品</th><th>同期状態</th><th>日時</th><th>エラー・警告</th><th>操作</th></tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={7}>再生リスト同期が設定されたイベントはありません。</td></tr> :
          rows.map(row => <tr key={row.event_id}>
            <td><Link to={"/manage/events/" + encodeURIComponent(row.event_id)}>{row.event_title}</Link>
              <div className="fn-muted fn-text-xs"><code>{row.event_id}</code></div></td>
            <td>{row.enabled ? "有効" : "無効"} / {row.sync_mode}
              <div>{intervalLabel(row.sync_interval_minutes)}</div></td>
            <td>同期済み {row.synced_count} / 対象 {row.eligible_count}
              {row.eligible_count > row.synced_count && <div>待ち {row.eligible_count - row.synced_count}</div>}
              {row.linked_count > row.eligible_count && <div>公開前・YouTube ID待ち {row.linked_count - row.eligible_count}</div>}</td>
            <td>{HEALTH_LEVEL[row.health.level] ?? "未確認"}
              <div>{HEALTH_REASON[row.health.reason] ?? row.health.reason}</div>
              <code>{row.sync_status}</code></td>
            <td>最終 {formatTimestamp(row.last_synced_at)}
              <div>全件 {formatTimestamp(row.last_full_scan_at)}</div>
              <div>次回 {formatTimestamp(row.next_sync_at)}</div></td>
            <td>{row.last_error ?? "—"}</td>
            <td><Link className="fn-btn fn-btn-ghost fn-btn-sm"
              to={"/manage/events/" + encodeURIComponent(row.event_id) + "/youtube-playlist"}>設定</Link>
              {row.playlist_id && <a className="fn-btn fn-btn-ghost fn-btn-sm"
                href={"https://www.youtube.com/playlist?list=" + encodeURIComponent(row.playlist_id)}
                target="_blank" rel="noopener noreferrer">YouTube</a>}</td>
          </tr>)}</tbody>
      </table></div>
    </>}
  </div>;
}
