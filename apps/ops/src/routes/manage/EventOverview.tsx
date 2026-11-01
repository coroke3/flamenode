/** MIG-0720 U02a: read-only Manage overview. Route mount belongs to MIG-0719. */
import * as React from "react";
import { useLocation } from "react-router-dom";
import type { ManageOverviewResponse } from "@flamenode/contracts";
import type { OpsFetch } from "../../api/read.js";
import { loadManageOverview, normalizeManageNotifFilter } from "../../api/manageOverview.js";
import { ManageEventPageShell } from "../../components/manage/ManageEventPageShell.js";
import { OpsLink as Link } from "../../components/shared/OpsLink.js";
import { NotFoundView } from "../NotFoundView.js";
import { useApiResult } from "../useApiResult.js";

const FILTERS = [
  ["all", "すべて"], ["video", "作品"], ["x_id", "X ID"],
  ["slot", "枠"], ["chapter", "チャプター"], ["other", "その他"],
] as const;

export function ManageEventOverviewContent({ data }: {
  data: ManageOverviewResponse;
}): React.ReactElement {
  const id = encodeURIComponent(data.event.id);
  const filter = normalizeManageNotifFilter(data.notifCategory);
  return (
    <ManageEventPageShell eventId={data.event.id} title={data.event.title}
      isAdmin={data.isAdmin} pendingCount={data.event.pending_review_count}
      showActiveXNotice activeXUserId={data.activeXUserId}
      manageStaffXUserIds={data.manageStaffXUserIds}>
      <section className="fn-console-section" aria-label="イベントの状態">
        <h2>イベント概要</h2>
        <dl className="fn-console-stats">
          <div><dt>公開作品</dt><dd>{data.publicVideoCount}</dd></div>
          <div><dt>対応待ち作品</dt><dd>{data.event.pending_review_count}</dd></div>
          <div><dt>イベントの公開状態</dt><dd>{data.event.visibility_status ?? "未設定"}</dd></div>
        </dl>
        <Link href={`/manage/events/${id}/videos?status=pending`}>対応待ち作品を確認</Link>
      </section>

      <section className="fn-console-section" aria-label="対応待ち作品">
        <h2>最近の対応待ち作品</h2>
        {data.pendingVideos.length === 0
          ? <p>対応待ちの作品はありません。</p>
          : <ul>{data.pendingVideos.map(video => (
            <li key={video.id}>
              <Link href={`/manage/events/${id}/videos/${encodeURIComponent(video.id)}`}>
                {video.title}
              </Link>
            </li>
          ))}</ul>}
      </section>

      <section className="fn-console-section" aria-label="運営通知">
        <h2>運営通知</h2>
        {data.notificationSchemaMissing ? (
          <p role="status">通知データを取得できません。通知以外の情報を表示しています。</p>
        ) : (
          <>
            <nav aria-label="通知種別">
              {FILTERS.map(([category, label]) => (
                <Link key={category}
                  href={`/manage/events/${id}${category === "all" ? "" : `?notif=${category}`}`}
                  aria-current={category === filter ? "page" : undefined}>
                  {label} ({data.notifCounts[category]})
                </Link>
              ))}
            </nav>
            {data.notifications.length === 0
              ? <p>該当する通知はありません。</p>
              : <ul>{data.notifications.map(notification => (
                <li key={notification.id}>{notification.type} ({notification.status ?? "未処理"})</li>
              ))}</ul>}
          </>
        )}
      </section>
    </ManageEventPageShell>
  );
}

export function EventOverview({ eventId, fetchFn, refreshKey = 0 }: {
  eventId: string;
  fetchFn: OpsFetch;
  refreshKey?: number;
}): React.ReactElement {
  const location = useLocation();
  const notif = normalizeManageNotifFilter(new URLSearchParams(location.search).get("notif"));
  // Both the event ID and category are authorization/data boundaries. A
  // response for the previous event must not render during a route switch.
  const state = useApiResult(
    signal => loadManageOverview(fetchFn, eventId, notif, signal),
    `manage-overview:${JSON.stringify([eventId, notif])}`,
    refreshKey,
  );
  if (state.status === "loading") return <p role="status" aria-busy="true">読み込み中...</p>;
  if (state.status === "notFound") return <NotFoundView />;
  if (state.status === "anonymous") return <p role="alert">ログインが必要です。</p>;
  if (state.status === "forbidden") return <p role="alert">このイベントへのアクセス権がありません。</p>;
  if (state.status === "unsupported") return <p role="status">この画面は移行準備中です。</p>;
  if (state.status === "unavailable") return <p role="alert">イベント情報を読み込めません。再読み込みしてください。</p>;
  return <ManageEventOverviewContent data={state.data} />;
}
