/** MIG-0720 U04: port of app/(manage)/manage/events/[id]/audience/page.tsx. */
import * as React from "react";
import type { ManageAudienceResponse, ManageAudienceRow } from "@flamenode/contracts";
import { loadManageAudience } from "../../api/manageOverview.js";
import type { OpsFetch } from "../../api/read.js";
import { ManageEventPageShell, manageEventAccentStyle } from "../../components/manage/ManageEventPageShell.js";
import { EmptyState } from "../../components/shared/EmptyState.js";
import { FnTable } from "../../components/shared/FnTable.js";
import { ManageXIcon } from "../../components/shared/ManageXIcon.js";
import { OpsLink as Link } from "../../components/shared/OpsLink.js";
import { NotFoundView } from "../NotFoundView.js";
import { useApiResult } from "../useApiResult.js";

/** CURRENT comparator (audience/page.tsx:161): submitted_count desc -> video_count desc -> slot_count desc. */
export function sortManageAudience(rows: readonly ManageAudienceRow[]): ManageAudienceRow[] {
  return [...rows].sort((a, b) => {
    if (b.submitted_count !== a.submitted_count) return b.submitted_count - a.submitted_count;
    if (b.video_count !== a.video_count) return b.video_count - a.video_count;
    return b.slot_count - a.slot_count;
  });
}

export function ManageEventAudienceContent({
  data,
}: {
  data: ManageAudienceResponse;
}): React.ReactElement {
  const { event: ev, isAdmin, pendingCount } = data;
  const eventHrefId = encodeURIComponent(ev.id);
  // T05 / D-17-7: preserve CURRENT sort and do not display data.truncated.
  const audience = sortManageAudience(data.audience);

  return (
    <ManageEventPageShell
      eventId={ev.id}
      title={ev.title}
      description={`登録者プレビュー — ${audience.length} 名（読み取り専用）`}
      backHref={`/manage/events/${eventHrefId}`}
      backLabel="イベント概要へ"
      isAdmin={isAdmin}
      pendingCount={pendingCount}
      accentStyle={manageEventAccentStyle(ev.accent_color)}
    >
      {audience.length === 0 ? (
        <EmptyState
          tone="neutral"
          title="登録者はまだいません"
          description="このイベントで枠を確保した、または作品を提出した X ID がここに表示されます。"
          actions={[
            { href: `/event/${eventHrefId}`, label: "公開ページを見る", variant: "primary" },
            {
              href: `/manage/events/${eventHrefId}`,
              label: "イベント概要へ",
              variant: "ghost",
            },
          ]}
        />
      ) : (
        <FnTable className="manage-audience-table">
          <thead>
            <tr>
              <th>参加者</th>
              <th>確保枠</th>
              <th>提出済</th>
              <th>動画</th>
            </tr>
          </thead>
          <tbody>
            {audience.map((a, index) => (
              <tr key={`${a.x_user_id}-audience-${index}`}>
                <td>
                  <div className="manage-audience-identity">
                    <ManageXIcon
                      iconUrl={a.icon_url}
                      label={a.x_name ?? a.x_user_id}
                      size={32}
                      className="manage-audience-avatar"
                      fallbackClassName="manage-audience-avatar-fallback"
                    />
                    <div className="manage-audience-identity-text">
                      <Link href={`/user/${encodeURIComponent(a.x_user_id)}`} className="manage-audience-name">
                        {a.x_name ?? a.x_user_id}
                      </Link>
                      <span className="manage-audience-xid">@{a.x_user_id}</span>
                    </div>
                  </div>
                </td>
                <td className="fn-td-tabular">{a.slot_count}</td>
                <td className="fn-td-tabular">
                  {a.submitted_count > 0 ? (
                    <strong>{a.submitted_count}</strong>
                  ) : (
                    a.submitted_count
                  )}
                </td>
                <td className="fn-td-tabular">{a.video_count}</td>
              </tr>
            ))}
          </tbody>
        </FnTable>
      )}
    </ManageEventPageShell>
  );
}

export function EventAudience({
  eventId,
  fetchFn = fetch,
  refreshKey = 0,
}: {
  eventId: string;
  fetchFn?: OpsFetch;
  refreshKey?: number;
}): React.ReactElement {
  const state = useApiResult(
    (signal) => loadManageAudience(fetchFn, eventId, signal),
    `manage-audience:${JSON.stringify([eventId])}`,
    refreshKey,
  );
  if (state.status === "loading") return <p role="status" aria-busy="true">読み込み中...</p>;
  if (state.status === "notFound") return <NotFoundView />;
  if (state.status === "anonymous") return <p role="alert">ログインが必要です。</p>;
  if (state.status === "forbidden") return <p role="alert">このイベントへのアクセス権がありません。</p>;
  if (state.status === "unsupported") return <p role="status">この画面は移行準備中です。</p>;
  if (state.status === "unavailable") return <p role="alert">登録者情報を読み込めません。再読み込みしてください。</p>;
  return <ManageEventAudienceContent data={state.data} />;
}
