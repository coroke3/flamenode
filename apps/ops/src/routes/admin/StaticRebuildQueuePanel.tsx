import * as React from "react";
import { Link } from "react-router-dom";
import type { AdminStaticBuildsResponse } from "@flamenode/contracts";

/** CURRENT staticRebuildAdminHref; local copy avoids importing the Next runtime. */
export function staticRebuildAdminHref(targetType: string, targetId: string): string | null {
  const id = encodeURIComponent(targetId);
  if (["event", "event_base", "event_slots", "event_release"].includes(targetType)) return "/manage/events/" + id;
  if (targetType === "video") return "/admin/videos/" + id;
  if (targetType === "user") return "/admin/users?q=" + id;
  if (targetType === "events_index") return "/admin/events";
  if (targetType === "users_index") return "/user";
  if (["recommend", "recommend_core"].includes(targetType)) return "/recommend";
  if (["list_recent", "list_popular"].includes(targetType)) return "/admin/videos";
  if (["top", "top_recommended", "top_latest", "top_nostalgic", "top_events", "top_announcements", "top_stats", "top_slot_stats"].includes(targetType)) return "/";
  if (targetType === "rules") return "/rules";
  return null;
}
function CopyField({ value, label }: { value: string; label: string }): React.ReactElement {
  const [message, setMessage] = React.useState("");
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
    <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm"
      aria-label={label + "をコピー"} onClick={() => {
        if (!navigator.clipboard?.writeText) { setMessage("失敗"); return; }
        void navigator.clipboard.writeText(value).then(() => setMessage("コピー済"),
          () => setMessage("失敗"));
      }}>{label}</button>
    {message && <small role="status">{message}</small>}
  </span>;
}
export function StaticRebuildQueuePanel({
  rows, busy, retry, retryAll,
}: {
  rows: AdminStaticBuildsResponse["rows"];
  busy: boolean;
  retry: (queueId: string) => void;
  retryAll: () => void;
}): React.ReactElement {
  const failed = rows.filter(row => row.status === "failed").length;
  return <section aria-label="静的再生成キュー">
    <h2>静的再生成キュー</h2>
    {failed > 0 && <button type="button" className="fn-btn" disabled={busy}
      onClick={retryAll}>失敗 {failed} 件を一括再試行</button>}
    <div style={{ overflowX: "auto" }}>
      <table className="fn-table">
        <thead><tr><th>状態</th><th>種別</th><th>対象ID</th><th>理由</th><th>優先度</th><th>試行</th><th>更新</th><th>操作</th></tr></thead>
        <tbody>{rows.length === 0
          ? <tr><td colSpan={8}>キューは空です（編集がなければ再生成されません）。</td></tr>
          : rows.map(row => <tr key={row.id}>
            <td>{({pending:"待機中",processing:"処理中",done:"完了",failed:"失敗",dead_letter:"最終失敗"} as Record<string,string>)[row.status] ?? row.status}</td><td>{row.target_type}</td><td><code>{row.target_id}</code><div style={{display:"flex", gap:4, flexWrap:"wrap"}}><CopyField value={row.target_type} label="type" /><CopyField value={row.target_id} label="id" /><CopyField value={row.target_type + ":" + row.target_id} label="両方" /></div></td>
            <td>{row.reason ?? "—"}</td><td>{row.priority ?? "—"}</td><td>{row.attempt_count ?? 0}</td>
            <td>{new Date(row.updated_at * 1000).toLocaleString("ja-JP")}</td>
            <td>{row.status === "failed"
              ? <button type="button" disabled={busy} onClick={() => retry(row.id)}
                className="fn-btn fn-btn-ghost fn-btn-sm">再試行</button> : null}
              {staticRebuildAdminHref(row.target_type, row.target_id) && <Link to={staticRebuildAdminHref(row.target_type, row.target_id)!} className="fn-btn fn-btn-ghost fn-btn-sm">関連管理</Link>}
              {row.error && <details><summary>エラー詳細</summary><pre>{row.error}</pre></details>}
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}
