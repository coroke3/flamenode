/** MIG-0724 U02: read-only Ops Manage video queue. Route mounting and action API remain U03/U04. */
import "../../styles/video-review.css";
import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ManageVideosResponse } from "@flamenode/contracts";
import type { OpsResult } from "../../api/read.js";
import { createManageVideosApi, normalizeVideoFilter, VIDEO_FILTERS } from "../../api/manageVideos.js";
import { useApiResult } from "../useApiResult.js";
import { NotFoundView } from "../NotFoundView.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { EmptyState } from "../../components/shared/EmptyState.js";
import { VideoReviewQueueTable } from "../../components/videoReview/VideoReviewQueueTable.js";
import type { ReviewAction } from "../../components/videoReview/shared.js";

type VideosApi = ReturnType<typeof createManageVideosApi>;
type VideosProps = {
  eventId: string;
  api: VideosApi;
  /** U04 will connect the audited Hono mutation. Undefined never performs a write. */
  quickApproveAction?: ReviewAction;
};
const ENCODE = (value: string) => encodeURIComponent(value);
function AccessRedirect({ target }: { target: string }): React.ReactElement {
  React.useEffect(() => { window.location.assign(target); }, [target]);
  return <p role="status">移動しています...</p>;
}
/** Separated to support permission and visual regressions without mounting a protected route. */
export function EventVideosContent({
  eventId, result, statusFilter, refresh, quickApproveAction,
}: {
  eventId: string;
  result: OpsResult<ManageVideosResponse>;
  statusFilter: string;
  refresh: () => void;
  quickApproveAction?: ReviewAction;
}): React.ReactElement {
  const encodedId = ENCODE(eventId);
  if (result.status === "anonymous") return <AccessRedirect target="/entry" />;
  if (result.status === "forbidden") return <AccessRedirect target="/dashboard" />;
  if (result.status === "notFound") return <NotFoundView />;
  if (result.status !== "ok") {
    return <section role="alert" className="fn-public-container fn-page">
      作品一覧を取得できません。時間をおいて再読み込みしてください。
    </section>;
  }
  const data = result.data;
  // No stale list of event A or a different filter may ever render as event B.
  if (data.event.id !== eventId || data.statusFilter !== statusFilter) {
    return <p role="status" aria-busy="true">読み込み中...</p>;
  }
  const backHref = `/manage/events/${encodedId}`;
  return <div className="fn-public-container fn-page" data-fn-video-queue>
    <ConsolePageHeader title={data.event.title}
      description={`作品・審査 — ${data.rows.length} 件（${data.filterLabel}）`}
      backHref={backHref} backLabel="イベント概要へ" />
    <nav aria-label="公開状態フィルタ" className="manage-filter-compact">
      {VIDEO_FILTERS.map(item => {
        const selected = item.value === "all"
          ? statusFilter === "" : item.value === statusFilter ||
            (item.value === "review" && statusFilter === "pending") ||
            (item.value === "public" && statusFilter === "public") ||
            (item.value === "private" && statusFilter === "private") ||
            (item.value === "closed" && statusFilter === "voided");
        return <Link key={item.value}
          to={`/manage/events/${encodedId}/videos?status=${ENCODE(item.value)}`}
          aria-current={selected ? "page" : undefined}>{item.label}</Link>;
      })}
    </nav>
    {data.rows.length === 0
      ? <EmptyState tone={data.isReviewFilter ? "success" : "neutral"}
        title={data.isReviewFilter ? "審査待ちはありません" : "該当する作品はありません"}
        description={data.isReviewFilter
          ? "現在、このイベントで対応が必要な作品はありません。"
          : "フィルタ条件を変えると、別の作品が表示される場合があります。"}
        iconName={data.isReviewFilter ? "check" : "info"} actions={[
          { href: `/event/${encodedId}`, label: "公開ページを見る", variant: "primary" },
          { href: backHref, label: "イベント概要へ", variant: "ghost" },
        ]} />
      : <VideoReviewQueueTable
        rows={data.rows}
        variant="manage"
        reviewHref={videoId => `/manage/events/${encodedId}/videos/${ENCODE(videoId)}`}
        contentHref={videoId => `/dashboard/edit/${ENCODE(videoId)}?privileged=event`}
        canApprove={data.canApproveVideoStatus}
        quickApproveAction={quickApproveAction}
        quickApproveHiddenFields={{ event_id: eventId }}
        onRefresh={refresh}
      />}
  </div>;
}
export function EventVideos({ eventId, api, quickApproveAction }: VideosProps): React.ReactElement {
  const [search] = useSearchParams();
  const statusFilter = normalizeVideoFilter(search.get("status"));
  const [refreshKey, setRefreshKey] = React.useState(0);
  const key = `${eventId.length}:${eventId}/${statusFilter}`;
  const loader = React.useCallback((signal: AbortSignal) => api.getList(eventId, statusFilter, signal),
    [api, eventId, statusFilter]);
  const result = useApiResult(loader, key, refreshKey);
  if (result.status === "loading") {
    return <p role="status" aria-busy="true" className="fn-public-container fn-page">読み込み中...</p>;
  }
  return <EventVideosContent eventId={eventId} statusFilter={statusFilter} result={result}
    refresh={() => setRefreshKey(n => n + 1)} quickApproveAction={quickApproveAction} />;
}
