import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { AdminVideoRow } from "@flamenode/contracts";
import type { OpsFetch } from "../../api/read.js";
import {
  adminVideoTotalPages,
  adminVideoPageNumbers,
  adminVideoRelativeLabel,
  buildAdminVideoHref,
  adminVideoFilterHref,
  loadAdminVideos,
  parseAdminVideoFilters,
} from "../../api/adminVideos.js";
import { useApiResult } from "../useApiResult.js";
import { AdminResourceTabs } from "../../components/shared/AdminResourceTabs.js";
import { OpsLink } from "../../components/shared/OpsLink.js";

const browserFetch: OpsFetch = (path, init) => fetch(path, init);
const VIDEO_GROUPS = [
  { status: "", label: "すべて", icon: "list" },
  { status: "review", label: "審査待ち", icon: "check" },
  { status: "public", label: "公開", icon: "external" },
  { status: "private", label: "非公開", icon: "pause" },
  { status: "closed", label: "無効", icon: "warning" },
] as const;
const VISIBILITY_LABELS: Record<string, string> = {
  pending: "審査待ち",
  public: "公開",
  private: "非公開",
  voided: "無効化",
};
function visibilityLabel(status: string): string {
  return Object.hasOwn(VISIBILITY_LABELS, status) ? VISIBILITY_LABELS[status]! : status;
}
function detailHref(videoId: string, event: string): string {
  const path = `/admin/videos/${encodeURIComponent(videoId)}`;
  return event ? `${path}?event=${encodeURIComponent(event)}` : path;
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
      <td>{adminVideoRelativeLabel(video.created_at)}</td>
      <td>
        <OpsLink className="fn-btn fn-btn-ghost fn-btn-sm" href={detailHref(video.id, event)}>詳細</OpsLink>{" "}
        <OpsLink className="fn-btn fn-btn-ghost fn-btn-sm" href={`/admin/videos/${encodeURIComponent(video.id)}/members`}>参加者</OpsLink>{" "}
        <OpsLink className="fn-btn fn-btn-ghost fn-btn-sm" href={`/admin/audit?table=videos&record=${encodeURIComponent(video.id)}`}>監査</OpsLink>
      </td>
    </tr>
  );
}

/** CURRENT AdminVideoManagementTabs: group icons, active status and URL-safe filters. */
export function AdminVideoManagementTabs({ q = "", status = "", event = "" }: {
  q?: string;
  status?: string;
  event?: string;
}): React.ReactElement {
  const active = status === "pending" ? "review"
    : status === "voided" ? "closed" : status || "all";
  const tabs = [
    ...VIDEO_GROUPS.map(group => ({
      key: group.status || "all",
      href: buildAdminVideoHref({ q, status: group.status, event }),
      label: group.label,
      icon: group.icon,
    })),
    { key: "youtube-sync", href: "/admin/youtube-sync", label: "メタデータ同期", icon: "refresh" as const },
    { key: "youtube-playlists", href: "/admin/youtube-sync/playlists", label: "再生リスト同期", icon: "list" as const },
  ];
  return <AdminResourceTabs tabs={tabs} active={active} ariaLabel="作品管理メニュー" />;
}

/**
 * MIG-0729 U01 (unmounted until MIG-0726): GET-only admin video list.
 * U02 adds the CURRENT review/approve actions after the shared video review owner releases them.
 * The outer OpsGate provides navigation; each private read still fails closed independently.
 */
export function AdminVideos({ fetchFn = browserFetch }: { fetchFn?: OpsFetch }): React.ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const submitFilters = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    // Keep the Ops SPA mounted. A normal document GET can fall through to the
    // legacy Next ingress before the migration route cutover.
    void navigate(adminVideoFilterHref(new FormData(event.currentTarget)));
  };
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

  return (
    <section className="fn-public-container fn-page" aria-label="作品管理">
      <header className="fn-page-head">
        <h1>作品管理</h1>
        <p>作品の状態確認、監査ログ、参加者設定を行います。</p>
      </header>
      <AdminVideoManagementTabs q={q} status={status} event={event} />
      <form method="get" action="/admin/videos" onSubmit={submitFilters} className="fn-console-filter-form" role="search">
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
        {(q || status || event) ? <OpsLink className="fn-btn fn-btn-ghost" href="/admin/videos">解除</OpsLink> : null}
      </form>
      <div style={{ maxWidth: "100%", overflowX: "auto", marginTop: 18 }} aria-label="作品一覧スクロール領域">
        <table className="fn-table">
        <thead><tr>
          <th>サムネイル</th><th>作品</th><th>状態</th><th>登録</th><th>操作</th>
        </tr></thead>
        <tbody>
          {videos.map((video) => <VideoRow key={video.id} video={video} event={event} isReview={isReview} />)}
          {videos.length === 0 ? <tr><td colSpan={5}>条件に合う作品がありません。</td></tr> : null}
        </tbody>
        </table>
      </div>
      {totalPages > 1 ? (
        <nav aria-label="ページ送り" className="fn-panel-actions" style={{ flexWrap: "wrap" }}>
          <span>
            {(paging.page - 1) * paging.pageSize + 1}〜{Math.min(paging.page * paging.pageSize, paging.total)}
            {" / 全 "}{paging.total} 件 ({paging.page} / {totalPages} ページ)
          </span>
          {paging.page > 1 ? (
            <OpsLink className="fn-btn fn-btn-ghost fn-btn-sm" aria-label="前のページ"
              href={buildAdminVideoHref({ q, status, event }, paging.page - 1)}>前へ</OpsLink>
          ) : <span aria-disabled="true">前へ</span>}
          {adminVideoPageNumbers(paging.page, totalPages).map((page, index) =>
            page === "…" ? <span key={`gap-${index}`}>…</span> : (
              <OpsLink key={page} className={page === paging.page ? "fn-btn fn-btn-primary fn-btn-sm" : "fn-btn fn-btn-ghost fn-btn-sm"}
                aria-current={page === paging.page ? "page" : undefined}
                href={buildAdminVideoHref({ q, status, event }, page)}>{page}</OpsLink>
            ),
          )}
          {paging.page < totalPages ? (
            <OpsLink className="fn-btn fn-btn-ghost fn-btn-sm" aria-label="次のページ"
              href={buildAdminVideoHref({ q, status, event }, paging.page + 1)}>次へ</OpsLink>
          ) : <span aria-disabled="true">次へ</span>}
        </nav>
      ) : null}
    </section>
  );
}
