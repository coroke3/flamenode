import * as React from "react";
import { useLocation } from "react-router-dom";
import type { AdminVideoRow } from "@flamenode/contracts";
import type { OpsFetch } from "../../api/read.js";
import {
  adminVideoTotalPages,
  adminVideoPageNumbers,
  buildAdminVideoHref,
  loadAdminVideos,
  parseAdminVideoFilters,
} from "../../api/adminVideos.js";
import { useApiResult } from "../useApiResult.js";

const browserFetch: OpsFetch = (path, init) => fetch(path, init);
const VIDEO_GROUPS = [
  { status: "", label: "すべて" },
  { status: "review", label: "審査待ち" },
  { status: "public", label: "公開" },
  { status: "private", label: "非公開" },
  { status: "closed", label: "終了" },
] as const;
const VISIBILITY_LABELS: Record<string, string> = {
  pending: "審査待ち",
  public: "公開",
  private: "非公開",
  voided: "無効",
};
function visibilityLabel(status: string): string {
  return Object.hasOwn(VISIBILITY_LABELS, status) ? VISIBILITY_LABELS[status]! : status;
}
function detailHref(videoId: string, event: string): string {
  const path = `/admin/videos/${encodeURIComponent(videoId)}`;
  return event ? `${path}?event=${encodeURIComponent(event)}` : path;
}
/** CURRENT src/lib/utils/format.ts#formatRelative, unix seconds. */
function createdLabel(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const diff = Date.now() / 1000 - timestamp;
  if (diff < 60) return "今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}日前`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}か月前`;
  return `${Math.floor(diff / 31536000)}年前`;
}

function VideoRow({ video, event, isReview }: {
  video: AdminVideoRow;
  event: string;
  isReview: boolean;
}): React.ReactElement {
  const thumbnailId = video.youtube_video_id?.trim();
  const thumbnail = thumbnailId && /^[a-zA-Z0-9_-]{11}$/.test(thumbnailId)
    ? `https://i.ytimg.com/vi/${thumbnailId}/default.jpg` : null;
  return (
    <tr>
      <td>
        {thumbnail ? <img src={thumbnail} width={96} height={54} alt="" loading="lazy" /> : "—"}
      </td>
      <td>
        <strong>{video.title}</strong>
        <div className="fn-text-muted-sm">{video.display_name ?? "—"}</div>
        {isReview ? (
          <div className="fn-text-muted-sm">
            {video.review?.stage_permission_summary ?? "—"} · 未回答 {video.review?.required_unanswered_count ?? 0}
          </div>
        ) : null}
      </td>
      <td>{visibilityLabel(video.status)}</td>
      <td>{createdLabel(video.created_at)}</td>
      <td>
        <a className="fn-btn fn-btn-ghost fn-btn-sm" href={detailHref(video.id, event)}>詳細</a>{" "}
        <a className="fn-btn fn-btn-ghost fn-btn-sm" href={`/admin/videos/${encodeURIComponent(video.id)}/members`}>参加者</a>{" "}
        <a className="fn-btn fn-btn-ghost fn-btn-sm" href={`/admin/audit?table=videos&record=${encodeURIComponent(video.id)}`}>監査</a>
      </td>
    </tr>
  );
}

/**
 * MIG-0729 U01 (unmounted until MIG-0726): GET-only admin video list.
 * U02 adds the CURRENT review/approve actions after the shared video review owner releases them.
 * The outer OpsGate provides navigation; each private read still fails closed independently.
 */
export function AdminVideos({ fetchFn = browserFetch }: { fetchFn?: OpsFetch }): React.ReactElement {
  const location = useLocation();
  const filters = React.useMemo(() => parseAdminVideoFilters(location.search), [location.search]);
  const load = React.useCallback(
    (signal: AbortSignal) => loadAdminVideos(fetchFn, location.search, signal),
    [fetchFn, location.search],
  );
  const result = useApiResult(load, location.search);

  if (result.status === "loading") {
    return <section aria-busy="true" role="status">作品を読み込み中...</section>;
  }
  if (result.status !== "ok") {
    return (
      <section role="alert">
        <h1>作品管理</h1>
        <p>{result.status === "anonymous" ? "ログインが必要です。"
          : result.status === "forbidden" ? "この画面を表示する権限がありません。"
          : result.status === "notFound" ? "作品一覧が見つかりません。"
          : "作品一覧を取得できませんでした。再読み込みしてください。"}</p>
      </section>
    );
  }

  const { videos, paging, events } = result.data;
  const { q, status, event } = result.data;
  const totalPages = adminVideoTotalPages(paging);
  const isReview = status === "review" || status === "pending";
  const activeGroup = status === "pending" ? "review" : status === "voided" ? "closed" : status;

  return (
    <section className="fn-public-container fn-page" aria-label="作品管理">
      <header className="fn-page-head">
        <h1>作品管理</h1>
        <p>作品の状態確認、監査ログ、参加者設定を行います。</p>
      </header>
      <nav aria-label="作品管理メニュー" className="fn-panel-actions">
        {VIDEO_GROUPS.map(({ status: tabStatus, label }) => (
          <a key={tabStatus} href={buildAdminVideoHref({ q, status: tabStatus, event })}
            aria-current={tabStatus === activeGroup ? "page" : undefined}>
            {label}
          </a>
        ))}
        <a href="/admin/youtube-sync">メタデータ同期</a>
        <a href="/admin/youtube-sync/playlists">再生リスト同期</a>
      </nav>
      <form method="get" action="/admin/videos" className="fn-console-filter-form" role="search">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <input name="q" type="search" className="fn-input" aria-label="作品を検索"
          defaultValue={filters.q} key={`q:${filters.q}`} placeholder="タイトル / 作者 / X ID" />
        <select className="fn-select" name="event" aria-label="イベント"
          key={`event:${event}`} defaultValue={event}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}>
          <option value="">すべてのイベント</option>
          {events.map((ev) => <option value={ev.id} key={ev.id}>{ev.title}</option>)}
          {event && !events.some((ev) => ev.id === event) ? <option value={event}>{event}</option> : null}
        </select>
        <button type="submit" className="fn-btn">検索</button>
        {(q || status || event) ? <a className="fn-btn fn-btn-ghost" href="/admin/videos">解除</a> : null}
      </form>
      <table className="fn-table" style={{ marginTop: 18 }}>
        <thead><tr>
          <th>サムネイル</th><th>作品</th><th>状態</th><th>登録</th><th>操作</th>
        </tr></thead>
        <tbody>
          {videos.map((video) => <VideoRow key={video.id} video={video} event={event} isReview={isReview} />)}
          {videos.length === 0 ? <tr><td colSpan={5}>条件に合う作品がありません。</td></tr> : null}
        </tbody>
      </table>
      {totalPages > 1 ? (
        <nav aria-label="ページ送り" className="fn-panel-actions" style={{ flexWrap: "wrap" }}>
          <span>
            {(paging.page - 1) * paging.pageSize + 1}〜{Math.min(paging.page * paging.pageSize, paging.total)}
            {" / 全 "}{paging.total} 件 ({paging.page} / {totalPages} ページ)
          </span>
          {paging.page > 1 ? (
            <a className="fn-btn fn-btn-ghost fn-btn-sm" aria-label="前のページ"
              href={buildAdminVideoHref({ q, status, event }, paging.page - 1)}>前へ</a>
          ) : <span aria-disabled="true">前へ</span>}
          {adminVideoPageNumbers(paging.page, totalPages).map((page, index) =>
            page === "…" ? <span key={`gap-${index}`}>…</span> : (
              <a key={page} className={page === paging.page ? "fn-btn fn-btn-primary fn-btn-sm" : "fn-btn fn-btn-ghost fn-btn-sm"}
                aria-current={page === paging.page ? "page" : undefined}
                href={buildAdminVideoHref({ q, status, event }, page)}>{page}</a>
            ),
          )}
          {paging.page < totalPages ? (
            <a className="fn-btn fn-btn-ghost fn-btn-sm" aria-label="次のページ"
              href={buildAdminVideoHref({ q, status, event }, paging.page + 1)}>次へ</a>
          ) : <span aria-disabled="true">次へ</span>}
        </nav>
      ) : null}
    </section>
  );
}
