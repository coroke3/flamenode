/** MIG-0720 U02: port of app/(manage)/manage/events/[id]/page.tsx. */
import * as React from "react";
import { useLocation } from "react-router-dom";
import type { ManageOverviewResponse } from "@flamenode/contracts";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  isAcceptingEntries,
} from "@flamenode/domain/event/status";
import { loadManageOverview, normalizeManageNotifFilter, type ManageNotifCategory } from "../../api/manageOverview.js";
import type { OpsFetch } from "../../api/read.js";
import { ManageEventPageShell, manageEventAccentStyle } from "../../components/manage/ManageEventPageShell.js";
import { NotificationOutboxSummary } from "../../components/notifications/NotificationOutboxSummary.js";
import { EmptyState } from "../../components/shared/EmptyState.js";
import { FnTable } from "../../components/shared/FnTable.js";
import { Icon } from "../../components/shared/Icon.js";
import { OpsLink as Link } from "../../components/shared/OpsLink.js";
import { NotFoundView } from "../NotFoundView.js";
import { useApiResult } from "../useApiResult.js";
import { formatRelative, formatUnix } from "./manageFormat.js";
import { SaveEventTemplateForm } from "./SaveEventTemplateForm.js";

const MANAGE_NOTIFICATION_FILTER_OPTIONS: ReadonlyArray<{
  key: ManageNotifCategory;
  label: string;
}> = [
  { key: "all", label: "すべて" },
  { key: "video", label: "作品審査・提出" },
  { key: "x_id", label: "X ID 連携" },
  { key: "slot", label: "枠・スケジュール" },
  { key: "chapter", label: "部・チャプター" },
  { key: "other", label: "その他" },
];

export function ManageEventOverviewContent({
  data,
  fetchFn = fetch,
  onRefresh,
}: {
  data: ManageOverviewResponse;
  fetchFn?: OpsFetch;
  onRefresh?: () => void;
}): React.ReactElement {
  const {
    isAdmin,
    event: ev,
    editorRole,
    activeXUserId,
    manageStaffXUserIds,
    publicVideoCount: publicTotal,
    slotCounts,
    pendingVideos,
    auditLogs: eventAuditLogs,
    notifCategory,
    notifCounts,
    notificationSchemaMissing: eventNotificationSchemaMissing,
    notifications: eventNotifications,
  } = data;

  const eventHrefId = encodeURIComponent(ev.id);
  const filter = normalizeManageNotifFilter(notifCategory);
  const pendingTotal = ev.pending_review_count;

  const slotStatusMap: Record<string, number> = {};
  for (const [statusKey, count] of Object.entries(slotCounts)) {
    slotStatusMap[statusKey] = Number(count ?? 0);
  }
  const totalSlots = Object.values(slotStatusMap).reduce((a, b) => a + b, 0);
  const filledSlots = Math.max(0, totalSlots - (slotStatusMap.available ?? 0));
  const reservedSlots = slotStatusMap.reserved ?? 0;
  const submittedSlots = slotStatusMap.submitted ?? 0;
  const slotFillPct = totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;

  const status = computeEventStatus(ev);
  const accepting = isAcceptingEntries(ev);
  const showEventNotificationsSection = !eventNotificationSchemaMissing && notifCounts.all > 0;

  const eventDateLead = (
    <>
      {ev.start_time ? formatUnix(ev.start_time, { dateOnly: true }) : "—"}
      {ev.end_time ? ` 〜 ${formatUnix(ev.end_time, { dateOnly: true })}` : ""}
      {ev.entry_start_time != null || ev.entry_end_time != null ? (
        <span className="fn-console-meta-sep">
          · 募集{" "}
          {ev.entry_start_time != null ? formatUnix(ev.entry_start_time) : "—"}
          {" 〜 "}
          {ev.entry_end_time != null ? formatUnix(ev.entry_end_time) : "—"}
        </span>
      ) : null}
    </>
  );

  return (
    <ManageEventPageShell
      eventId={ev.id}
      title={ev.title}
      description={eventDateLead}
      backHref="/manage"
      backLabel="担当イベント一覧へ"
      isAdmin={isAdmin}
      pendingCount={pendingTotal}
      accentStyle={manageEventAccentStyle(ev.accent_color)}
      showActiveXNotice
      activeXUserId={activeXUserId}
      manageStaffXUserIds={manageStaffXUserIds}
      headerChildren={
        <>
          <span className={`fn-badge ${eventStatusBadgeClass(status)}`}>
            {eventStatusLabel(status)}
          </span>
          {accepting ? (
            <span className="fn-badge fn-badge-soft">受付中</span>
          ) : null}
          <span className="fn-badge fn-badge-soft">
            {isAdmin
              ? "管理者"
              : editorRole === "representative"
                ? "代表"
                : "運営"}
          </span>
        </>
      }
    >
      <div className="manage-event-overview-grid">
        <section
          className={`manage-section manage-attention ${
            pendingTotal > 0 ? "manage-attention--warn" : "manage-attention--ok"
          }`}
        >
          <div>
            <h2 className="manage-attention-title">
              {pendingTotal > 0
                ? "対応が必要です"
                : "現在、対応が必要な作品はありません"}
            </h2>
            <p className="manage-attention-lead">
              {pendingTotal > 0
                ? `審査待ち ${pendingTotal.toLocaleString()} 件があります。`
                : "審査待ちの作品はありません。進行状況を確認できます。"}
            </p>
          </div>
          {pendingTotal > 0 ? (
            <Link
              href={`/manage/events/${eventHrefId}/videos?status=pending`}
              className="fn-btn fn-btn-primary fn-btn-sm"
            >
              審査を開始
            </Link>
          ) : null}
        </section>

        <section className="manage-section manage-progress">
          <div className="manage-progress-head">
            <h2 className="manage-progress-label">進行状況</h2>
            <span className="manage-progress-value">
              公開作品 {publicTotal.toLocaleString()} 件
            </span>
          </div>
          <div>
            <div className="manage-progress-head manage-progress-head--compact">
              <span className="manage-progress-label">枠の埋まり</span>
              <span className="manage-progress-value">
                {filledSlots.toLocaleString()} / {totalSlots.toLocaleString()}
              </span>
            </div>
            <div
              className="manage-progress-bar"
              role="progressbar"
              aria-valuenow={slotFillPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="枠の埋まり率"
            >
              <div
                className="manage-progress-bar-fill"
                style={{ width: `${slotFillPct}%` }}
              />
            </div>
          </div>
          <div className="manage-progress-stats">
            <span>
              確保済 <strong>{reservedSlots.toLocaleString()}</strong>
            </span>
            <span>
              提出済 <strong>{submittedSlots.toLocaleString()}</strong>
            </span>
          </div>
        </section>
      </div>

      <nav
        className="manage-event-action-rail"
        aria-label="イベント運営ショートカット"
      >
        <Link
          href={`/manage/events/${eventHrefId}/videos?status=pending`}
          className={`manage-event-action-card ${
            pendingTotal > 0 ? "manage-event-action-card--priority" : ""
          }`}
        >
          <span className="manage-event-action-icon" aria-hidden="true">
            <Icon name="check" size={17} />
          </span>
          <span className="manage-event-action-copy">
            <span className="manage-event-action-title">審査キュー</span>
            <span className="manage-event-action-meta">
              {pendingTotal > 0
                ? `${pendingTotal.toLocaleString()} 件を確認`
                : "対応待ちはありません"}
            </span>
          </span>
          <Icon name="chevron-right" size={17} />
        </Link>

        <Link
          href={`/manage/events/${eventHrefId}/videos?status=all`}
          className="manage-event-action-card"
        >
          <span className="manage-event-action-icon" aria-hidden="true">
            <Icon name="list" size={17} />
          </span>
          <span className="manage-event-action-copy">
            <span className="manage-event-action-title">作品を管理</span>
            <span className="manage-event-action-meta">
              公開中 {publicTotal.toLocaleString()} 件
            </span>
          </span>
          <Icon name="chevron-right" size={17} />
        </Link>

        <Link
          href={`/manage/events/${eventHrefId}/slots`}
          className="manage-event-action-card"
        >
          <span className="manage-event-action-icon" aria-hidden="true">
            <Icon name="calendar" size={17} />
          </span>
          <span className="manage-event-action-copy">
            <span className="manage-event-action-title">予約枠を確認</span>
            <span className="manage-event-action-meta">
              {totalSlots > 0
                ? `埋まり率 ${slotFillPct}%`
                : "予約枠が未設定です"}
            </span>
          </span>
          <Icon name="chevron-right" size={17} />
        </Link>

        <Link
          href={`/manage/events/${eventHrefId}/audience`}
          className="manage-event-action-card"
        >
          <span className="manage-event-action-icon" aria-hidden="true">
            <Icon name="users" size={17} />
          </span>
          <span className="manage-event-action-copy">
            <span className="manage-event-action-title">参加者を確認</span>
            <span className="manage-event-action-meta">参加状況を確認</span>
          </span>
          <Icon name="chevron-right" size={17} />
        </Link>

        <Link
          href={`/manage/events/${eventHrefId}/edit#section-required`}
          className="manage-event-action-card"
        >
          <span className="manage-event-action-icon" aria-hidden="true">
            <Icon name="settings" size={17} />
          </span>
          <span className="manage-event-action-copy">
            <span className="manage-event-action-title">投稿の必須項目</span>
            <span className="manage-event-action-meta">作品フォームの必須設定</span>
          </span>
          <Icon name="chevron-right" size={17} />
        </Link>
      </nav>

      {isAdmin ? (
        <section className="fn-console-section">
          <h2 className="fn-console-eyebrow">テンプレート化</h2>
          <div className="fn-card manage-template-card">
            <SaveEventTemplateForm
              eventId={ev.id}
              eventTitle={ev.title}
              fetchFn={fetchFn}
              onSaved={onRefresh}
            />
          </div>
        </section>
      ) : null}

      {eventNotificationSchemaMissing ? (
        <div role="status" className="fn-alert fn-alert--warn fn-console-section--tight">
          イベント通知の絞り込みに必要な DB migration が未適用です。
          ローカルでは `npm.cmd run db:local-apply` を実行してください。
        </div>
      ) : null}

      <section className="manage-section manage-event-pending-section">
        <h2 className="fn-console-eyebrow">直近の審査待ち</h2>
        {pendingVideos.length === 0 ? (
          <EmptyState
            tone="success"
            title="審査待ちはありません"
            description="現在、このイベントで対応が必要な作品はありません。"
            iconName="check"
            actions={[
              { href: `/event/${eventHrefId}`, label: "公開ページを見る", variant: "primary" },
              {
                href: `/manage/events/${eventHrefId}/slots`,
                label: "枠を見る",
                variant: "ghost",
              },
            ]}
          />
        ) : (
          <FnTable className="manage-event-pending-table">
            <thead>
              <tr>
                <th className="manage-event-pending-title-col">タイトル</th>
                <th className="manage-event-pending-author-col">作者</th>
                <th className="manage-event-pending-date-col">登録</th>
                <th className="manage-event-pending-actions-col"></th>
              </tr>
            </thead>
            <tbody>
              {pendingVideos.map((v, index) => {
                const videoHrefId = encodeURIComponent(v.id);
                return (
                  <tr key={`${v.id}-pending-${index}`}>
                    <td className="manage-event-pending-title-cell">{v.title}</td>
                    <td className="manage-event-pending-author-cell">{v.display_name}</td>
                    <td className="manage-event-pending-date-cell fn-muted">
                      {formatRelative(v.created_at)}
                    </td>
                    <td className="manage-event-pending-actions-cell">
                      <div className="fn-console-row-actions">
                        <Link
                          href={`/manage/events/${eventHrefId}/videos/${videoHrefId}`}
                          className="fn-btn fn-btn-primary fn-btn-sm"
                        >
                          審査
                        </Link>
                        <Link
                          href={`/dashboard/edit/${videoHrefId}?privileged=event`}
                          className="fn-btn fn-btn-ghost fn-btn-sm"
                        >
                          内容確認
                        </Link>
                        {isAdmin ? (
                          <Link
                            href={`/admin/videos/${videoHrefId}`}
                            className="fn-btn fn-btn-ghost fn-btn-sm"
                          >
                            管理者用
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </FnTable>
        )}
      </section>

      {showEventNotificationsSection ? (
        <details className="manage-collapsible">
          <summary>
            イベント通知
            <span className="fn-muted fn-text-sm">
              {notifCounts.all.toLocaleString()} 件
            </span>
          </summary>
          <div className="manage-collapsible-body">
            <p className="fn-muted fn-text-sm fn-console-block-lead">
              このイベントに紐づく Discord 通知の配信状況です。
            </p>
            <nav
              aria-label="通知カテゴリフィルタ"
              className="manage-filter-compact"
            >
              {MANAGE_NOTIFICATION_FILTER_OPTIONS.map(({ key, label }) => {
                const href =
                  key === "all"
                    ? `/manage/events/${eventHrefId}`
                    : `/manage/events/${eventHrefId}?notif=${key}`;
                return (
                  <Link
                    key={key}
                    href={href}
                    aria-current={filter === key ? "page" : undefined}
                  >
                    {label} ({notifCounts[key]})
                  </Link>
                );
              })}
            </nav>
            {eventNotifications.length === 0 ? (
              <EmptyState
                tone="neutral"
                title="該当する通知はありません"
                description="選択中のカテゴリに一致する通知ログはありません。"
                actions={[
                  {
                    href: `/manage/events/${eventHrefId}`,
                    label: "すべての通知を見る",
                    variant: "ghost",
                  },
                ]}
              />
            ) : (
              <FnTable>
                <thead>
                  <tr>
                    <th className="fn-th-w140">日時</th>
                    <th>通知</th>
                    <th className="fn-th-w56">試行</th>
                  </tr>
                </thead>
                <tbody>
                  {eventNotifications.map((n) => (
                    <tr key={n.id}>
                      <td className="fn-td-nowrap fn-td-top">
                        <div>{formatUnix(n.created_at)}</div>
                        <div className="fn-td-muted">
                          {formatRelative(n.created_at)}
                        </div>
                      </td>
                      <td>
                        <NotificationOutboxSummary
                          row={n}
                          recipient={
                            n.recipient && n.recipient_user_id
                              ? {
                                  userId: n.recipient_user_id,
                                  userName: n.recipient.userName,
                                  discordId: n.recipient.discordId,
                                  notificationsEnabled: n.recipient.notificationsEnabled,
                                }
                              : null
                          }
                        />
                      </td>
                      <td className="fn-td-tabular">{n.attempt_count ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </FnTable>
            )}
          </div>
        </details>
      ) : null}

      <details className="manage-collapsible">
        <summary>
          イベント更新履歴
          <span className="fn-muted fn-text-sm">
            {eventAuditLogs.length.toLocaleString()} 件
          </span>
        </summary>
        <div className="manage-collapsible-body">
          {eventAuditLogs.length === 0 ? (
            <EmptyState
              tone="success"
              title="直近の更新はありません"
              description="このイベントに関する操作履歴は、ここに表示されます。"
              iconName="check"
            />
          ) : (
            <FnTable>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>操作</th>
                  <th>実行者</th>
                </tr>
              </thead>
              <tbody>
                {eventAuditLogs.map((h) => (
                  <tr key={h.id}>
                    <td className="fn-td-nowrap">
                      <div>{formatUnix(h.created_at)}</div>
                      <div className="fn-td-muted">{formatRelative(h.created_at)}</div>
                    </td>
                    <td>
                      <span
                        className={`fn-badge ${
                          h.operation === "DELETE"
                            ? "fn-badge-danger"
                            : h.operation === "CREATE"
                              ? "fn-badge-accent"
                              : "fn-badge-soft"
                        }`}
                      >
                        {h.operation}
                      </span>
                    </td>
                    <td className="fn-td-secondary">
                      {h.actor_user_id ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </FnTable>
          )}
        </div>
      </details>
    </ManageEventPageShell>
  );
}

export function EventOverview({
  eventId,
  fetchFn = fetch,
  refreshKey = 0,
}: {
  eventId: string;
  fetchFn?: OpsFetch;
  refreshKey?: number;
}): React.ReactElement {
  const location = useLocation();
  const notif = normalizeManageNotifFilter(new URLSearchParams(location.search).get("notif"));
  const [localRefresh, setLocalRefresh] = React.useState(0);
  // Both the event ID and category are authorization/data boundaries. A
  // response for the previous event must not render during a route switch.
  const state = useApiResult(
    (signal) => loadManageOverview(fetchFn, eventId, notif, signal),
    `manage-overview:${JSON.stringify([eventId, notif])}`,
    refreshKey + localRefresh,
  );
  if (state.status === "loading") return <p role="status" aria-busy="true">読み込み中...</p>;
  if (state.status === "notFound") return <NotFoundView />;
  if (state.status === "anonymous") return <p role="alert">ログインが必要です。</p>;
  if (state.status === "forbidden") return <p role="alert">このイベントへのアクセス権がありません。</p>;
  if (state.status === "unsupported") return <p role="status">この画面は移行準備中です。</p>;
  if (state.status === "unavailable") return <p role="alert">イベント情報を読み込めません。再読み込みしてください。</p>;
  return (
    <ManageEventOverviewContent
      data={state.data}
      fetchFn={fetchFn}
      onRefresh={() => setLocalRefresh((value) => value + 1)}
    />
  );
}
